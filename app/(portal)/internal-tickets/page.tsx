"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { StyledSelect } from '@/components/styled-select';
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "@/app/app-context";
import { InternalTicket, Permission, User } from "@/lib/types";
import { InternalTicketService } from "@/lib/services/ticket-service";
import {
  Plus, Search, Filter, Clock, Edit3, Lock, Loader2, Grid3X3, List, LayoutDashboard,
  MessageCircle, Link2, User as UserIcon, Inbox, AlertTriangle, Flame
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent
} from "@dnd-kit/core";

interface InternalTicketItem extends InternalTicket {
  linkedTicketTitles?: string[];
  assigneeName?: string;
  slaRemaining?: string | null;
  commentCount?: number;
}

const ITEMS_PER_PAGE = 20;

// Prioridade como barras (Linear-style) em vez de bolinha repetida — lê mais
// rápido num board cheio de cards e escala melhor visualmente.
const priorityConfig = {
  1: { label: "Baixa", dotColor: "bg-[var(--text-tertiary)]", textColor: "text-[var(--text-tertiary)]", bars: 1 },
  2: { label: "Média", dotColor: "bg-[var(--text-warning-strong)]", textColor: "text-[var(--text-warning)]", bars: 2 },
  3: { label: "Alta", dotColor: "bg-[var(--text-danger)]", textColor: "text-[var(--text-danger)]", bars: 3 },
};

function PriorityBars({ priority, size = "sm" }: { priority: number; size?: "sm" | "md" }) {
  const cfg = priorityConfig[priority as keyof typeof priorityConfig] || priorityConfig[1];
  const heights = size === "md" ? ["h-2.5", "h-3.5", "h-4.5"] : ["h-2", "h-3", "h-4"];
  return (
    <div className="flex items-end gap-[3px]" title={`Prioridade ${cfg.label}`}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className={cn("w-[3px] rounded-full transition-colors", heights[i], i < cfg.bars ? cfg.dotColor : "bg-[var(--border-default)]")}
        />
      ))}
    </div>
  );
}

const KANBAN_STATUSES = [
  { value: "Novo", label: "Novo", color: "bg-[var(--surface-info)] text-[var(--text-info)]", dot: "bg-[var(--text-info)]", accent: "#2563EB" },
  { value: "Em Andamento", label: "Em Andamento", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]", dot: "bg-[var(--text-warning-strong)]", accent: "#D97706" },
  { value: "Em Espera", label: "Em Espera", color: "bg-[var(--surface-pill)] text-[var(--text-secondary)]", dot: "bg-[var(--text-secondary)]", accent: "#64748B" },
  { value: "Concluído", label: "Concluído", color: "bg-[var(--surface-success)] text-[var(--text-success)]", dot: "bg-[var(--text-success)]", accent: "#16A34A" },
];

// Cor de avatar/tag consistente por texto (mesmo nome/tag sempre com a
// mesma cor) — paleta com bom contraste em claro e escuro.
const PALETTE = [
  { bg: "bg-blue-100 dark:bg-blue-500/20", text: "text-blue-700 dark:text-blue-300" },
  { bg: "bg-purple-100 dark:bg-purple-500/20", text: "text-purple-700 dark:text-purple-300" },
  { bg: "bg-pink-100 dark:bg-pink-500/20", text: "text-pink-700 dark:text-pink-300" },
  { bg: "bg-emerald-100 dark:bg-emerald-500/20", text: "text-emerald-700 dark:text-emerald-300" },
  { bg: "bg-amber-100 dark:bg-amber-500/20", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-cyan-100 dark:bg-cyan-500/20", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-rose-100 dark:bg-rose-500/20", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-indigo-100 dark:bg-indigo-500/20", text: "text-indigo-700 dark:text-indigo-300" },
];
function colorFor(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  if (!name) {
    return (
      <div
        className="rounded-full bg-[var(--surface-pill)] border border-dashed border-[var(--border-default)] flex items-center justify-center text-[var(--text-tertiary)] shrink-0"
        style={{ width: size, height: size }}
        title="Não atribuído"
      >
        <UserIcon size={size * 0.55} />
      </div>
    );
  }
  const c = colorFor(name);
  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-black shrink-0", c.bg, c.text)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function TagChip({ tag }: { tag: string }) {
  const c = colorFor(tag);
  return (
    <span className={cn("px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wide flex items-center gap-1", c.bg, c.text)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {tag}
    </span>
  );
}

// Default team options (will be replaced by DB values)
const DEFAULT_TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-[var(--accent)]/20 text-[var(--accent-text)]" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-[var(--surface-success)] text-[var(--text-success)]" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

export default function InternalTicketsPage() {
  const router = useRouter();
  const { currentUser, hasPermission, triggerRefresh } = useApp();
  const [tickets, setTickets] = useState<InternalTicketItem[]>([]);
  const [analysts, setAnalysts] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
// Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  // Chips de atalho — a mesma ideia do "Minhas tarefas"/"Sem responsável"
  // que Jira/Linear/ClickUp sempre têm de cara, sem precisar abrir filtro
  // avançado pra isso.
  const [quickFilter, setQuickFilter] = useState<"all" | "mine" | "unassigned" | "overdue" | "high">("all");
  
  // Teams state (fetched from DB)
  const [teams, setTeams] = useState(DEFAULT_TEAM_OPTIONS);
  const [teamsRaw, setTeamsRaw] = useState<Array<{ id: string; name: string }>>([]);
  
// Modal states
  const [showNewModal, setShowNewModal] = useState(false);
 
  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTeam, setFormTeam] = useState("Desenvolvimento");
  const [formPriority, setFormPriority] = useState(1);
  const [formAssignee, setFormAssignee] = useState("");

  // View mode state
  const [viewMode, setViewMode] = useState<"cards" | "table" | "kanban">("cards");

  const fetchTickets = useCallback(async (page = 1, isLoadMore = false) => {
    if (!currentUser) return;
    
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      let query = supabase
        .from("internal_tickets")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (searchTerm) query = query.ilike("title", `%${searchTerm}%`);
      if (filterTeam) query = query.eq("team_id", filterTeam);
if (filterAssignee) query = query.eq("assignee_id", filterAssignee);
       if (filterStatus) query = query.eq("status", filterStatus);
       if (filterPriority) query = query.eq("priority", parseInt(filterPriority));
       if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00`);
       if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59`);

      // Sem permissão de ver todas as equipes (Administrador/Equipe por
      // padrão): só enxerga tickets internos da(s) própria(s) equipe(s) —
      // é a diferenciação dev/infra vs suporte pedida pro Perfil de Acesso.
      const canViewAllTeams = hasPermission(Permission.INTERNAL_TICKETS_VIEW_ALL);
      if (!canViewAllTeams) {
        const myTeamIds = currentUser.internalTeamIds || [];
        if (myTeamIds.length === 0) {
          setTickets([]);
          setTotalPages(1);
          setLoading(false);
          setLoadingMore(false);
          return;
        }
        query = query.in("internal_team_id", myTeamIds);
      }

      const { data: internalData, error, count } = await query;

      console.log("Internal tickets query result:", { data: internalData?.length, error, count });

      if (error) {
        console.error("Query error:", error);
        throw error;
      }

      setTotalPages(Math.ceil((count || 0) / ITEMS_PER_PAGE));

      // Get assignee names separately
      const assigneeIds = [...new Set((internalData || []).map((t: any) => t.assignee_id).filter(Boolean))];
      const { data: assignees } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", assigneeIds);
      const assigneeMap = new Map((assignees || []).map((a: any) => [a.id, a.name]));

      // Get linked tickets
      const { data: links } = await supabase
        .from("ticket_internal_links")
        .select("ticket_id, internal_ticket_id");

      const { data: regularTickets } = await supabase.from("tickets").select("id, title, public_ticket_number");
      const ticketMap = new Map((regularTickets || []).map((t: any) => [t.id, `#${t.public_ticket_number || t.id.slice(0, 8)}`]));

      // Quantos comentários cada ticket desta página já tem — dá pra ver de
      // relance qual ticket teve conversa sem precisar abrir.
      const pageIds = (internalData || []).map((it: any) => it.id);
      const { data: messageRows } = pageIds.length
        ? await supabase.from("internal_ticket_messages").select("internal_ticket_id").in("internal_ticket_id", pageIds)
        : { data: [] as any[] };
      const commentCountMap = new Map<string, number>();
      (messageRows || []).forEach((m: any) => {
        commentCountMap.set(m.internal_ticket_id, (commentCountMap.get(m.internal_ticket_id) || 0) + 1);
      });

      setTickets((internalData || []).map((it: any) => {
        const linkedIds = (links || [])
          .filter((l: any) => l.internal_ticket_id === it.id)
          .map((l: any) => l.ticket_id);

        // Calculate SLA remaining
        let slaRemaining = null;
        if (it.sla_limit) {
          const slaDate = new Date(it.sla_limit);
          const now = new Date();
          const diff = slaDate.getTime() - now.getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const days = Math.floor(hours / 24);
          if (diff > 0) {
            slaRemaining = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
          } else {
            slaRemaining = "Expirado";
          }
        }
        
        // Sempre INT-XXXX, vinculado ou não — o número vem da própria
        // sequência do ticket interno, nunca do chamado (ver
        // InternalTicketService.saveWithDetails), então não faz sentido
        // variar o formato dependendo do vínculo.
        const formattedId = `int-${it.internal_ticket_number?.toString().padStart(4, '0') || it.id.slice(0, 8)}`;

        return {
          ...it,
          uuid: it.id,
          id: formattedId,
          internalTicketNumber: it.internal_ticket_number,
          parentTicketIds: linkedIds,
          linkedTicketTitles: linkedIds.map((id: string) => ticketMap.get(id) || "Ticket removido").filter(Boolean),
          assigneeName: it.assignee_id ? assigneeMap.get(it.assignee_id) || null : null,
          slaRemaining,
          status: it.status || "Novo",
          tags: it.tags || [],
          commentCount: commentCountMap.get(it.id) || 0,
        };
      }));
    } catch (error) {
      console.error("Error loading tickets:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [currentUser, searchTerm, filterTeam, filterAssignee, filterPriority, dateFrom, dateTo]);

  const fetchAnalysts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url, role")
        .or("role.eq.Equipe,role.eq.Administrador");
      if (error) throw error;
      setAnalysts(data || []);
    } catch (error) {
      console.error("Error loading analysts:", error);
    }
  }, []);

  const fetchTeams = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("internal_teams")
        .select("id, name, description")
        .order("name");
      if (error) throw error;
      if (data && data.length > 0) {
        setTeamsRaw(data.map((t: any) => ({ id: t.id, name: t.name })));
        setTeams(data.map((t: any) => ({
          value: t.name,
          label: t.name,
          color: "bg-[var(--accent)]/20 text-[var(--accent-text)]"
        })));
      }
    } catch (error) {
      console.error("Error loading teams:", error);
    }
  }, []);

  useEffect(() => {
    fetchTickets(1);
  }, [fetchTickets, triggerRefresh]);

  useEffect(() => {
    fetchAnalysts();
  }, [fetchAnalysts]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const resetFilters = () => {
    setSearchTerm("");
    setFilterTeam("");
    setFilterAssignee("");
    setFilterStatus("");
    setFilterPriority("");
    setDateFrom("");
    setDateTo("");
    setQuickFilter("all");
  };

  // Aplicado sobre o que já veio do servidor — os filtros avançados (equipe,
  // responsável, status, prioridade, data) já filtraram lá; os chips rápidos
  // são um recorte adicional client-side, então trocar de chip não recarrega
  // a lista inteira.
  const displayTickets = useMemo(() => {
    if (quickFilter === "all") return tickets;
    return tickets.filter((t) => {
      if (quickFilter === "mine") return t.assigneeId === currentUser?.id || t.creatorId === currentUser?.id;
      if (quickFilter === "unassigned") return !t.assigneeId;
      if (quickFilter === "overdue") return t.slaRemaining === "Expirado";
      if (quickFilter === "high") return t.priority === 3;
      return true;
    });
  }, [tickets, quickFilter, currentUser?.id]);

  const quickFilterCounts = useMemo(() => ({
    mine: tickets.filter(t => t.assigneeId === currentUser?.id || t.creatorId === currentUser?.id).length,
    unassigned: tickets.filter(t => !t.assigneeId).length,
    overdue: tickets.filter(t => t.slaRemaining === "Expirado").length,
    high: tickets.filter(t => t.priority === 3).length,
  }), [tickets, currentUser?.id]);

  const handleCreateOrUpdate = async () => {
    console.log("handleCreateOrUpdate called", { 
      currentUser: currentUser?.id, 
      formTitle,
      formDescription: formDescription?.substring(0, 50),
      hasUser: !!currentUser 
    });
    
    if (!currentUser || !formTitle) {
      console.error("Missing required: currentUser or formTitle");
      return;
    }

    try {
      const ticketData = {
        title: formTitle,
        description: formDescription,
        teamId: formTeam,
        internalTeamId: teamsRaw.find(t => t.name === formTeam)?.id,
        priority: formPriority,
        assigneeId: formAssignee || undefined,
        creatorId: currentUser.id,
        tags: [],
      };

      console.log("Creating internal ticket:", ticketData);
      const savedId = await InternalTicketService.save(ticketData);
      console.log("Internal ticket saved with ID:", savedId);
      setShowNewModal(false);
      resetForm();
      fetchTickets(1);
    } catch (error) {
      console.error("Error saving ticket:", error);
      alert("Erro ao salvar: " + (error as any)?.message || "Unknown error");
    }
};

  const resetForm = () => {
    setFormTitle("");
    setFormDescription("");
    setFormTeam("Desenvolvimento");
    setFormPriority(1);
    setFormAssignee("");
  };

const openEditModal = (ticket: InternalTicketItem) => {
     router.push(`/internal-tickets/${ticket.id}`);
   };
   
   const handleStatusChange = async (ticketUuid: string, newStatus: string) => {
     try {
       const previousStatus = tickets.find(t => t.uuid === ticketUuid)?.status || 'Novo';
       const { error } = await supabase
         .from('internal_tickets')
         .update({ status: newStatus, updated_at: new Date().toISOString() })
         .eq('id', ticketUuid);
       if (error) throw error;
       if (newStatus !== previousStatus) {
         await InternalTicketService.logEvent(ticketUuid, currentUser?.id, `Status alterado de "${previousStatus}" para "${newStatus}"`);
       }
       fetchTickets(1);
     } catch (error) {
       console.error('Error updating status:', error);
     }
   };

  if (!hasPermission(Permission.INTERNAL_TICKETS_VIEW)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar tickets internos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--surface-card)]/30">
      {/* Header */}
      <div className="p-6 bg-[var(--surface-card)] border-b border-[var(--border-default)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Tickets Internos</h1>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">Gerencie tickets internos de desenvolvimento e manutenção</p>
          </div>
          <div className="flex items-center gap-3">
            {hasPermission(Permission.INTERNAL_TICKETS_EDIT) && (
              <button
                onClick={() => {
                  resetForm();
                  setShowNewModal(true);
                }}
                className="px-4 py-2 bg-[var(--text-warning-strong)] text-white rounded-xl text-xs font-semibold uppercase tracking-widest hover:bg-[var(--accent-warning-hover)] transition-all flex items-center gap-2"
              >
                <Plus size={16} />
                Novo Ticket
              </button>
            )}
          </div>
        </div>

        {/* Search + View Switcher */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Buscar por título..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm font-medium"
            />
          </div>
          
          {/* View Switcher */}
          <div className="flex items-center gap-1 bg-[var(--surface-pill)] p-1 rounded-xl">
            <button
              onClick={() => setViewMode("cards")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
                viewMode === "cards" ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
              title="Cards"
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
                viewMode === "table" ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
              title="Tabela"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-widest transition-all",
                viewMode === "kanban" ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
              title="Kanban"
            >
              <LayoutDashboard size={16} />
            </button>
          </div>
          
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center gap-2",
              showFilters ? "bg-[var(--text-warning-strong)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
            )}
          >
            <Filter size={16} />
            Filtros
          </button>
        </div>

        {/* Quick filter chips */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {[
            { key: "all" as const, label: "Todos", icon: Inbox, count: tickets.length },
            { key: "mine" as const, label: "Minhas", icon: UserIcon, count: quickFilterCounts.mine },
            { key: "unassigned" as const, label: "Sem responsável", icon: Inbox, count: quickFilterCounts.unassigned },
            { key: "overdue" as const, label: "Atrasadas", icon: AlertTriangle, count: quickFilterCounts.overdue },
            { key: "high" as const, label: "Alta prioridade", icon: Flame, count: quickFilterCounts.high },
          ].map((chip) => (
            <button
              key={chip.key}
              onClick={() => setQuickFilter(chip.key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1.5 border",
                quickFilter === chip.key
                  ? "bg-[var(--text-warning-strong)] border-[var(--text-warning-strong)] text-white shadow-sm"
                  : "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-warning-strong)]/40"
              )}
            >
              <chip.icon size={11} />
              {chip.label}
              <span className={cn("px-1.5 rounded-full text-[9px]", quickFilter === chip.key ? "bg-white/20" : "bg-[var(--surface-pill)]")}>
                {chip.count}
              </span>
            </button>
          ))}
        </div>

        {/* Advanced Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-[var(--border-default)]">
                <StyledSelect
                  value={filterTeam}
                  onChange={(e) => setFilterTeam(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                >
                  <option value="">Todas Equipes</option>
                  {teams.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </StyledSelect>

                <StyledSelect
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                >
                  <option value="">Todos Responsáveis</option>
                  {analysts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </StyledSelect>

<StyledSelect
                   value={filterPriority}
                   onChange={(e) => setFilterPriority(e.target.value)}
                   className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                 >
                   <option value="">Todas Prioridades</option>
                   <option value="3">Alta</option>
                   <option value="2">Média</option>
                   <option value="1">Baixa</option>
                 </StyledSelect>

                 <StyledSelect
                   value={filterStatus}
                   onChange={(e) => setFilterStatus(e.target.value)}
                   className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
                 >
                   <option value="">Todos Status</option>
                   {KANBAN_STATUSES.map((s) => (
                     <option key={s.value} value={s.value}>{s.label}</option>
                   ))}
                 </StyledSelect>

                 <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium"
                  placeholder="Data início"
                />

                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium"
                  placeholder="Data fim"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
{loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-[var(--text-warning-strong)] animate-spin" />
              </div>
            ) : displayTickets.length === 0 ? (
              <div className="text-center py-20 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)]">
                <Inbox size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-bold text-[var(--text-secondary)] mb-2">Nenhum ticket interno encontrado</h3>
                <p className="text-[var(--text-tertiary)] text-sm">{tickets.length > 0 ? "Ajuste os filtros pra ver mais resultados." : "Crie um novo ticket ou ajuste os filtros."}</p>
              </div>
            ) : viewMode === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {displayTickets.map((it) => (
                  <TicketCard key={it.id} ticket={it} onEdit={() => openEditModal(it)} teams={teams} />
                ))}
              </div>
            ) : viewMode === "table" ? (
              <TicketTable tickets={displayTickets} onEdit={openEditModal} teams={teams} />
            ) : (
              <KanbanBoard tickets={displayTickets} onEdit={openEditModal} onStatusChange={handleStatusChange} />
            )}
          </div>

          {/* Modal - Only for creating new tickets */}
          <AnimatePresence>
            {showNewModal && (
<TicketModal
                 isOpen={showNewModal}
                 onClose={() => {
                   setShowNewModal(false);
                   resetForm();
                 }}
                 onSubmit={handleCreateOrUpdate}
                 formTitle={formTitle}
                 setFormTitle={setFormTitle}
                 formDescription={formDescription}
                 setFormDescription={setFormDescription}
                 formTeam={formTeam}
                 setFormTeam={setFormTeam}
                 formPriority={formPriority}
                 setFormPriority={setFormPriority}
                 formAssignee={formAssignee}
                 setFormAssignee={setFormAssignee}
                 analysts={analysts}
                 teams={teams}
                 isEdit={false}
               />
            )}
          </AnimatePresence>
        </div>
      );
    }

// Ticket Card Component
function TicketCard({ ticket, onEdit, teams = DEFAULT_TEAM_OPTIONS }: { ticket: InternalTicketItem; onEdit: () => void; teams?: typeof DEFAULT_TEAM_OPTIONS }) {
  const teamOption = teams.find((t) => t.value === ticket.teamId) || teams[0];
  const statusMeta = KANBAN_STATUSES.find(s => s.value === (ticket.status || "Novo")) || KANBAN_STATUSES[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="relative bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] pl-5 pr-5 py-5 hover:shadow-lg hover:border-[var(--text-warning-strong)]/40 transition-all group cursor-pointer overflow-hidden"
      onClick={onEdit}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: statusMeta.accent }} />

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-[var(--text-warning)] uppercase">{ticket.id?.startsWith("int-") ? ticket.id : `#${ticket.internalTicketNumber?.toString().padStart(4, "0")}`}</span>
          <PriorityBars priority={ticket.priority || 1} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-[var(--surface-pill)] transition-all"
        >
          <Edit3 size={14} className="text-[var(--text-tertiary)]" />
        </button>
      </div>

      <h3 className="text-sm font-black text-[var(--text-primary)] mb-2 line-clamp-2">{ticket.title}</h3>

      <p className="text-xs text-[var(--text-tertiary)] mb-3 line-clamp-2">
        {(() => {
          const html = ticket.description || '';
          return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        })() || "Sem descrição"}
      </p>

      {(ticket.tags && ticket.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ticket.tags.slice(0, 4).map(tag => <TagChip key={tag} tag={tag} />)}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <span className={cn("px-2 py-1 rounded-full text-[9px] font-semibold uppercase", teamOption.color)}>
            {teamOption.label}
          </span>
          <span className={cn("px-2 py-1 rounded-full text-[9px] font-semibold uppercase flex items-center gap-1", statusMeta.color)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", statusMeta.dot)} />
            {statusMeta.label}
          </span>
        </div>
        <Avatar name={ticket.assigneeName} size={24} />
      </div>

      <div className="flex items-center gap-3 mt-3 text-[var(--text-tertiary)]">
        {ticket.slaRemaining && (
          <span className={cn("flex items-center gap-1 text-[10px] font-bold", ticket.slaRemaining === "Expirado" ? "text-[var(--text-danger)]" : "text-[var(--text-tertiary)]")}>
            <Clock size={11} />
            {ticket.slaRemaining}
          </span>
        )}
        {!!ticket.commentCount && (
          <span className="flex items-center gap-1 text-[10px] font-bold">
            <MessageCircle size={11} />
            {ticket.commentCount}
          </span>
        )}
        {ticket.linkedTicketTitles && ticket.linkedTicketTitles.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-bold" title={ticket.linkedTicketTitles.join(", ")}>
            <Link2 size={11} />
            {ticket.linkedTicketTitles.length}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// Ticket Table Component
function TicketTable({ tickets, onEdit, teams = DEFAULT_TEAM_OPTIONS }: { tickets: InternalTicketItem[]; onEdit: (t: InternalTicketItem) => void; teams?: typeof DEFAULT_TEAM_OPTIONS }) {
  return (
    <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] overflow-hidden">
      <table className="w-full">
        <thead className="bg-[var(--surface-card)]/50 border-b border-[var(--border-default)]">
          <tr>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Número</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Título</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Status</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Equipe</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Prioridade</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Responsável</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">SLA</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]"><MessageCircle size={12} /></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {tickets.map((it) => {
            const teamOpt = teams.find((t) => t.value === it.teamId) || teams[0];
            const statusMeta = KANBAN_STATUSES.find(s => s.value === (it.status || "Novo")) || KANBAN_STATUSES[0];
            return (
              <tr key={it.id} className="hover:bg-[var(--surface-card)]/50 transition-colors cursor-pointer group" onClick={() => onEdit(it)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: statusMeta.accent }} />
                    <span className="text-[10px] font-semibold text-[var(--text-warning)] whitespace-nowrap">{it.id?.startsWith("int-") ? it.id : `#${it.internalTicketNumber?.toString().padStart(4, "0")}`}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--text-warning)] transition-colors max-w-xs truncate">{it.title}</td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-semibold px-2 py-1 rounded-full uppercase flex items-center gap-1 w-fit", statusMeta.color)}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", statusMeta.dot)} />
                    {statusMeta.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-semibold px-2 py-1 rounded-full uppercase", teamOpt.color)}>
                    {teamOpt.label}
                  </span>
                </td>
                <td className="px-4 py-3"><PriorityBars priority={it.priority || 1} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={it.assigneeName} size={20} />
                    <span className="text-sm text-[var(--text-secondary)] truncate max-w-[120px]">{it.assigneeName || "Não atribuído"}</span>
                  </div>
                </td>
                <td className={cn("px-4 py-3 text-[10px] font-bold whitespace-nowrap",
                  it.slaRemaining === "Expirado" ? "text-[var(--text-danger)]" : "text-[var(--text-secondary)]")}>
                  {it.slaRemaining || "-"}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--text-tertiary)]">
                  {it.commentCount ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold"><MessageCircle size={11} />{it.commentCount}</span>
                  ) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ticket Modal Component
function TicketModal({
  isOpen,
  onClose,
  onSubmit,
  formTitle,
  setFormTitle,
  formDescription,
  setFormDescription,
  formTeam,
  setFormTeam,
  formPriority,
  setFormPriority,
  formAssignee,
  setFormAssignee,
  analysts,
  teams = DEFAULT_TEAM_OPTIONS,
  isEdit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  formTitle: string;
  setFormTitle: (v: string) => void;
  formDescription: string;
  setFormDescription: (v: string) => void;
  formTeam: string;
  setFormTeam: (v: string) => void;
  formPriority: number;
  setFormPriority: (v: number) => void;
  formAssignee: string;
  setFormAssignee: (v: string) => void;
  analysts: User[];
  teams?: typeof DEFAULT_TEAM_OPTIONS;
  isEdit: boolean;
}) {
  if (!isOpen) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-black text-[var(--text-primary)] mb-4 uppercase">
          {isEdit ? "Editar Ticket" : "Novo Ticket Interno"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Título *</label>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Título do ticket"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm font-medium"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Descrição</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Detalhes técnicos..."
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Equipe</label>
<StyledSelect
                 value={formTeam}
                 onChange={(e) => setFormTeam(e.target.value)}
                 className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
               >
                 {teams.map((t) => (
                   <option key={t.value} value={t.value}>{t.label}</option>
                 ))}
               </StyledSelect>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Prioridade</label>
              <StyledSelect
                value={formPriority}
                onChange={(e) => setFormPriority(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
              >
                <option value={1}>Baixa</option>
                <option value={2}>Média</option>
                <option value={3}>Alta</option>
              </StyledSelect>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase mb-1 block">Responsável</label>
            <StyledSelect
              value={formAssignee}
              onChange={(e) => setFormAssignee(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-default)] text-sm font-medium bg-[var(--surface-card)]"
            >
              <option value="">Não atribuído</option>
              {analysts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </StyledSelect>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-card)] transition-all text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            onClick={onSubmit}
            disabled={!formTitle}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--text-warning-strong)] text-white font-black uppercase tracking-widest hover:bg-[var(--accent-warning-hover)] transition-all disabled:opacity-50 text-sm"
          >
            {isEdit ? "Salvar" : "Criar"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Kanban Board Component
function KanbanBoard({
  tickets,
  onEdit,
  onStatusChange
}: {
  tickets: InternalTicketItem[];
  onEdit: (t: InternalTicketItem) => void;
  onStatusChange?: (ticketId: string, newStatus: string) => void;
}) {
  const [activeTicket, setActiveTicket] = useState<InternalTicketItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const columns = KANBAN_STATUSES.map(status => ({
    ...status,
    tickets: tickets.filter(t => (t.status || "Novo") === status.value)
  }));

  const handleDragStart = (event: DragStartEvent) => {
    const ticket = tickets.find(t => t.uuid === event.active.id);
    setActiveTicket(ticket || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicket(null);
    const { active, over } = event;
    if (!over || !onStatusChange) return;
    const ticket = tickets.find(t => t.uuid === active.id);
    const targetStatus = String(over.id);
    if (ticket && ticket.status !== targetStatus) {
      onStatusChange(String(active.id), targetStatus);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        {columns.map((col) => (
          <KanbanColumn key={col.value} col={col} onEdit={onEdit} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTicket && <KanbanCard ticket={activeTicket} onEdit={() => {}} dragging />}
      </DragOverlay>
    </DndContext>
  );
}

// Coluna do Kanban — área de soltar (droppable), com destaque visual
// enquanto um card é arrastado sobre ela.
function KanbanColumn({ col, onEdit }: { col: (typeof KANBAN_STATUSES)[number] & { tickets: InternalTicketItem[] }; onEdit: (t: InternalTicketItem) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.value });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border-t-4 transition-all overflow-hidden",
        isOver ? "bg-[var(--surface-pill)] ring-2 ring-[var(--text-warning-strong)]/30" : "bg-[var(--surface-card)]"
      )}
      style={{ borderTopColor: col.accent }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
        <span className={cn("w-2 h-2 rounded-full", col.dot)} />
        <h3 className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">{col.label}</h3>
        <span className="text-[10px] font-bold text-[var(--text-tertiary)] ml-auto bg-[var(--surface-pill)] px-2 py-0.5 rounded-full">
          {col.tickets.length}
        </span>
      </div>

      <div className="p-3 space-y-2.5 min-h-[120px]">
        {col.tickets.length === 0 ? (
          <div className={cn("text-center py-8 rounded-xl border-2 border-dashed transition-colors", isOver ? "border-[var(--text-warning-strong)]/40" : "border-[var(--border-default)]")}>
            <p className="text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">Arraste um card aqui</p>
          </div>
        ) : (
          col.tickets.map((ticket) => (
            <DraggableKanbanCard key={ticket.uuid} ticket={ticket} onEdit={onEdit} />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableKanbanCard({ ticket, onEdit }: { ticket: InternalTicketItem; onEdit: (t: InternalTicketItem) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.uuid || ticket.id || "" });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className="touch-none"
    >
      <KanbanCard ticket={ticket} onEdit={onEdit} />
    </div>
  );
}

// KanbanCard Component
function KanbanCard({ ticket, onEdit, dragging = false }: { ticket: InternalTicketItem; onEdit: (t: InternalTicketItem) => void; dragging?: boolean }) {
  return (
    <div
      onClick={() => !dragging && onEdit(ticket)}
      className={cn(
        "bg-[var(--surface-card)] rounded-xl p-3.5 border border-[var(--border-default)] transition-all group",
        dragging ? "shadow-2xl rotate-2 cursor-grabbing" : "hover:shadow-md hover:border-[var(--text-warning-strong)]/40 cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-warning)]">
          {ticket.id?.startsWith("int-") ? ticket.id : `#${ticket.internalTicketNumber?.toString().padStart(4, "0")}`}
        </span>
        <PriorityBars priority={ticket.priority || 1} />
      </div>

      <h4 className="font-bold text-[var(--text-primary)] text-sm mb-2 line-clamp-2 leading-snug" title={ticket.title}>
        {ticket.title}
      </h4>

      {ticket.tags && ticket.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {ticket.tags.slice(0, 3).map(tag => <TagChip key={tag} tag={tag} />)}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[var(--text-tertiary)]">
          {!!ticket.commentCount && (
            <span className="flex items-center gap-1 text-[10px] font-bold">
              <MessageCircle size={11} />
              {ticket.commentCount}
            </span>
          )}
          {ticket.linkedTicketTitles && ticket.linkedTicketTitles.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold" title={ticket.linkedTicketTitles.join(", ")}>
              <Link2 size={11} />
              {ticket.linkedTicketTitles.length}
            </span>
          )}
          {ticket.slaRemaining && (
            <span className={cn("flex items-center gap-1 text-[10px] font-bold", ticket.slaRemaining === "Expirado" ? "text-[var(--text-danger)]" : "")}>
              <Clock size={11} />
              {ticket.slaRemaining}
            </span>
          )}
        </div>
        <Avatar name={ticket.assigneeName} size={22} />
      </div>
    </div>
  );
}
