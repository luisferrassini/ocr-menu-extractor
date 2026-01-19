"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SavedMenuVersion } from "@/lib/types";
import { getSavedMenus, deleteMenuVersion } from "@/lib/utils";

export default function Home() {
  const router = useRouter();
  const [savedMenus, setSavedMenus] = useState<SavedMenuVersion[]>([]);

  useEffect(() => {
    setSavedMenus(getSavedMenus());
  }, []);

  const handleDeleteMenu = (menuId: string) => {
    if (confirm("Tem certeza que deseja deletar este cardápio?")) {
      deleteMenuVersion(menuId);
      setSavedMenus(getSavedMenus());
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Assistente OCR de Cardápio
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Gerencie seus cardápios, crie pedidos formatados e organize suas
            marmitas.
          </p>
        </header>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => router.push("/menu/create")}
            className="rounded-lg bg-black px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            + Criar novo cardápio
          </button>
        </div>

        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-[0.16em] text-zinc-500">
            Cardápios salvos
          </h2>
          {savedMenus.length === 0 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-sm text-zinc-500">
                Nenhum cardápio salvo ainda. Crie seu primeiro cardápio!
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {savedMenus.map((menu) => (
                <div
                  key={menu.id}
                  className="group relative rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                >
                  <h3 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {menu.name}
                  </h3>
                  <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(menu.createdAt).toLocaleDateString("pt-BR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  <div className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
                    <p>{menu.items.length} itens</p>
                    <p>{menu.pricingRules.length} regras de preço</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => router.push(`/menu/${menu.id}`)}
                      className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/menu/create?id=${menu.id}`)
                      }
                      className="flex-1 rounded-lg border border-blue-500 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMenu(menu.id)}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                    >
                      Deletar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
