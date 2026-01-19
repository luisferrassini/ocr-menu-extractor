import type {
  MenuItem,
  PricingRule,
  SavedMenuVersion,
  MenuCategory,
  PricingRuleType,
  AppliedCombo,
} from "./types";

// Storage functions
const STORAGE_KEY = "saved-menus";

export function saveMenuVersion(
  name: string,
  items: MenuItem[],
  pricingRules: PricingRule[],
): string {
  const version: SavedMenuVersion = {
    id: `menu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    createdAt: new Date().toISOString(),
    items,
    pricingRules,
  };

  const saved = getSavedMenus();
  saved.push(version);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  return version.id;
}

export function updateMenuVersion(
  id: string,
  name: string,
  items: MenuItem[],
  pricingRules: PricingRule[],
): void {
  const saved = getSavedMenus();
  const index = saved.findIndex((m) => m.id === id);
  if (index === -1) {
    throw new Error(`Menu with id ${id} not found`);
  }
  
  // Mantém o ID e createdAt originais, atualiza apenas os dados
  saved[index] = {
    ...saved[index],
    name,
    items,
    pricingRules,
  };
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export function getSavedMenus(): SavedMenuVersion[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function loadMenuVersion(id: string): SavedMenuVersion | null {
  const saved = getSavedMenus();
  return saved.find((m) => m.id === id) || null;
}

export function deleteMenuVersion(id: string): void {
  const saved = getSavedMenus();
  const filtered = saved.filter((m) => m.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

// OCR corrections
export function correctOCRText(text: string): string {
  return text
    .replace(/MARMITAS\s+EIT/gi, "MARMITAS FIT")
    .replace(/\bfite\b/gi, "fit")
    .replace(/\blowcarb\b/gi, "lowcarb");
}

// Types for API response
type APIMenuItem = {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  images?: string[];
};

type APIPricingRule = {
  id?: string;
  category?: string;
  type?: string;
  price?: number | string;
  quantity?: number | string;
  mixQuantities?: Array<{ category: string; quantity: number }>;
};

type APIMenuData = {
  items?: APIMenuItem[];
  pricingRules?: APIPricingRule[];
};

// Parse structured menu from API response
export function parseStructuredMenu(data: APIMenuData): {
  items: MenuItem[];
  pricingRules: PricingRule[];
} {
  if (!data || !data.items || !data.pricingRules) {
    return { items: [], pricingRules: [] };
  }

  const items: MenuItem[] = data.items.map((item: APIMenuItem) => ({
    id: item.id || `item-${Math.random().toString(36).substr(2, 9)}`,
    name: item.name || "",
    category: (item.category || "FIT") as MenuCategory,
    description: item.description,
    images: item.images || [],
  }));

  const pricingRules: PricingRule[] = data.pricingRules.map((rule: APIPricingRule) => ({
    id: rule.id || `rule-${Math.random().toString(36).substr(2, 9)}`,
    category: (rule.category || "FIT") as MenuCategory,
    type: (rule.type || "UNITARY") as PricingRuleType,
    price: typeof rule.price === "string" ? Number.parseFloat(rule.price) || 0 : rule.price || 0,
    quantity: rule.quantity ? Number.parseInt(String(rule.quantity), 10) : undefined,
    mixQuantities: rule.mixQuantities?.map((mix) => ({
      category: mix.category as MenuCategory,
      quantity: mix.quantity,
    })),
  }));

  return { items, pricingRules };
}

// Legacy parser for backward compatibility
export function parseMenuText(text: string): MenuItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: MenuItem[] = [];
  const priceRegex = /(.*?)(\d+[.,]\d{2}|\d+)\s*(?:€|eur|reais?|rs|r\$|\$)?$/i;

  lines.forEach((line, index) => {
    const match = line.match(priceRegex);

    if (match) {
      const name = match[1].replace(/[-–—]+$/, "").trim();
      const priceRaw = match[2].replace(",", ".");
      const price = Number.parseFloat(priceRaw);

      if (name && !Number.isNaN(price)) {
        items.push({
          id: `legacy-${index}`,
          name,
          category: "FIT", // Default category
          description: line,
        });
        return;
      }
    }

    if (line.length > 3) {
      items.push({
        id: `legacy-${index}`,
        name: line,
        category: "FIT", // Default category
      });
    }
  });

  return items;
}

// Price calculation functions
export function calculateBestPrice(
  selections: Record<string, number>,
  items: MenuItem[],
  pricingRules: PricingRule[],
): { total: number; appliedCombos: AppliedCombo[]; breakdown: string[] } {
  // Build category counts from selections
  const categoryCounts: Record<MenuCategory, number> = {
    FIT: 0,
    LOWCARB: 0,
    CALDOS: 0,
  };

  const itemMap = new Map(items.map((item) => [item.id, item]));
  Object.entries(selections).forEach(([itemId, quantity]) => {
    const item = itemMap.get(itemId);
    if (item) {
      categoryCounts[item.category] += quantity;
    }
  });

  // Get unitary prices
  const unitaryRules = pricingRules.filter((r) => r.type === "UNITARY");
  const unitaryPrices: Record<MenuCategory, number> = {
    FIT: 0,
    LOWCARB: 0,
    CALDOS: 0,
  };

  unitaryRules.forEach((rule) => {
    unitaryPrices[rule.category] = rule.price;
  });

  // Try to apply combos
  const appliedCombos: AppliedCombo[] = [];
  const remainingCounts = { ...categoryCounts };
  let totalPrice = 0;

  // Sort combos by savings (best first)
  const combos = pricingRules
    .filter((r) => r.type !== "UNITARY")
    .map((rule) => {
      let savings = 0;
      if (rule.type === "QUANTITY_COMBO" && rule.quantity) {
        const unitaryPrice = unitaryPrices[rule.category];
        const comboPrice = rule.price;
        const wouldPay = unitaryPrice * rule.quantity;
        savings = wouldPay - comboPrice;
      } else if (rule.type === "MIXED_COMBO" && rule.mixQuantities) {
        let wouldPay = 0;
        rule.mixQuantities.forEach((mix) => {
          wouldPay += unitaryPrices[mix.category] * mix.quantity;
        });
        savings = wouldPay - rule.price;
      }
      return { rule, savings };
    })
    .filter((c) => c.savings > 0)
    .sort((a, b) => b.savings - a.savings);

  // Apply best combos
  for (const { rule, savings } of combos) {
    if (rule.type === "QUANTITY_COMBO" && rule.quantity) {
      const available = Math.floor(
        remainingCounts[rule.category] / rule.quantity,
      );
      if (available > 0) {
        const times = available;
        appliedCombos.push({ rule, savings: savings * times });
        remainingCounts[rule.category] -= rule.quantity * times;
        totalPrice += rule.price * times;
      }
    } else if (rule.type === "MIXED_COMBO" && rule.mixQuantities) {
      let canApply = true;
      let times = Infinity;
      rule.mixQuantities.forEach((mix) => {
        const available = Math.floor(
          remainingCounts[mix.category] / mix.quantity,
        );
        times = Math.min(times, available);
        if (available === 0) canApply = false;
      });

      if (canApply && times > 0) {
        appliedCombos.push({ rule, savings: savings * times });
        rule.mixQuantities.forEach((mix) => {
          remainingCounts[mix.category] -= mix.quantity * times;
        });
        totalPrice += rule.price * times;
      }
    }
  }

  // Add remaining items at unitary price
  Object.entries(remainingCounts).forEach(([category, count]) => {
    if (count > 0) {
      totalPrice += unitaryPrices[category as MenuCategory] * count;
    }
  });

  const breakdown: string[] = [];
  if (appliedCombos.length > 0) {
    breakdown.push("Combos aplicados:");
    appliedCombos.forEach(({ rule, savings }) => {
      if (rule.type === "QUANTITY_COMBO") {
        breakdown.push(
          `- ${rule.quantity}x ${rule.category}: R$ ${rule.price.toFixed(2)} (economia: R$ ${savings.toFixed(2)})`,
        );
      } else if (rule.type === "MIXED_COMBO" && rule.mixQuantities) {
        const mixDesc = rule.mixQuantities
          .map((m) => `${m.quantity}x ${m.category}`)
          .join(" + ");
        breakdown.push(
          `- Combo ${mixDesc}: R$ ${rule.price.toFixed(2)} (economia: R$ ${savings.toFixed(2)})`,
        );
      }
    });
  }

  return { total: totalPrice, appliedCombos, breakdown };
}

// Storage functions for Gemini API key
const GEMINI_API_KEY_STORAGE_KEY = "gemini-api-key";
const GEMINI_MODEL_STORAGE_KEY = "gemini-model";

export function getGeminiApiKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveGeminiApiKey(apiKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, apiKey);
  } catch {
    // Ignore storage errors
  }
}

export function clearGeminiApiKey(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

// AI Model configuration
export type AIModel = {
  id: string;
  name: string;
  endpoint: string;
};

export const AVAILABLE_MODELS: AIModel[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash (Recomendado)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite (Mais rápido)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro (Mais inteligente)",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
  },
  {
    id: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash-Lite",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent",
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent",
  },
];

export function getSelectedAIModel(): string {
  if (typeof window === "undefined") return "gemini-2.5-flash-lite";
  try {
    return localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || "gemini-2.5-flash-lite";
  } catch {
    return "gemini-2.5-flash-lite";
  }
}

export function saveSelectedAIModel(modelId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, modelId);
  } catch {
    // Ignore storage errors
  }
}

// Generate prompt for AI processing (without sending)
export function generateAIPrompt(rawText: string): string {
  if (!rawText || typeof rawText !== "string") {
    return "";
  }

  const corrected = correctOCRText(rawText);
  
  return `Você é um assistente que processa texto cru de OCR de cardápios de restaurantes em português do Brasil.

O cardápio tem uma estrutura fixa:
- Seções como "MARMITAS FIT", "MARMITAS LOWCARB" ou "CALDOS" contêm as opções/itens do cardápio
- Seção "VALORES" contém as regras de preço (preço unitário e combos promocionais)

Tarefas:
1. Identificar e corrigir erros de OCR (ex: "MARMITAS EIT" → "MARMITAS FIT", "fite" → "fit")
2. Separar itens/opções das regras de preço
3. Identificar categorias: FIT, LOWCARB, ou CALDOS baseado nas seções
4. Extrair regras de preço da seção VALORES:
   - Preço unitário: "Marmita fit Valor unitario. R$ 22,90" → type: "UNITARY", price: 22.90
   - Combo por quantidade: "Combo promocional 10 unidades R$ 209,90" → type: "QUANTITY_COMBO", quantity: 10, price: 209.90
   - Combo misto: "Combo promocional 10 unidades 5 fit 5 lowcarb R$ 219,90" → type: "MIXED_COMBO", mixQuantities: [{category: "FIT", quantity: 5}, {category: "LOWCARB", quantity: 5}], price: 219.90

Responda APENAS com um JSON válido no seguinte formato (sem markdown, sem explicações):
{
  "items": [
    {"id": "1", "name": "Nome do prato", "category": "FIT", "description": "Descrição opcional"},
    {"id": "2", "name": "Outro prato", "category": "LOWCARB"}
  ],
  "pricingRules": [
    {"id": "fit-unitary", "category": "FIT", "type": "UNITARY", "price": 22.90},
    {"id": "fit-combo-10", "category": "FIT", "type": "QUANTITY_COMBO", "quantity": 10, "price": 209.90},
    {"id": "mix-fit-lowcarb", "category": "FIT", "type": "MIXED_COMBO", "mixQuantities": [{"category": "FIT", "quantity": 5}, {"category": "LOWCARB", "quantity": 5}], "price": 219.90}
  ]
}

Texto cru do OCR:
${corrected}

JSON estruturado:`;
}

// Client-side function to process menu with Gemini API
export async function processMenuWithAI(
  rawText: string,
  apiKey?: string,
  modelId?: string,
): Promise<{
  cleanedText: string;
  structured: boolean;
  data?: APIMenuData;
  prompt: string;
}> {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("rawText is required");
  }

  // Try to get API key from parameter or localStorage
  const finalApiKey = apiKey || getGeminiApiKey();
  if (!finalApiKey) {
    throw new Error(
      "API key do Gemini não configurada. Por favor, configure sua API key nas configurações.",
    );
  }

  // Get model endpoint
  const selectedModelId = modelId || getSelectedAIModel();
  const model = AVAILABLE_MODELS.find((m) => m.id === selectedModelId) || AVAILABLE_MODELS[0];
  const endpoint = model.endpoint;

  const prompt = generateAIPrompt(rawText);

  const response = await fetch(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": finalApiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    let errorMessage = "Falha ao processar com a API do Gemini";

    const errorText = await response.text();
    console.error("Gemini API error:", errorText);

    try {
      const errorData = JSON.parse(errorText);

      if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      } else if (errorData.error?.status) {
        switch (errorData.error.status) {
          case "UNAVAILABLE":
            errorMessage =
              "O modelo está sobrecarregado. Por favor, tente novamente em alguns instantes.";
            break;
          case "RESOURCE_EXHAUSTED":
            errorMessage =
              "Limite de requisições excedido. Por favor, tente novamente mais tarde.";
            break;
          case "INVALID_ARGUMENT":
            errorMessage =
              "Erro na requisição. Verifique se o texto do OCR está correto.";
            break;
          case "PERMISSION_DENIED":
            errorMessage =
              "Erro de autenticação. Verifique se a chave da API está configurada corretamente.";
            break;
          default:
            errorMessage = errorData.error.message || errorMessage;
        }
      }
    } catch {
      if (response.status === 503) {
        errorMessage =
          "O modelo está sobrecarregado. Por favor, tente novamente em alguns instantes.";
      } else if (response.status === 429) {
        errorMessage =
          "Limite de requisições excedido. Por favor, tente novamente mais tarde.";
      } else if (response.status === 401 || response.status === 403) {
        errorMessage =
          "Erro de autenticação. Verifique se a chave da API está configurada corretamente.";
      }
    }

    throw new Error(errorMessage);
  }

  const data = await response.json();
  const responseText =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

  let structuredData = null;
  try {
    const jsonText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    structuredData = JSON.parse(jsonText);
  } catch {
    return {
      cleanedText: responseText || rawText,
      structured: false,
      prompt,
    };
  }

  return {
    cleanedText: responseText,
    structured: true,
    data: structuredData,
    prompt,
  };
}

// Export/Import functions for menus
export function exportMenuToJSON(menu: SavedMenuVersion): string {
  return JSON.stringify(menu, null, 2);
}

export function exportMenuToFile(menu: SavedMenuVersion): void {
  const json = exportMenuToJSON(menu);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${menu.name.replace(/[^a-z0-9]/gi, "_")}_${menu.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportMenuToClipboard(menu: SavedMenuVersion): Promise<void> {
  const json = exportMenuToJSON(menu);
  return navigator.clipboard.writeText(json);
}

export function importMenuFromJSON(json: string): SavedMenuVersion {
  const menu = JSON.parse(json) as SavedMenuVersion;
  
  // Validate structure
  if (!menu.id || !menu.name || !menu.items || !menu.pricingRules) {
    throw new Error("Formato de cardápio inválido");
  }
  
  // Generate new ID to avoid conflicts
  menu.id = `menu-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  menu.createdAt = new Date().toISOString();
  
  return menu;
}

export async function importMenuFromClipboard(): Promise<SavedMenuVersion> {
  const text = await navigator.clipboard.readText();
  return importMenuFromJSON(text);
}

export function importMenuFromFile(file: File): Promise<SavedMenuVersion> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const menu = importMenuFromJSON(json);
        resolve(menu);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsText(file);
  });
}
