"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  MenuItem,
  PricingRule,
  ParsedSelection,
  MenuCategory,
} from "@/lib/types";
import {
  loadMenuVersion,
  calculateBestPrice,
  getSavedMenus,
  deleteMenuVersion,
} from "@/lib/utils";

export default function MenuViewPage() {
  const params = useParams();
  const router = useRouter();
  const menuId = params.id as string;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [menuName, setMenuName] = useState("");
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [formattedOutput, setFormattedOutput] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const menu = loadMenuVersion(menuId);
    if (menu) {
      setMenuItems(menu.items);
      setPricingRules(menu.pricingRules);
      setMenuName(menu.name);
    } else {
      setError("Cardápio não encontrado");
    }
  }, [menuId]);

  const toggleSelection = useCallback((itemId: string) => {
    setSelections((current) => {
      const existingQty = current[itemId] ?? 0;
      if (existingQty === 0) {
        return { ...current, [itemId]: 1 };
      }
      const updated = { ...current };
      delete updated[itemId];
      return updated;
    });
  }, []);

  const updateQuantity = useCallback((itemId: string, quantity: number) => {
    setSelections((current) => {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        const updated = { ...current };
        delete updated[itemId];
        return updated;
      }
      return { ...current, [itemId]: Math.floor(quantity) };
    });
  }, []);

  const selectionList: ParsedSelection[] = useMemo(
    () =>
      menuItems
        .map((item) => ({
          item,
          quantity: selections[item.id] ?? 0,
        }))
        .filter((entry) => entry.quantity > 0),
    [menuItems, selections],
  );

  const priceCalculation = useMemo(() => {
    if (pricingRules.length === 0) {
      return { total: 0, appliedCombos: [], breakdown: [] };
    }
    return calculateBestPrice(selections, menuItems, pricingRules);
  }, [selections, menuItems, pricingRules]);

  const unitaryPrices = useMemo(() => {
    const unitaryRules = pricingRules.filter((r) => r.type === "UNITARY");
    const prices: Record<MenuCategory, number> = {
      FIT: 0,
      LOWCARB: 0,
      CALDOS: 0,
    };
    unitaryRules.forEach((rule) => {
      prices[rule.category] = rule.price;
    });
    return prices;
  }, [pricingRules]);

  const handleGenerateOutput = useCallback(() => {
    if (selectionList.length === 0) {
      setError("Selecione pelo menos um item do cardápio.");
      return;
    }

    setError(null);

    const lines: string[] = [];
    lines.push("Pedido");
    lines.push("======");
    lines.push("");

    const unitaryRules = pricingRules.filter((r) => r.type === "UNITARY");
    const unitaryPrices: Record<MenuCategory, number> = {
      FIT: 0,
      LOWCARB: 0,
      CALDOS: 0,
    };
    unitaryRules.forEach((rule) => {
      unitaryPrices[rule.category] = rule.price;
    });

    const byCategory: Record<MenuCategory, ParsedSelection[]> = {
      FIT: [],
      LOWCARB: [],
      CALDOS: [],
    };

    selectionList.forEach((sel) => {
      byCategory[sel.item.category].push(sel);
    });

    Object.entries(byCategory).forEach(([category, items]) => {
      if (items.length > 0) {
        lines.push(`${category}:`);
        items.forEach(({ item, quantity }) => {
          const unitPrice = unitaryPrices[item.category];
          if (unitPrice > 0) {
            const lineTotal = unitPrice * quantity;
            lines.push(
              `- ${quantity}x ${item.name} (R$ ${unitPrice.toFixed(
                2,
              )} un. → R$ ${lineTotal.toFixed(2)})`,
            );
          } else {
            lines.push(`- ${quantity}x ${item.name}`);
          }
        });
        lines.push("");
      }
    });

    if (priceCalculation.breakdown.length > 0) {
      lines.push(priceCalculation.breakdown.join("\n"));
      lines.push("");
    }

    lines.push(`Total: R$ ${priceCalculation.total.toFixed(2)}`);

    if (notes.trim()) {
      lines.push("");
      lines.push("Observações:");
      lines.push(notes.trim());
    }

    const result = lines.join("\n");
    setFormattedOutput(result);
    void navigator.clipboard?.writeText(result).catch(() => undefined);
  }, [selectionList, pricingRules, priceCalculation, notes]);

  const handleDeleteMenu = useCallback(() => {
    if (
      confirm("Tem certeza que deseja deletar este cardápio?")
    ) {
      deleteMenuVersion(menuId);
      router.push("/");
    }
  }, [menuId, router]);

  const handleSendWhatsApp = useCallback(() => {
    if (!formattedOutput.trim().replace(/ /g,'')) {
      setError("Gere o pedido formatado primeiro.");
      return;
    }

    if (!whatsappNumber.trim()) {
      setError("Digite o número do WhatsApp.");
      return;
    }

    setError(null);

    // Remove caracteres não numéricos do número
    const cleanNumber = whatsappNumber.replace(/\D/g, "");
    
    if (cleanNumber.length < 10) {
      setError("Número do WhatsApp inválido.");
      return;
    }

    // Codifica a mensagem para URL
    const encodedMessage = encodeURIComponent(formattedOutput);
    
    // Abre o WhatsApp Web/App com a mensagem
    const whatsappUrl = `https://wa.me/${cleanNumber}?text=${encodedMessage}`;
    window.open(whatsappUrl, "_blank");
  }, [formattedOutput, whatsappNumber]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
        <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 lg:px-12">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-red-700 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-4 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              Voltar para início
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 lg:px-12">
        <header className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {menuName || "Cardápio"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                Selecione os itens desejados e gere seu pedido formatado.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => router.push(`/menu/create?id=${menuId}`)}
                className="rounded-lg border border-blue-500 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={handleDeleteMenu}
                className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
              >
                Deletar
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                ← Voltar
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {/* Items Grid */}
            <div>
              <h2 className="mb-4 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                Itens do cardápio
              </h2>
              {menuItems.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Nenhum item encontrado neste cardápio.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {menuItems.map((item) => {
                    const selected = (selections[item.id] ?? 0) > 0;
                    const unitPrice = unitaryPrices[item.category];
                    const quantity = selections[item.id] ?? 0;
                    return (
                      <div
                        key={item.id}
                        className={`group relative overflow-hidden rounded-xl border transition ${
                          selected
                            ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
                            : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                        }`}
                      >
                        {/* Content */}
                        <div className="p-4">
                          <button
                            type="button"
                            onClick={() => toggleSelection(item.id)}
                            className="w-full text-left"
                          >
                            <h3
                              className={`text-base font-medium leading-tight ${
                                selected
                                  ? "text-zinc-50 dark:text-zinc-900"
                                  : "text-zinc-900 dark:text-zinc-100"
                              }`}
                            >
                              {item.name}
                            </h3>
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className={`text-xs font-medium ${
                                  selected
                                    ? "text-zinc-200 dark:text-zinc-700"
                                    : "text-zinc-500 dark:text-zinc-400"
                                }`}
                              >
                                {item.category}
                              </span>
                              {unitPrice > 0 && (
                                <span
                                  className={`text-sm font-semibold ${
                                    selected
                                      ? "text-zinc-50 dark:text-zinc-900"
                                      : "text-zinc-700 dark:text-zinc-200"
                                  }`}
                                >
                                  R$ {unitPrice.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Quantity Controls */}
                          {selected && (
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (quantity > 0) {
                                    updateQuantity(item.id, quantity - 1);
                                  }
                                }}
                                disabled={quantity === 0}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-50 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={quantity}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateQuantity(
                                    item.id,
                                    Number.parseInt(e.target.value, 10) || 0,
                                  )
                                }
                                className="h-8 w-16 rounded-lg border border-zinc-700 bg-zinc-100 px-2 text-center text-sm font-medium text-zinc-900 outline-none dark:border-zinc-300 dark:bg-zinc-100"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.id, quantity + 1);
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-50 transition hover:bg-zinc-700 dark:border-zinc-300 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Price Summary */}
            {selectionList.length > 0 && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                  Resumo do pedido
                </h2>
                {priceCalculation.breakdown.length > 0 && (
                  <div className="mb-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {priceCalculation.breakdown.map((line, idx) => (
                      <p key={idx}>{line}</p>
                    ))}
                  </div>
                )}
                <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Total: R$ {priceCalculation.total.toFixed(2)}
                </p>
              </div>
            )}

            {/* Order Form */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
                Gerar pedido
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Observações extras (opcional)
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ex: Sem cebola, bebidas sem gelo, entrega no apartamento 501."
                    className="h-20 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-800 outline-none ring-0 ring-zinc-900/5 transition focus:border-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Número do WhatsApp
                  </label>
                  <input
                    type="text"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="Ex: 5511999999999 (com DDD e código do país)"
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 outline-none ring-0 ring-zinc-900/5 transition focus:border-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateOutput}
                    disabled={selectionList.length === 0}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-50 shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-500/40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    Gerar pedido formatado e copiar
                  </button>
                  <button
                    type="button"
                    onClick={handleSendWhatsApp}
                    disabled={!formattedOutput.trim() || !whatsappNumber.trim()}
                    className="inline-flex items-center justify-center rounded-full bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-zinc-500/40"
                    title="Enviar mensagem no WhatsApp"
                  >
                    📱 WhatsApp
                  </button>
                </div>

                <textarea
                  value={formattedOutput}
                  readOnly
                  placeholder="Seu pedido formatado aparecerá aqui, pronto para colar no WhatsApp, aplicativos de delivery ou chat."
                  className="h-40 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-800 outline-none ring-0 ring-zinc-900/5 transition focus:border-zinc-400 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-600/40"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
