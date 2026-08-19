"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Ticket as TicketIcon, FolderKanban, Grid3X3, List, LayoutDashboard, Lock } from "lucide-react";
import { Permission, UserRole } from "@/lib/types";
import { useApp } from "@/app/app-context";
import { cn } from "@/lib/utils";
import { TicketsView } from "./tickets-view";
import { InternalTicketsView } from "./internal-tickets-view";

type Mode = "tickets" | "internal";
type ViewMode = "cards" | "table" | "kanban";

export default function TicketsPage() {
  const { currentUser, hasPermission } = useApp();
  const searchParams = useSearchParams();

  const canSeeTickets = hasPermission(Permission.TICKETS_READ);
  const canSeeInternal = hasPermission(Permission.INTERNAL_TICKETS_VIEW);
  // Cliente/Funcionário não passam pelo Perfil de Acesso (tickets:read não
  // se aplica a eles) — pra eles esta tela sempre foi a versão "Chamados"
  // com escopo por empresa, resolvido dentro do próprio TicketsView.
  const isCompanyPortalUser = currentUser?.role === UserRole.CUSTOMER || currentUser?.role === UserRole.EMPLOYEE;
  const effectiveCanSeeTickets = isCompanyPortalUser || canSeeTickets;

  const requestedMode = searchParams?.get("mode") === "internal" ? "internal" : null;
  const openTicketId = searchParams?.get("open") || null;
  // Atalho do Dashboard ("Novo Ticket Interno" quando o usuário só enxerga o
  // lado interno): sem isso, o botão só navegava pra cá e deixava a pessoa
  // parada na lista, tendo que achar e clicar em "Novo Ticket" de novo.
  const openNewInternal = searchParams?.get("new") === "1";

  // Inicializa já no lado certo pra quem só tem uma das duas permissões (ou
  // veio de um link tipo /tickets?mode=internal) — mesma lógica do Dashboard,
  // evita um frame mostrando o lado errado antes do efeito abaixo corrigir.
  const [mode, setMode] = useState<Mode>(() => {
    if (requestedMode === "internal" && canSeeInternal) return "internal";
    if (!canSeeTickets && canSeeInternal) return "internal";
    return "tickets";
  });
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  useEffect(() => {
    if (!canSeeTickets && canSeeInternal) setMode("internal");
    else if (canSeeTickets && !canSeeInternal) setMode("tickets");
  }, [canSeeTickets, canSeeInternal]);

  if (!isCompanyPortalUser && !canSeeTickets && !canSeeInternal) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar chamados.</p>
        </div>
      </div>
    );
  }

  // Chave Chamados / Tickets Internos — só aparece pra quem tem as duas
  // permissões; sem isso, nem a opção de trocar deve existir (ver Equipes &
  // Permissões).
  const viewToggle = effectiveCanSeeTickets && canSeeInternal ? (
    <div className="flex items-center gap-1 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)]">
      <button
        onClick={() => setMode("tickets")}
        className={cn(
          "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
          mode === "tickets" ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        )}
      >
        <TicketIcon size={14} /> Chamados
      </button>
      <button
        onClick={() => setMode("internal")}
        className={cn(
          "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
          mode === "internal" ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        )}
      >
        <FolderKanban size={14} /> Tickets Internos
      </button>
    </div>
  ) : null;

  // Cards / Tabela / Kanban — compartilhada entre os dois modos, mesmas 3
  // opções nos dois lados.
  const viewModeSwitcher = (
    <div className="flex items-center gap-1 bg-[var(--surface-pill)] p-1 rounded-xl shrink-0">
      <button
        onClick={() => setViewMode("cards")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
          viewMode === "cards" ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        )}
        title="Cards"
      >
        <Grid3X3 size={16} />
      </button>
      <button
        onClick={() => setViewMode("table")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
          viewMode === "table" ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        )}
        title="Tabela"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => setViewMode("kanban")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
          viewMode === "kanban" ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        )}
        title="Kanban"
      >
        <LayoutDashboard size={16} />
      </button>
    </div>
  );

  if (mode === "tickets" && effectiveCanSeeTickets) {
    return <TicketsView viewToggle={viewToggle} viewModeSwitcher={viewModeSwitcher} viewMode={viewMode} openTicketId={openTicketId} />;
  }
  if (canSeeInternal) {
    return <InternalTicketsView viewToggle={viewToggle} viewModeSwitcher={viewModeSwitcher} viewMode={viewMode} openNewModal={openNewInternal} />;
  }
  return null;
}
