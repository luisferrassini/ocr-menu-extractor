"use client";

import { useCallback, useState, useEffect } from "react";
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
} from "@/lib/utils";

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

export default function MenuCreatePage() {
  const router = useRouter();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [isEditMode, setIsEditMode] = useState(true);
  const [savedMenus, setSavedMenus] = useState(getSavedMenus());
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveMenuName, setSaveMenuName] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showApiKeyConfig, setShowApiKeyConfig] = useState(false);

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
      }
    }
  }, []);

  // Load Gemini API key from localStorage
  useEffect(() => {
    const savedKey = getGeminiApiKey();
    if (savedKey) {
      setGeminiApiKey(savedKey);
    }
  }, []);

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

      const url = URL.createObjectURL(file);
      setImagePreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return url;
      });
    },
    [],
  );

  const handleScan = useCallback(async () => {
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
    } catch (e) {
      setError("Falha ao executar OCR. Tente outra imagem ou atualize a página.");
      console.error(e);
    } finally {
      setIsScanning(false);
      setScanProgress(100);
    }
  }, [imageFile]);

  const handleProcessWithAI = useCallback(async () => {
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
      const result = await processMenuWithAI(corrected, apiKey || undefined);
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
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Falha ao processar com IA";
      setError(message);
      console.error(e);
    } finally {
      setIsProcessingAI(false);
    }
  }, [rawText, geminiApiKey]);

  const handleSaveApiKey = useCallback(() => {
    if (geminiApiKey.trim()) {
      saveGeminiApiKey(geminiApiKey.trim());
      setShowApiKeyConfig(false);
      setError(null);
    } else {
      setError("Por favor, insira uma API key válida.");
    }
  }, [geminiApiKey]);

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
      // Atualiza cardápio existente
      updateMenuVersion(selectedMenuId, saveMenuName.trim(), menuItems, pricingRules);
      setSavedMenus(getSavedMenus());
      setShowSaveDialog(false);
      setSaveMenuName("");
      setError(null);
      router.push(`/menu/${selectedMenuId}`);
    } else {
      // Cria novo cardápio
      const id = saveMenuVersion(saveMenuName.trim(), menuItems, pricingRules);
      setSavedMenus(getSavedMenus());
      setShowSaveDialog(false);
      setSaveMenuName("");
      setSelectedMenuId(id);
      setError(null);
      router.push(`/menu/${id}`);
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

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Criar/Editar Cardápio
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Faça upload de uma foto do cardápio, escaneie com OCR e configure
            os itens e preços.
          </p>
        </header>

        {/* Menu Selector */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cardápio:
            </label>
            <select
              value={selectedMenuId || ""}
              onChange={(e) => {
                if (e.target.value) {
                  const menu = loadMenuVersion(e.target.value);
                  if (menu) {
                    setMenuItems(menu.items);
                    setPricingRules(menu.pricingRules);
                    setSelectedMenuId(e.target.value);
                    setSaveMenuName(menu.name);
                  }
                } else {
                  setMenuItems([]);
                  setPricingRules([]);
                  setSelectedMenuId(null);
                  setSaveMenuName("");
                }
              }}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <option value="">Novo cardápio</option>
              {savedMenus.map((menu) => (
                <option key={menu.id} value={menu.id}>
                  {menu.name} ({new Date(menu.createdAt).toLocaleDateString("pt-BR")})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setIsEditMode(!isEditMode)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                isEditMode
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                  : "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {isEditMode ? "Sair da Edição" : "Editar Cardápio"}
            </button>
            {menuItems.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSaveDialog(true)}
                className="rounded-lg border border-green-500 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
              >
                Salvar Cardápio
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              ← Voltar
            </button>
          </div>
        </div>

        {/* Save Dialog */}
        {showSaveDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="mb-4 text-lg font-semibold">Salvar Cardápio</h3>
              <input
                type="text"
                value={saveMenuName}
                onChange={(e) => setSaveMenuName(e.target.value)}
                placeholder="Nome do cardápio"
                className="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveMenu();
                  } else if (e.key === "Escape") {
                    setShowSaveDialog(false);
                  }
                }}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveMenu}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveDialog(false);
                  }}
                  className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="space-y-6">
            {/* API Key Configuration */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Configuração da API Gemini
                </h2>
                <button
                  type="button"
                  onClick={() => setShowApiKeyConfig(!showApiKeyConfig)}
                  className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  {showApiKeyConfig ? "Ocultar" : "Configurar"}
                </button>
              </div>
              {showApiKeyConfig && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      API Key do Gemini
                    </label>
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="Insira sua API key do Gemini"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
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
                      . A API key é salva localmente no seu navegador.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveApiKey}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    Salvar API Key
                  </button>
                </div>
              )}
              {!showApiKeyConfig && getGeminiApiKey() && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  ✓ API key configurada
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                1. Enviar imagem do cardápio
              </h2>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 px-4 py-8 text-center text-sm text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:border-zinc-500">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">
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
                <div className="mt-4 space-y-2">
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

              <button
                type="button"
                onClick={handleScan}
                disabled={!imageFile || isScanning}
                className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-500/40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                {isScanning ? "Escaneando cardápio…" : "Escanear cardápio com OCR"}
              </button>

              {isScanning && (
                <div className="mt-3 space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
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

              {error && (
                <p className="mt-3 text-xs font-medium text-red-500">{error}</p>
              )}
            </div>

            {rawText && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                    Texto OCR bruto
                  </h2>
                  <button
                    type="button"
                    onClick={handleProcessWithAI}
                    disabled={isProcessingAI || !rawText.trim()}
                    className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    {isProcessingAI ? "Processando…" : "✨ Limpar com IA"}
                  </button>
                </div>
                <textarea
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    if (pricingRules.length === 0) {
                      const parsed = parseMenuText(e.target.value);
                      setMenuItems(parsed);
                    }
                  }}
                  className="h-44 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-800 outline-none ring-0 ring-zinc-900/5 transition focus:border-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          <div className="space-y-6">
            {/* Items Section */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Itens do cardápio
                </h2>
                {isEditMode && (
                  <button
                    type="button"
                    onClick={addItem}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    + Adicionar
                  </button>
                )}
              </div>

              {menuItems.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Adicione itens ao cardápio ou escaneie uma imagem.
                </p>
              ) : (
                <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                  {menuItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex w-full flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      {isEditMode ? (
                        <>
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) =>
                                updateItem(item.id, { name: e.target.value })
                              }
                              className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                            />
                            <select
                              value={item.category}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  category: e.target.value as MenuCategory,
                                })
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                            >
                              <option value="FIT">FIT</option>
                              <option value="LOWCARB">LOWCARB</option>
                              <option value="CALDOS">CALDOS</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteItem(item.id)}
                            className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                          >
                            Deletar
                          </button>
                        </>
                      ) : (
                        <div>
                          <p className="text-base font-medium">{item.name}</p>
                          <p className="text-xs text-zinc-500">{item.category}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pricing Rules Section */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Regras de preço
                </h2>
                {isEditMode && (
                  <button
                    type="button"
                    onClick={addRule}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    + Adicionar
                  </button>
                )}
              </div>
              <div className="space-y-2 text-xs">
                {pricingRules.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Adicione regras de preço para calcular valores.
                  </p>
                ) : (
                  pricingRules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      {isEditMode ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={rule.category}
                              onChange={(e) =>
                                updateRule(rule.id, {
                                  category: e.target.value as MenuCategory,
                                })
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                            >
                              <option value="FIT">FIT</option>
                              <option value="LOWCARB">LOWCARB</option>
                              <option value="CALDOS">CALDOS</option>
                            </select>
                            <select
                              value={rule.type}
                              onChange={(e) => {
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
                              onChange={(e) =>
                                updateRule(rule.id, {
                                  price: Number.parseFloat(e.target.value) || 0,
                                })
                              }
                              placeholder="Preço"
                              className="flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            {rule.type === "QUANTITY_COMBO" && (
                              <input
                                type="number"
                                value={rule.quantity || ""}
                                onChange={(e) =>
                                  updateRule(rule.id, {
                                    quantity:
                                      Number.parseInt(e.target.value, 10) ||
                                      undefined,
                                  })
                                }
                                placeholder="Quantidade"
                                className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                              />
                            )}
                          </div>
                          {rule.type === "MIXED_COMBO" &&
                            rule.mixQuantities && (
                              <div className="space-y-1">
                                {rule.mixQuantities.map((mix, idx) => (
                                  <div key={idx} className="flex gap-2">
                                    <select
                                      value={mix.category}
                                      onChange={(e) => {
                                        const newMix = [
                                          ...rule.mixQuantities!,
                                        ];
                                        newMix[idx].category = e.target
                                          .value as MenuCategory;
                                        updateRule(rule.id, {
                                          mixQuantities: newMix,
                                        });
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
                                        const newMix = [
                                          ...rule.mixQuantities!,
                                        ];
                                        newMix[idx].quantity =
                                          Number.parseInt(e.target.value, 10) ||
                                          0;
                                        updateRule(rule.id, {
                                          mixQuantities: newMix,
                                        });
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
                            onClick={() => deleteRule(rule.id)}
                            className="w-full rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                          >
                            Deletar regra
                          </button>
                        </div>
                      ) : (
                        <div>
                          <p className="font-medium">
                            {rule.category} -{" "}
                            {rule.type === "UNITARY" && "Unitário"}
                            {rule.type === "QUANTITY_COMBO" &&
                              `Combo ${rule.quantity} unidades`}
                            {rule.type === "MIXED_COMBO" &&
                              `Combo ${rule.mixQuantities
                                ?.map((m) => `${m.quantity}x ${m.category}`)
                                .join(" + ")}`}
                          </p>
                          <p className="text-zinc-600 dark:text-zinc-400">
                            R$ {rule.price.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
