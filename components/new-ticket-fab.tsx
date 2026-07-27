"use client";

import { Plus } from "lucide-react";
import { useApp } from "@/app/app-context";
import { cn } from "@/lib/utils";

// Botão flutuante fixo de "Novo Chamado" — complementa (não substitui) os
// botões já existentes nos cabeçalhos de cada tela, garantindo acesso rápido
// mesmo com a página rolada. `bottom-20` no mobile evita sobrepor a
// mobile-bottom-nav (min-h 56px, fixed bottom-0, z-[200]).
export function NewTicketFAB({ className }: { className?: string }) {
  const { setIsNewTicketModalOpen } = useApp();

  return (
    <button
      type="button"
      onClick={() => setIsNewTicketModalOpen(true)}
      title="Novo Chamado"
      className={cn(
        "fixed z-40 bottom-20 right-5 md:bottom-8 md:right-8 flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white pl-4 pr-5 py-3.5 rounded-full shadow-xl hover:shadow-2xl transition-all active:scale-95 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40",
        className,
      )}
    >
      <Plus size={20} />
      <span>Novo Chamado</span>
    </button>
  );
}
