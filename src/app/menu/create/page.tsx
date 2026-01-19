"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createWorker } from "tesseract.js";
import type {
  MenuItem,
  PricingRule,
  MenuCategory,
  PricingRuleType,
} from "@/lib/types";
import {
  correctOCRText,
  parseStructuredMenu,
  parseMenuText,
  saveMenuVersion,
  updateMenuVersion,
  getSavedMenus,
  loadMenuVersion,
  processMenuWithAI,
  getGeminiApiKey,
  saveGeminiApiKey,
  getSelectedAIModel,
  saveSelectedAIModel,
  AVAILABLE_MODELS,
  exportMenuToFile,
  exportMenuToClipboard,
  importMenuFromClipboard,
  importMenuFromFile,
  generateAIPrompt,
} from "@/lib/utils";
import type { SavedMenuVersion } from "@/lib/types";

function splitImageInHalf(file: File): Promise<[File, File]> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas1 = document.createElement("canvas");
      const canvas2 = document.createElement("canvas");
      const ctx1 = canvas1.getContext("2d");
      const ctx2 = canvas2.getContext("2d");

      if (!ctx1 || !ctx2) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      const halfWidth = Math.floor(img.width / 2);

      // Left half
      canvas1.width = halfWidth;
      canvas1.height = img.height;
      ctx1.drawImage(
        img,
        0,
        0,
        halfWidth,
        img.height,
        0,
        0,
        halfWidth,
        img.height,
      );

      // Right half
      canvas2.width = img.width - halfWidth;
      canvas2.height = img.height;
      ctx2.drawImage(
        img,
        halfWidth,
        0,
        img.width - halfWidth,
        img.height,
        0,
        0,
        img.width - halfWidth,
        img.height,
      );

      Promise.all([
        new Promise<File>((res, rej) => {
          canvas1.toBlob((blob) => {
            if (!blob) {
              rej(new Error("Failed to create left half blob"));
              return;
            }
            res(new File([blob], "left-half.png", { type: "image/png" }));
          }, "image/png");
        }),
        new Promise<File>((res, rej) => {
          canvas2.toBlob((blob) => {
            if (!blob) {
              rej(new Error("Failed to create right half blob"));
              return;
            }
            res(new File([blob], "right-half.png", { type: "image/png" }));
          }, "image/png");
        }),
      ])
        .then(resolve)
        .catch(reject);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };

    img.src = url;
  });
}

const STEPS = [
  { id: 1, title: "Upload de Imagem", description: "Selecione a imagem do cardápio" },
  { id: 2, title: "Escanear com OCR", description: "Extraia o texto da imagem" },
  { id: 3, title: "Processar com IA", description: "Melhore o texto com IA (opcional)" },
  { id: 4, title: "Revisar Itens", description: "Edite os itens do cardápio" },
  { id: 5, title: "Configurar Preços", description: "Defina as regras de preço" },
  { id: 6, title: "Salvar Cardápio", description: "Nomeie e salve o cardápio" },
];

function StepIndicator({
  currentStep,
  completedSteps,
  onStepClick,
}: {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur-sm py-4 border-b border-zinc-200 dark:bg-black/95 dark:border-zinc-800">
      <div className="relative flex items-center justify-between gap-2 overflow-x-auto pb-2">
        {STEPS.map((step, index) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = currentStep === step.id;
          // Only current step is clickable
          const isClickable = isCurrent;

          return (
            <div
              key={step.id}
              className="relative flex flex-col items-center gap-1 min-w-[100px] flex-shrink-0 flex-1"
            >
              {index < STEPS.length - 1 && (
                <div
                  className={`absolute top-5 left-[60px] right-[-60px] h-0.5 ${
                    isCompleted
                      ? "bg-green-500"
                      : isCurrent
                        ? "bg-zinc-300 dark:bg-zinc-700"
                        : "bg-zinc-200 dark:bg-zinc-800"
                  }`}
                />
              )}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step.id)}
                disabled={!isClickable}
                className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                  isCurrent
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : isCompleted
                      ? "border-green-500 bg-green-500 text-white opacity-60"
                      : "border-zinc-200 bg-white text-zinc-400 opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600"
                } ${isClickable ? "cursor-pointer hover:scale-105" : "cursor-not-allowed"}`}
              >
                {isCompleted && !isCurrent ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <span className="text-sm font-semibold">{step.id}</span>
                )}
              </button>
              <div className="text-center">
                <p
                  className={`text-xs font-medium ${
                    isCurrent
                      ? "text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-400 dark:text-zinc-600 opacity-60"
                  }`}
                >
                  {step.title}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MenuCreatePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [savedMenus, setSavedMenus] = useState(getSavedMenus());
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [saveMenuName, setSaveMenuName] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showApiKeyConfig, setShowApiKeyConfig] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("gemini-2.5-flash-lite");
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const stepRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Generate prompt preview when rawText changes
  const aiPrompt = rawText.trim() ? generateAIPrompt(rawText) : null;

  // Load menu from URL params if editing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const menuId = params.get("id");
    if (menuId) {
      const menu = loadMenuVersion(menuId);
      if (menu) {
        setMenuItems(menu.items);
        setPricingRules(menu.pricingRules);
        setSelectedMenuId(menuId);
        setSaveMenuName(menu.name);
        // Mark steps as completed when editing existing menu
        setCompletedSteps(new Set([1, 2, 3, 4, 5]));
        setCurrentStep(6);
      }
    }
  }, []);

  // Load Gemini API key and model from localStorage
  useEffect(() => {
    const savedKey = getGeminiApiKey();
    if (savedKey) {
      setGeminiApiKey(savedKey);
    }
    const savedModel = getSelectedAIModel();
    setSelectedModelId(savedModel);
  }, []);

  const scrollToStep = useCallback((step: number, immediate = false) => {
    setCurrentStep(step);
    
    // Use requestAnimationFrame to ensure DOM is updated
    requestAnimationFrame(() => {
      const element = stepRefs.current[step];
      if (element) {
        const scrollFn = () => {
          const headerOffset = 140; // Offset for sticky header + padding
          const elementPosition = element.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          
          window.scrollTo({
            top: Math.max(0, offsetPosition),
            behavior: "smooth"
          });
        };
        
        if (immediate) {
          scrollFn();
        } else {
          // Double requestAnimationFrame to ensure layout is complete
          requestAnimationFrame(() => {
            requestAnimationFrame(scrollFn);
          });
        }
      }
    });
  }, []);

  const markStepComplete = useCallback((step: number) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
  }, []);

  const goToNextStep = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    if (currentStep < STEPS.length) {
      const nextStep = currentStep + 1;
      scrollToStep(nextStep);
    }
  }, [currentStep, scrollToStep]);

  const goToPreviousStep = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    if (currentStep > 1) {
      const prevStep = currentStep - 1;
      scrollToStep(prevStep);
    }
  }, [currentStep, scrollToStep]);

  // Validation functions
  const isStepComplete = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 1:
          return imageFile !== null;
        case 2:
          return rawText.trim().length > 0;
        case 3:
          return true; // Optional step
        case 4:
          return menuItems.length > 0;
        case 5:
          return pricingRules.length > 0;
        case 6:
          return saveMenuName.trim().length > 0 && menuItems.length > 0;
        default:
          return false;
      }
    },
    [imageFile, rawText, menuItems, pricingRules, saveMenuName],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setImageFile(file);
      setRawText("");
      setMenuItems([]);
      setPricingRules([]);
      setError(null);
      setSelectedMenuId(null);
      setCompletedSteps(new Set());

      const url = URL.createObjectURL(file);
      setImagePreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return url;
      });

      // Mark step 1 as complete
      markStepComplete(1);
    },
    [markStepComplete, scrollToStep],
  );

  const handleScan = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    if (!imageFile) {
      setError("Por favor, envie uma imagem do cardápio primeiro.");
      return;
    }

    setIsScanning(true);
    setScanProgress(0);
    setError(null);

    try {
      const [leftHalf, rightHalf] = await splitImageInHalf(imageFile);

      const worker1 = await createWorker("por+eng", 1, {
        logger: (m) => {
          if (
            m.status === "recognizing text" &&
            typeof m.progress === "number"
          ) {
            setScanProgress(Math.round(m.progress * 50));
          }
        },
      });
      const leftResult = await worker1.recognize(leftHalf);
      const leftText = leftResult.data.text;
      await worker1.terminate();

      const worker2 = await createWorker("por+eng", 1, {
        logger: (m) => {
          if (
            m.status === "recognizing text" &&
            typeof m.progress === "number"
          ) {
            setScanProgress(50 + Math.round(m.progress * 50));
          }
        },
      });
      const rightResult = await worker2.recognize(rightHalf);
      const rightText = rightResult.data.text;
      await worker2.terminate();

      const combined = `${leftText.trim()}\n\n${rightText.trim()}`.trim();
      const corrected = correctOCRText(combined);
      setRawText(corrected);

      const parsed = parseMenuText(corrected);
      setMenuItems(parsed);
      setPricingRules([]);

      // Mark step 2 as complete
      markStepComplete(2);
    } catch (e) {
      setError("Falha ao executar OCR. Tente outra imagem ou atualize a página.");
      console.error(e);
    } finally {
      setIsScanning(false);
      setScanProgress(100);
    }
  }, [imageFile, markStepComplete, scrollToStep]);

  const handleProcessWithAI = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    if (!rawText.trim()) {
      setError(
        "Não há texto OCR para processar. Por favor, escaneie um cardápio primeiro.",
      );
      return;
    }

    setIsProcessingAI(true);
    setError(null);

    try {
      const corrected = correctOCRText(rawText);
      const apiKey = geminiApiKey || getGeminiApiKey();
      const result = await processMenuWithAI(
        corrected,
        apiKey || undefined,
        selectedModelId,
      );

      setRawText(result.cleanedText || corrected);

      if (result.structured && result.data) {
        const menuData = parseStructuredMenu(result.data);
        setMenuItems(menuData.items);
        setPricingRules(menuData.pricingRules);
      } else {
        const parsed = parseMenuText(result.cleanedText || corrected);
        setMenuItems(parsed);
        setPricingRules([]);
      }

      // Mark step 3 as complete
      markStepComplete(3);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Falha ao processar com IA";
      setError(message);
      console.error(e);
    } finally {
      setIsProcessingAI(false);
    }
  }, [rawText, geminiApiKey, selectedModelId, markStepComplete, scrollToStep]);

  const handleSaveApiKey = useCallback(() => {
    if (geminiApiKey.trim()) {
      saveGeminiApiKey(geminiApiKey.trim());
      setShowApiKeyConfig(false);
      setError(null);
    } else {
      setError("Por favor, insira uma API key válida.");
    }
  }, [geminiApiKey]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    saveSelectedAIModel(modelId);
  }, []);

  const handleExportMenu = useCallback(
    async (toClipboard: boolean) => {
      if (menuItems.length === 0) {
        setError("Não há cardápio para exportar.");
        return;
      }

      setIsExporting(true);
      setError(null);

      try {
        const menu: SavedMenuVersion = {
          id: selectedMenuId || `temp-${Date.now()}`,
          name: saveMenuName || "Cardápio sem nome",
          createdAt: new Date().toISOString(),
          items: menuItems,
          pricingRules: pricingRules,
        };

        if (toClipboard) {
          await exportMenuToClipboard(menu);
          setError(null);
          const originalError = error;
          setError("Cardápio copiado para a área de transferência!");
          setTimeout(() => setError(originalError), 2000);
        } else {
          exportMenuToFile(menu);
        }
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Falha ao exportar cardápio";
        setError(message);
      } finally {
        setIsExporting(false);
      }
    },
    [menuItems, pricingRules, selectedMenuId, saveMenuName, error],
  );

  const handleImportMenu = useCallback(
    async (fromClipboard: boolean) => {
      setIsImporting(true);
      setError(null);

      try {
        let menu: SavedMenuVersion;

        if (fromClipboard) {
          menu = await importMenuFromClipboard();
        } else {
          setIsImporting(false);
          return;
        }

        setMenuItems(menu.items);
        setPricingRules(menu.pricingRules);
        setSaveMenuName(menu.name);
        setSelectedMenuId(null);
        setCompletedSteps(new Set([1, 2, 3, 4, 5]));
        setCurrentStep(6);

        setError(null);
        const originalError = error;
        setError("Cardápio importado com sucesso!");
        setTimeout(() => {
          setError(originalError);
          scrollToStep(6);
        }, 500);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Falha ao importar cardápio";
        setError(message);
      } finally {
        setIsImporting(false);
      }
    },
    [error, scrollToStep],
  );

  const handleFileImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      setError(null);

      try {
        const menu = await importMenuFromFile(file);
        setMenuItems(menu.items);
        setPricingRules(menu.pricingRules);
        setSaveMenuName(menu.name);
        setSelectedMenuId(null);
        setCompletedSteps(new Set([1, 2, 3, 4, 5]));
        setCurrentStep(6);

        setError(null);
        const originalError = error;
        setError("Cardápio importado com sucesso!");
        setTimeout(() => {
          setError(originalError);
          scrollToStep(6);
        }, 500);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Falha ao importar cardápio";
        setError(message);
      } finally {
        setIsImporting(false);
        event.target.value = "";
      }
    },
    [error, scrollToStep],
  );

  const handleCopyPrompt = useCallback(() => {
    const prompt = rawText.trim() ? generateAIPrompt(rawText) : null;
    if (prompt) {
      navigator.clipboard.writeText(prompt).then(() => {
        const originalError = error;
        setError("Prompt copiado para a área de transferência!");
        setTimeout(() => setError(originalError), 2000);
      }).catch(() => {
        setError("Falha ao copiar prompt.");
      });
    }
  }, [rawText, error]);

  const handleSaveMenu = useCallback(() => {
    if (!saveMenuName.trim()) {
      setError("Por favor, informe um nome para o cardápio.");
      return;
    }
    if (menuItems.length === 0) {
      setError("Não há itens para salvar.");
      return;
    }

    if (selectedMenuId) {
      updateMenuVersion(selectedMenuId, saveMenuName.trim(), menuItems, pricingRules);
      setSavedMenus(getSavedMenus());
      setError(null);
      router.push(`/menu/?id=${selectedMenuId}`);
    } else {
      const id = saveMenuVersion(saveMenuName.trim(), menuItems, pricingRules);
      setSavedMenus(getSavedMenus());
      setError(null);
      router.push(`/menu/?id=${id}`);
    }
  }, [saveMenuName, menuItems, pricingRules, selectedMenuId, router]);

  const updateItem = useCallback((id: string, updates: Partial<MenuItem>) => {
    setMenuItems((items) =>
      items.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    );
  }, []);

  const updateRule = useCallback(
    (id: string, updates: Partial<PricingRule>) => {
      setPricingRules((rules) =>
        rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)),
      );
    },
    [],
  );

  const addItem = useCallback(() => {
    const newItem: MenuItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: "Novo item",
      category: "FIT",
    };
    setMenuItems((items) => [...items, newItem]);
  }, []);

  const addRule = useCallback(() => {
    const newRule: PricingRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      category: "FIT",
      type: "UNITARY",
      price: 0,
    };
    setPricingRules((rules) => [...rules, newRule]);
  }, []);

  const deleteItem = useCallback((id: string) => {
    setMenuItems((items) => items.filter((item) => item.id !== id));
  }, []);

  const deleteRule = useCallback((id: string) => {
    setPricingRules((rules) => rules.filter((rule) => rule.id !== id));
  }, []);

  // Auto-advance when steps are completed
  useEffect(() => {
    if (isStepComplete(4) && currentStep === 4 && !completedSteps.has(4)) {
      markStepComplete(4);
    }
    if (isStepComplete(5) && currentStep === 5 && !completedSteps.has(5)) {
      markStepComplete(5);
    }
  }, [menuItems, pricingRules, currentStep, completedSteps, isStepComplete, markStepComplete]);

  const StepCard = ({
    step,
    children,
  }: {
    step: number;
    children: React.ReactNode;
  }) => {
    const isActive = currentStep === step;
    const isCompleted = completedSteps.has(step);
    const isPast = step < currentStep;

    return (
      <div
        ref={(el) => {
          stepRefs.current[step] = el;
        }}
        id={`step-${step}`}
        className={`rounded-2xl border-2 p-6 shadow-sm transition-all ${
          isActive
            ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-950"
            : "border-zinc-200 bg-white opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {STEPS[step - 1].title}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {STEPS[step - 1].description}
            </p>
          </div>
          {isCompleted && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          )}
        </div>
        {children}
        <div className="mt-6 flex items-center justify-between gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={goToPreviousStep}
            disabled={currentStep === 1}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            ← Voltar
          </button>
          {step < STEPS.length && (
            <button
              type="button"
              onClick={goToNextStep}
              disabled={!isStepComplete(step)}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Próximo passo →
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 sm:px-8">
        <header className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Criar Cardápio
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                Siga os passos para criar seu cardápio de forma simples e rápida.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              ← Voltar
            </button>
          </div>
        </header>

        <StepIndicator
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={scrollToStep}
        />

        {/* Import Option - Before Steps */}
        <div className="mt-6 mb-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Já tem um cardápio em JSON?
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Importe diretamente e pule os passos de criação
              </p>
            </div>
            <div className="flex gap-2">
              <label className="cursor-pointer rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                {isImporting ? "Importando..." : "📤 Importar arquivo"}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileImport}
                  className="hidden"
                  disabled={isImporting}
                />
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleImportMenu(true);
                }}
                disabled={isImporting}
                className="rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 disabled:opacity-50"
              >
                {isImporting ? "Importando..." : "📋 Colar JSON"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-8 pb-12">
          {/* Step 1: Upload Image */}
          <StepCard step={1}>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 px-4 py-12 text-center text-sm text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:border-zinc-500">
              <span className="rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">
                Clique para escolher uma imagem
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {imagePreviewUrl && (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  Pré-visualização
                </p>
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="relative aspect-[4/5] w-full">
                    <Image
                      src={imagePreviewUrl}
                      alt="Pré-visualização do cardápio"
                      fill
                      className="object-contain"
                    />
                  </div>
                </div>
              </div>
            )}
          </StepCard>

          {/* Step 2: OCR Scan */}
          <StepCard step={2}>
            {!imageFile ? (
              <p className="text-sm text-zinc-500">
                Primeiro, faça upload de uma imagem no passo anterior.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleScan(e);
                  }}
                  disabled={!imageFile || isScanning}
                  className="inline-flex w-full items-center justify-center rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-500/40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                >
                  {isScanning ? "Escaneando cardápio…" : "Escanear cardápio com OCR"}
                </button>

                {isScanning && (
                  <div className="mt-4 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <div className="flex items-center justify-between">
                      <span>Reconhecendo texto…</span>
                      <span>{scanProgress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-zinc-100"
                        style={{ width: `${scanProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {rawText && (
                  <div className="mt-4">
                    <label className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Texto extraído:
                    </label>
                    <textarea
                      value={rawText}
                      onChange={(e) => {
                        e.stopPropagation();
                        setRawText(e.target.value);
                        if (pricingRules.length === 0) {
                          const parsed = parseMenuText(e.target.value);
                          setMenuItems(parsed);
                        }
                      }}
                      onFocus={(e) => {
                        e.stopPropagation();
                      }}
                      className="h-32 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-800 outline-none ring-0 ring-zinc-900/5 transition focus:border-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
                      spellCheck={false}
                    />
                  </div>
                )}
              </>
            )}
          </StepCard>

          {/* Step 3: AI Processing */}
          <StepCard step={3}>
            {!rawText ? (
              <p className="text-sm text-zinc-500">
                Primeiro, escaneie a imagem no passo anterior.
              </p>
            ) : (
              <>
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>Opcional:</strong> Use IA para melhorar e estruturar o texto extraído. Isso pode ajudar a organizar melhor os itens do cardápio.
                  </p>
                </div>

                {!getGeminiApiKey() && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                    <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
                      Para usar IA, configure sua API key do Gemini:
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowApiKeyConfig(!showApiKeyConfig);
                      }}
                      className="rounded-lg border border-amber-500 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
                    >
                      {showApiKeyConfig ? "Ocultar" : "Configurar API Key"}
                    </button>
                    {showApiKeyConfig && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            Modelo de IA
                          </label>
                          <select
                            value={selectedModelId}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleModelChange(e.target.value);
                            }}
                            onFocus={(e) => {
                              e.stopPropagation();
                            }}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          >
                            {AVAILABLE_MODELS.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            API Key do Gemini
                          </label>
                          <input
                            type="password"
                            value={geminiApiKey}
                            onChange={(e) => {
                              e.stopPropagation();
                              setGeminiApiKey(e.target.value);
                            }}
                            onFocus={(e) => {
                              e.stopPropagation();
                            }}
                            placeholder="Insira sua API key do Gemini"
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveApiKey();
                              }
                            }}
                          />
                          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                            Obtenha uma API key gratuita em{" "}
                            <a
                              href="https://makersuite.google.com/app/apikey"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
                            >
                              Google AI Studio
                            </a>
                            .
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSaveApiKey();
                          }}
                          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                        >
                          Salvar API Key
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {getGeminiApiKey() && (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      {aiPrompt && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowPromptDialog(true);
                          }}
                          className="rounded-lg border border-purple-500 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400"
                        >
                          👁️ Ver Prompt
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleProcessWithAI(e);
                        }}
                        disabled={isProcessingAI || !rawText.trim()}
                        className="flex-1 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-blue-500 dark:hover:bg-blue-600"
                      >
                        {isProcessingAI ? "Processando…" : "✨ Processar com IA"}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Modelo: {AVAILABLE_MODELS.find((m) => m.id === selectedModelId)?.name || selectedModelId}
                    </p>
                  </>
                )}

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      goToNextStep(e);
                    }}
                    className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    Pular este passo
                  </button>
                </div>
              </>
            )}
          </StepCard>

          {/* Step 4: Review Items */}
          <StepCard step={4}>
            {menuItems.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nenhum item encontrado. Escaneie uma imagem ou adicione itens manualmente.
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {menuItems.length} {menuItems.length === 1 ? "item encontrado" : "itens encontrados"}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      addItem();
                    }}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    + Adicionar item
                  </button>
                </div>
                <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                  {menuItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateItem(item.id, { name: e.target.value });
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                          }}
                          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                          placeholder="Nome do item"
                        />
                        <select
                          value={item.category}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateItem(item.id, {
                              category: e.target.value as MenuCategory,
                            });
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                          }}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="FIT">FIT</option>
                          <option value="LOWCARB">LOWCARB</option>
                          <option value="CALDOS">CALDOS</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteItem(item.id);
                        }}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                      >
                        Deletar
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </StepCard>

          {/* Step 5: Configure Pricing */}
          <StepCard step={5}>
            <div className="mb-4">
              <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
                Configure as regras de preço para calcular valores automaticamente.
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addRule();
                }}
                className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                + Adicionar regra
              </button>
            </div>
            {pricingRules.length === 0 ? (
              <p className="text-sm text-zinc-500">
                Nenhuma regra de preço configurada. Adicione pelo menos uma regra para continuar.
              </p>
            ) : (
              <div className="space-y-3">
                {pricingRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={rule.category}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateRule(rule.id, {
                              category: e.target.value as MenuCategory,
                            });
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                          }}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <option value="FIT">FIT</option>
                          <option value="LOWCARB">LOWCARB</option>
                          <option value="CALDOS">CALDOS</option>
                        </select>
                        <select
                          value={rule.type}
                          onChange={(e) => {
                            e.stopPropagation();
                            const newType = e.target.value as PricingRuleType;
                            updateRule(rule.id, {
                              type: newType,
                              quantity:
                                newType === "QUANTITY_COMBO" ? 10 : undefined,
                              mixQuantities:
                                newType === "MIXED_COMBO"
                                  ? [
                                      { category: "FIT", quantity: 5 },
                                      { category: "LOWCARB", quantity: 5 },
                                    ]
                                  : undefined,
                            });
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                          }}
                          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <option value="UNITARY">Unitário</option>
                          <option value="QUANTITY_COMBO">
                            Combo por quantidade
                          </option>
                          <option value="MIXED_COMBO">Combo misto</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.01"
                          value={rule.price}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateRule(rule.id, {
                              price: Number.parseFloat(e.target.value) || 0,
                            });
                          }}
                          onFocus={(e) => {
                            e.stopPropagation();
                          }}
                          placeholder="Preço"
                          className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                        />
                        {rule.type === "QUANTITY_COMBO" && (
                          <input
                            type="number"
                            value={rule.quantity || ""}
                            onChange={(e) => {
                              e.stopPropagation();
                              updateRule(rule.id, {
                                quantity:
                                  Number.parseInt(e.target.value, 10) ||
                                  undefined,
                              });
                            }}
                            onFocus={(e) => {
                              e.stopPropagation();
                            }}
                            placeholder="Quantidade"
                            className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                          />
                        )}
                      </div>
                      {rule.type === "MIXED_COMBO" && rule.mixQuantities && (
                        <div className="space-y-1">
                          {rule.mixQuantities.map((mix, idx) => (
                            <div key={idx} className="flex gap-2">
                              <select
                                value={mix.category}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const newMix = [...rule.mixQuantities!];
                                  newMix[idx].category = e.target
                                    .value as MenuCategory;
                                  updateRule(rule.id, {
                                    mixQuantities: newMix,
                                  });
                                }}
                                onFocus={(e) => {
                                  e.stopPropagation();
                                }}
                                className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                              >
                                <option value="FIT">FIT</option>
                                <option value="LOWCARB">LOWCARB</option>
                                <option value="CALDOS">CALDOS</option>
                              </select>
                              <input
                                type="number"
                                value={mix.quantity}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const newMix = [...rule.mixQuantities!];
                                  newMix[idx].quantity =
                                    Number.parseInt(e.target.value, 10) || 0;
                                  updateRule(rule.id, {
                                    mixQuantities: newMix,
                                  });
                                }}
                                onFocus={(e) => {
                                  e.stopPropagation();
                                }}
                                placeholder="Qtd"
                                className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteRule(rule.id);
                        }}
                        className="w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                      >
                        Deletar regra
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </StepCard>

          {/* Step 6: Save Menu */}
          <StepCard step={6}>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Nome do cardápio
                </label>
                <input
                  type="text"
                  value={saveMenuName}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSaveMenuName(e.target.value);
                  }}
                  onFocus={(e) => {
                    e.stopPropagation();
                  }}
                  placeholder="Ex: Cardápio Semana 1"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveMenu();
                    }
                  }}
                />
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Resumo:
                </p>
                <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  <li>{menuItems.length} {menuItems.length === 1 ? "item" : "itens"}</li>
                  <li>{pricingRules.length} {pricingRules.length === 1 ? "regra de preço" : "regras de preço"}</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSaveMenu();
                  }}
                  disabled={!isStepComplete(6)}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
                >
                  Salvar Cardápio
                </button>
                {menuItems.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleExportMenu(false);
                      }}
                      disabled={isExporting}
                      className="rounded-lg border border-blue-500 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 disabled:opacity-50"
                    >
                      {isExporting ? "..." : "📥"}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleExportMenu(true);
                      }}
                      disabled={isExporting}
                      className="rounded-lg border border-purple-500 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400 disabled:opacity-50"
                    >
                      {isExporting ? "..." : "📋"}
                    </button>
                  </>
                )}
              </div>

              <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <label className="cursor-pointer rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400">
                  {isImporting ? "Importando..." : "📤 Importar"}
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileImport}
                    className="hidden"
                    disabled={isImporting}
                  />
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleImportMenu(true);
                  }}
                  disabled={isImporting}
                  className="rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 disabled:opacity-50"
                >
                  {isImporting ? "Importando..." : "📋 Colar JSON"}
                </button>
              </div>
            </div>
          </StepCard>
        </div>

        {/* Error Message */}
        {error && (
          <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {error}
            </p>
          </div>
        )}

        {/* Prompt Dialog */}
        {showPromptDialog && aiPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 max-h-[80vh] w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Prompt que será enviado para a IA</h3>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCopyPrompt();
                    }}
                    className="rounded-lg border border-purple-500 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400"
                  >
                    📋 Copiar
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowPromptDialog(false);
                    }}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    Fechar
                  </button>
                </div>
              </div>
              <textarea
                value={aiPrompt}
                readOnly
                className="h-[60vh] w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-mono leading-relaxed text-zinc-800 outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                spellCheck={false}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
