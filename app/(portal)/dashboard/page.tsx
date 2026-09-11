'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Ticket as TicketType, TicketStatus, UserRole, TicketPriority, Permission, InternalTicket } from '@/lib/types';
import { fetchAllTickets } from '@/lib/tickets';
import { isClosedTicketStatus, isInProgressTicketStatus } from '@/lib/ticket-status';
import { addBusinessHours } from '@/lib/sla';
import { fetchPriorities, fetchStatuses, ConfigService } from '@/lib/services/config-service';
import { useProfilesLiteQuery } from '@/lib/query-hooks';
import { UserAvatar } from '@/components/user-avatar';
import { findStatusColor } from '@/lib/status-colors';
import { useApp } from '@/app/app-context';
import { Plus, Clock, AlertCircle, User, Lock, Ticket as TicketIcon, FolderKanban, Users, LayoutGrid, List as ListIcon, Settings2, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { FilterBar } from '@/components/filter-bar';
import { useSearchParams, useRouter } from 'next/navigation';

interface InternalTicketItem extends InternalTicket {
  uuid: string;
  displayId: string;
  assigneeName?: string | null;
  // Miniatura do responsável (profiles.avatar_thumb_url) — o card mostra a
  // foto em vez da inicial. Vem junto do nome na mesma busca.
  assigneeAvatarThumbUrl?: string | null;
  slaRemaining?: string | null;
}

interface InternalStatusMeta {
  value: string;
  label: string;
  color: string;
  dot: string;
  accent: string;
}

// Mesmos valores de app/api/dashboard-prefs/route.ts (DashboardListSort) —
// não importado direto por ser client component; manter os dois em sincronia.
type DashboardListSort = 'urgency' | 'created_desc' | 'created_asc' | 'priority' | 'number' | 'title';

interface KanbanPrefsState {
  order: string[];
  hidden: string[];
  view: 'kanban' | 'list';
  sortBy: DashboardListSort;
}

const LIST_SORT_OPTIONS: { value: DashboardListSort; label: string }[] = [
  { value: 'urgency', label: 'Urgência' },
  { value: 'created_desc', label: 'Mais recentes' },
  { value: 'created_asc', label: 'Mais antigos' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'number', label: 'Número do chamado' },
  { value: 'title', label: 'Título (A-Z)' }
];

export default function DashboardPage() {
  const router = useRouter();
  const [allTickets, setAllTickets] = useState<TicketType[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, setIsNewTicketModalOpen, refreshTrigger, hasPermission } = useApp();
  const searchParams = useSearchParams();

  const [priorities, setPriorities] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  // Só usado pra achar nome/iniciais do responsável (nunca avatar) — via hook
  // compartilhado "lite" (sem avatar_url, ~51MB a menos de payload) em vez de
  // /api/users?type=all buscado do zero a cada carga do Dashboard.
  const { data: usersLiteData } = useProfilesLiteQuery();
  const users = useMemo(() => usersLiteData || [], [usersLiteData]);
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);

  // Organizar/ocultar colunas e alternar kanban/lista no board de chamados —
  // preferência pessoal, vinculada ao usuário (não ao navegador), ver
  // app/api/dashboard-prefs/route.ts e profiles.dashboard_kanban_prefs.
  const [kanbanPrefs, setKanbanPrefs] = useState<KanbanPrefsState>({ order: [], hidden: [], view: 'kanban', sortBy: 'urgency' });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const columnSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function loadKanbanPrefs() {
      try {
        const res = await fetch('/api/dashboard-prefs');
        if (!active || !res.ok) return;
        const data = await res.json().catch(() => null);
        const p = data?.prefs || {};
        setKanbanPrefs({
          order: Array.isArray(p.order) ? p.order : [],
          hidden: Array.isArray(p.hidden) ? p.hidden : [],
          view: p.view === 'list' ? 'list' : 'kanban',
          sortBy: LIST_SORT_OPTIONS.some(o => o.value === p.sortBy) ? p.sortBy : 'urgency'
        });
      } catch {
        // Sem preferência salva (ou falha de rede): fica no padrão — todas as
        // colunas visíveis, ordem do cadastro, kanban, ordenado por urgência.
      }
    }
    loadKanbanPrefs();
    return () => { active = false; };
  }, []);

  // Sempre otimista: atualiza a tela na hora e só então grava — o board não
  // deve travar esperando o servidor confirmar um clique de reordenar/ocultar.
  const persistKanbanPrefs = (next: Partial<KanbanPrefsState>) => {
    setKanbanPrefs(prev => {
      const merged = { ...prev, ...next };
      fetch('/api/dashboard-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged)
      }).catch(err => console.error('Erro ao salvar preferências do dashboard:', err));
      return merged;
    });
  };

  useEffect(() => {
    if (!showColumnSettings) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(event.target as Node)) setShowColumnSettings(false);
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowColumnSettings(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showColumnSettings]);

  // Chave Chamados / Tickets Internos — cada lado só aparece pra quem tem a
  // permissão correspondente (Chamados = tickets:read, Tickets Internos =
  // internal:view); ver descrições em Equipes & Permissões.
  const canSeeTickets = hasPermission(Permission.TICKETS_READ);
  const canSeeInternal = hasPermission(Permission.INTERNAL_TICKETS_VIEW);
  // Inicializa já no lado certo pra quem só tem uma das duas permissões —
  // evita um frame mostrando "Chamados" antes do efeito abaixo corrigir.
  const [dashboardMode, setDashboardMode] = useState<'tickets' | 'internal'>(() => (
    !canSeeTickets && canSeeInternal ? 'internal' : 'tickets'
  ));
  const [internalTickets, setInternalTickets] = useState<InternalTicketItem[]>([]);
  const [loadingInternal, setLoadingInternal] = useState(false);
  const [internalStatuses, setInternalStatuses] = useState<InternalStatusMeta[]>([]);

  // Nenhuma das duas permissões é dependente da outra: quem perde/ganha uma
  // delas (ex: perfil de acesso trocado) não deve continuar preso no lado
  // que não pode mais ver, nem ficar preso no lado que acabou de ganhar.
  useEffect(() => {
    if (!canSeeTickets && canSeeInternal) setDashboardMode('internal');
    else if (canSeeTickets && !canSeeInternal) setDashboardMode('tickets');
  }, [canSeeTickets, canSeeInternal]);

  useEffect(() => {
    async function loadInternal() {
      if (!currentUser || !canSeeInternal || dashboardMode !== 'internal') return;
      setLoadingInternal(true);
      try {
        const statusConfigs = await ConfigService.getStatuses('internal_ticket');
        setInternalStatuses(statusConfigs.filter(s => !s.parentStatusId).map(s => {
          const c = findStatusColor(s.color);
          return { value: s.label, label: s.label, color: `${c.bg} ${c.text}`, dot: c.dot, accent: c.accent };
        }));

        // Quem não vê todos os tickets internos enxerga só os das próprias
        // equipes — e é o SERVIDOR que resolve quais são, a partir da sessão
        // (scope=my-teams), em vez de o client mandar a lista de ids.
        const scope = hasPermission(Permission.INTERNAL_TICKETS_VIEW_ALL) ? 'all' : 'my-teams';
        const res = await fetch(`/api/internal-tickets?action=list&scope=${scope}`);
        if (!res.ok) throw new Error('Falha ao carregar tickets internos.');
        const data = await res.json();

        // A miniatura do responsável sai da mesma lista de perfis que a tela
        // já carrega (useProfilesLiteQuery, que traz avatarThumbUrl) — antes
        // isso era uma segunda consulta só para os ids que apareciam.
        const assigneeMap = new Map<string, any>(
          (users as any[]).map((u: any) => [u.id, { name: u.name, avatar_thumb_url: u.avatarThumbUrl }])
        );

        setInternalTickets((data || []).map((it: any) => {
          // Mesmo cálculo de "tempo restante" usado em /internal-tickets —
          // dá pra reaproveitar o texto formatado nos cards do Kanban aqui.
          let slaRemaining: string | null = null;
          if (it.sla_limit) {
            const diff = new Date(it.sla_limit).getTime() - Date.now();
            if (diff > 0) {
              const hours = Math.floor(diff / (1000 * 60 * 60));
              const days = Math.floor(hours / 24);
              slaRemaining = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
            } else {
              slaRemaining = 'Expirado';
            }
          }

          return {
            ...it,
            uuid: it.id,
            displayId: `INT-${it.internal_ticket_number?.toString().padStart(4, '0') || it.id.slice(0, 8)}`,
            teamId: it.team_id,
            assigneeId: it.assignee_id,
            assigneeName: it.assignee_id ? assigneeMap.get(it.assignee_id)?.name || null : null,
            assigneeAvatarThumbUrl: it.assignee_id ? assigneeMap.get(it.assignee_id)?.avatar_thumb_url || null : null,
            priority: it.priority,
            tags: it.tags || [],
            status: it.status || 'Novo',
            slaLimit: it.sla_limit,
            slaRemaining,
            createdAt: it.created_at,
            updatedAt: it.updated_at,
          };
        }));
      } catch (err) {
        console.error('Error loading internal tickets for dashboard:', err);
      } finally {
        setLoadingInternal(false);
      }
    }
    loadInternal();
  }, [currentUser?.id, canSeeInternal, dashboardMode, hasPermission, refreshTrigger]);

  useEffect(() => {
    const controller = new AbortController();
    
    async function loadData() {
      if ([UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole)) {
        router.push('/my-tickets');
        return;
      }

      // Sem "Visualizar chamados": nem busca os dados — quem só tem Tickets
      // Internos não pode ter chamados chegando na memória do cliente.
      if (!canSeeTickets) {
        setAllTickets([]);
        setFilteredTickets([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // O AppContext já lida com o sync inicial.
        
        if (controller.signal.aborted) return;

        const [loadedTickets, loadedPriorities, loadedStatuses] = await Promise.all([
          fetchAllTickets(controller.signal),
          fetchPriorities(controller.signal),
          fetchStatuses(controller.signal, 'ticket')
        ]);
        
        let tickets = loadedTickets;
        
        if ([UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole)) {
          tickets = tickets.filter(t => t.companyId === currentUser?.companyId);
        }
        
        setAllTickets(tickets);
        setFilteredTickets(tickets);
        setPriorities(loadedPriorities || []);
        setStatuses(loadedStatuses || []);
        setLoading(false);
    
        // Auto-open ticket from URL param
        const ticketId = searchParams?.get('ticket');
        if (ticketId) {
          const ticket = tickets.find(t => t.id === ticketId);
          if (ticket) {
            setSelectedTicket(ticket);
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
        console.error("Error in dashboard loadData:", err);
        setLoading(false);
      }
    }
    loadData();

    return () => controller.abort();
  }, [searchParams, currentUser?.id, currentUser?.role, refreshTrigger, router, canSeeTickets]);

  // Só status de topo viram coluna — sub-status (config_statuses.parent_status_id
  // preenchido) mora dentro do status pai (tickets.sub_status), nunca é um
  // valor próprio de tickets.status. Sem este filtro, cada sub-status virava
  // uma coluna extra que nunca recebia chamado nenhum (a comparação
  // t.status === label do sub-status nunca bate).
  const baseColumns = useMemo(() => statuses
    .filter(s => !s.parentStatusId && !isClosedTicketStatus(s.label))
    .map(s => ({
      title: s.label,
      status: s.label
    })), [statuses]);

  // Aplica a ordem salva (kanbanPrefs.order): quem já está na lista respeita
  // essa posição, e status novo no cadastro desde a última vez que o usuário
  // organizou entra no fim, na ordem do cadastro — nunca some da tela.
  const orderedAllColumns = useMemo(() => {
    if (kanbanPrefs.order.length === 0) return baseColumns;
    const remaining = new Map(baseColumns.map(c => [c.status, c]));
    const ordered: typeof baseColumns = [];
    kanbanPrefs.order.forEach(status => {
      const col = remaining.get(status);
      if (col) { ordered.push(col); remaining.delete(status); }
    });
    baseColumns.forEach(col => { if (remaining.has(col.status)) ordered.push(col); });
    return ordered;
  }, [baseColumns, kanbanPrefs.order]);

  const columns = useMemo(
    () => orderedAllColumns.filter(c => !kanbanPrefs.hidden.includes(c.status)),
    [orderedAllColumns, kanbanPrefs.hidden]
  );

  const moveColumn = (status: string, direction: -1 | 1) => {
    const order = orderedAllColumns.map(c => c.status);
    const idx = order.indexOf(status);
    const swapWith = idx + direction;
    if (idx < 0 || swapWith < 0 || swapWith >= order.length) return;
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    persistKanbanPrefs({ order });
  };

  const toggleColumnHidden = (status: string) => {
    const hidden = kanbanPrefs.hidden.includes(status)
      ? kanbanPrefs.hidden.filter(s => s !== status)
      : [...kanbanPrefs.hidden, status];
    persistKanbanPrefs({ hidden });
  };

  const resetColumnPrefs = () => persistKanbanPrefs({ order: [], hidden: [] });

  // Cor configurada de cada status (Configurações > Status) — o kanban não
  // precisa (a coluna já diz o status no título), mas a lista sim, já que
  // ali os chamados de status diferentes ficam misturados na mesma lista.
  const statusColorMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof findStatusColor>>();
    statuses.forEach(s => map.set(s.label, findStatusColor(s.color)));
    return map;
  }, [statuses]);

  // Lista única (sem dividir por coluna). O badge de vencido/perto de vencer
  // (isOverdue/isNear) é sempre calculado, mesmo critério dos cards do
  // Kanban — só a ORDEM muda conforme kanbanPrefs.sortBy.
  const listTickets = useMemo(() => {
    if (kanbanPrefs.view !== 'list') return [];
    const visibleStatuses = new Set(columns.map(c => c.status));
    const now = new Date();
    const withUrgency = filteredTickets
      .filter(t => visibleStatuses.has(t.status))
      .map(t => {
        const config = priorities.find(p => p.label === t.priority);
        const slaLimit = config?.sla_hours ? addBusinessHours(t.createdAt, config.sla_hours) : null;
        const isOverdue = !!slaLimit && slaLimit < now;
        const isNear = !!slaLimit && !isOverdue && (slaLimit.getTime() - now.getTime() < 4 * 60 * 60 * 1000);
        const tier = isOverdue ? 0 : isNear ? 1 : 2;
        // sla_hours do config da prioridade: quanto menor, mais urgente —
        // usado só pra ordenar por "Prioridade" sem travar em 4 rótulos
        // fixos (a lista de prioridades é configurável, ver config_priorities).
        const priorityRank = config?.sla_hours ?? Number.MAX_SAFE_INTEGER;
        return { ticket: t, isOverdue, isNear, tier, slaLimit, priorityRank };
      });

    withUrgency.sort((a, b) => {
      switch (kanbanPrefs.sortBy) {
        case 'created_desc':
          return new Date(b.ticket.createdAt).getTime() - new Date(a.ticket.createdAt).getTime();
        case 'created_asc':
          return new Date(a.ticket.createdAt).getTime() - new Date(b.ticket.createdAt).getTime();
        case 'priority':
          return a.priorityRank - b.priorityRank;
        case 'number':
          return (b.ticket.ticketNumber || 0) - (a.ticket.ticketNumber || 0);
        case 'title':
          return a.ticket.title.localeCompare(b.ticket.title, 'pt-BR');
        case 'urgency':
        default:
          if (a.tier !== b.tier) return a.tier - b.tier;
          if (a.tier < 2) return (a.slaLimit?.getTime() || 0) - (b.slaLimit?.getTime() || 0);
          return new Date(b.ticket.createdAt).getTime() - new Date(a.ticket.createdAt).getTime();
      }
    });
    return withUrgency;
  }, [kanbanPrefs.view, kanbanPrefs.sortBy, columns, filteredTickets, priorities]);

  const stats = useMemo(() => {
    const total = filteredTickets.length;
    const now = new Date();
    
    // Alertas críticos sempre usam todos os chamados
    const unassigned = allTickets.filter(t => t.status === TicketStatus.NEW && !t.assigneeId).length;
    const allActive = allTickets.filter(t => !isClosedTicketStatus(t.status));
    
    const overdue = allActive.filter(t => {
      const config = priorities.find(p => p.label === t.priority);
      if (!config || !config.sla_hours) return false;
      const limit = addBusinessHours(t.createdAt, config.sla_hours);
      return limit < now;
    }).length;

    const nearExpiry = allActive.filter(t => {
      const config = priorities.find(p => p.label === t.priority);
      if (!config || !config.sla_hours) return false;
      const limit = addBusinessHours(t.createdAt, config.sla_hours);
      const diff = limit.getTime() - now.getTime();
      return diff > 0 && diff < 4 * 60 * 60 * 1000; // 4 hours
    }).length;

    const inProgress = filteredTickets.filter(t => isInProgressTicketStatus(t.status)).length;
    const closed = filteredTickets.filter(t => isClosedTicketStatus(t.status)).length;
    const analystTickets = filteredTickets.filter(t => t.assigneeId === currentUser?.id).length;

    return { total, overdue, nearExpiry, inProgress, closed, unassigned, analystTickets };
  }, [filteredTickets, allTickets, currentUser, priorities]);

  const groupedTickets = useMemo(() => {
    const groups: { [key: string]: TicketType[] } = {};
    // Mesmo filtro de baseColumns: sub-status nunca aparece em tickets.status,
    // agrupar por ele só criaria uma entrada vazia.
    statuses.filter(s => !s.parentStatusId).forEach(s => {
      groups[s.label] = filteredTickets.filter(t => t.status === s.label);
    });
    return groups;
  }, [filteredTickets, statuses]);

  if (currentUser && !hasPermission(Permission.DASHBOARD_VIEW)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar o dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            {dashboardMode === 'tickets' ? 'Visão Geral' : 'Visão Geral — Tickets Internos'}
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium">
            {dashboardMode === 'tickets' ? 'Controle de fluxo e produtividade em tempo real' : 'Acompanhamento dos tickets de operação interna'}
          </p>
          {/* Indicador de sincronização mora aqui (bloco do título, fixo),
              não na fileira de botões — senão ele empurra o toggle/botão
              "Novo ..." de lugar sempre que aparece/some. */}
          {(dashboardMode === 'tickets' ? loading : loadingInternal) && (
            <div className="flex items-center gap-1.5 mt-1 text-[var(--text-tertiary)] animate-pulse">
              <div className="w-3 h-3 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-[10px] font-semibold uppercase tracking-widest">Sincronizando...</span>
            </div>
          )}
        </div>
        {/* Toggle e botão "Novo ..." ficam sempre nas mesmas duas posições
            desta fileira, nos dois modos — os alertas de "Sem Analista" /
            "Vencidos" (redundantes com os StatCards logo abaixo, que já
            pulsam quando há pendência) saíram daqui de propósito, era o que
            fazia o botão mudar de lugar ao trocar de aba. */}
        <div className="flex flex-wrap items-center gap-4">
          {canSeeTickets && canSeeInternal && (
            <div className="flex items-center gap-1 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)]">
              <button
                onClick={() => setDashboardMode('tickets')}
                className={cn(
                  "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
                  dashboardMode === 'tickets' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                <TicketIcon size={14} /> Chamados
              </button>
              <button
                onClick={() => setDashboardMode('internal')}
                className={cn(
                  "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
                  dashboardMode === 'internal' ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                <FolderKanban size={14} /> Tickets Internos
              </button>
            </div>
          )}

          {(dashboardMode === 'tickets' ? canSeeTickets : canSeeInternal) && (
            <button
              onClick={() => dashboardMode === 'tickets' ? setIsNewTicketModalOpen(true) : router.push('/tickets?mode=internal&new=1')}
              className={cn(
                "text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center gap-2 whitespace-nowrap focus:outline-none focus:ring-2",
                dashboardMode === 'tickets' ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)] focus:ring-[var(--accent)]/40" : "bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] focus:ring-[var(--text-warning-strong)]/40"
              )}
            >
              <Plus size={18} />
              {dashboardMode === 'tickets' ? 'Novo Chamado' : 'Novo Ticket Interno'}
            </button>
          )}
        </div>
      </div>

      {/* Alertas de "Sem Analista" / "Vencidos" — fileira própria, abaixo do
          cabeçalho, pra não empurrar o toggle/botão "Novo ..." de lugar
          quando aparecem/somem (era o que acontecia quando ficavam na mesma
          linha dos botões). */}
      {dashboardMode === 'tickets' && canSeeTickets && (stats.unassigned > 0 || stats.overdue > 0) && (
        <div className="flex flex-wrap items-center gap-3 -mt-4">
          {stats.unassigned > 0 && (
            <div className="flex items-center gap-2 bg-[var(--surface-danger)] border border-[var(--text-danger)]/30 px-4 py-2 rounded-xl text-[var(--text-danger)] animate-pulse whitespace-nowrap">
              <AlertCircle size={18} />
              <span className="text-[10px] font-semibold uppercase tracking-widest">{stats.unassigned} Novos Sem Analista</span>
            </div>
          )}
          {stats.overdue > 0 && (
            <div className="flex items-center gap-2 bg-[var(--text-danger)] px-4 py-2 rounded-xl text-white whitespace-nowrap shadow-md">
              <span className="text-[10px] font-semibold uppercase tracking-widest">{stats.overdue} Vencidos</span>
            </div>
          )}
        </div>
      )}

      {dashboardMode === 'tickets' && canSeeTickets ? (
      <>
      <FilterBar
        originalTickets={allTickets}
        onFilterChange={(filtered) => setFilteredTickets(filtered)}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Total em Aberto"
          value={filteredTickets.filter(t => !isClosedTicketStatus(t.status)).length}
          color="bg-[var(--accent)]"
          textColor="text-white"
          icon={<AlertCircle size={14} />}
          highlight
        />
        <StatCard
          label="SLA Vencido"
          value={stats.overdue}
          color={stats.overdue > 0 ? "bg-[var(--surface-danger)] border-[var(--text-danger)]/30" : "bg-[var(--surface-card)]"}
          textColor="text-[var(--text-danger)]"
          icon={<AlertCircle size={14} className="text-[var(--text-danger)]" />}
          pulse={stats.overdue > 0}
        />
        <StatCard
          label="Próximos do Vencimento"
          value={stats.nearExpiry}
          color={stats.nearExpiry > 0 ? "bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30" : "bg-[var(--surface-card)]"}
          textColor="text-orange-600 dark:text-orange-400"
          icon={<Clock size={14} className="text-orange-500 dark:text-orange-400" />}
        />
        <StatCard
          label="Novos Sem Analista"
          value={stats.unassigned}
          color={stats.unassigned > 0 ? "bg-[var(--surface-warning)] border-[var(--border-alert)]" : "bg-[var(--surface-card)]"}
          textColor="text-[var(--text-warning)]"
          icon={<User size={14} className="text-[var(--text-warning-strong)]" />}
        />
      </div>

      {/* Seção de Chamados Prioritários */}
      {(stats.overdue > 0 || stats.nearExpiry > 0 || stats.unassigned > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-2">
             <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-danger)] animate-pulse" />
             <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Chamados Prioritários</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Lista de Vencidos */}
            <PriorityList 
              title="SLA Vencido" 
              tickets={allTickets.filter(t => {
                const config = priorities.find(p => p.label === t.priority);
                if (!config || !config.sla_hours || isClosedTicketStatus(t.status)) return false;
                const limit = addBusinessHours(t.createdAt, config.sla_hours);
                return limit < new Date();
              })}
              color="rose"
              onSelect={setSelectedTicket}
              priorities={priorities}
              users={users}
            />
            
            {/* Lista de Próximos do Vencimento */}
            <PriorityList 
              title="Próximos do Vencimento" 
              tickets={allTickets.filter(t => {
                const config = priorities.find(p => p.label === t.priority);
                if (!config || !config.sla_hours || isClosedTicketStatus(t.status)) return false;
                const limit = addBusinessHours(t.createdAt, config.sla_hours);
                const diff = limit.getTime() - new Date().getTime();
                return diff > 0 && diff < 4 * 60 * 60 * 1000;
              })}
              color="orange"
              onSelect={setSelectedTicket}
              priorities={priorities}
              users={users}
            />

            {/* Novos Sem Analista */}
            <PriorityList 
              title="Sem Analistas" 
              tickets={allTickets.filter(t => t.status === TicketStatus.NEW && !t.assigneeId)}
              color="amber"
              onSelect={setSelectedTicket}
              priorities={priorities}
              users={users}
            />
          </div>
        </div>
      )}

      {/* Barra de ferramentas do board: alterna Kanban/Lista e abre o
          organizador de colunas (ordem + ocultar), preferência salva por
          usuário (ver app/api/dashboard-prefs). */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)]">
          <button
            onClick={() => persistKanbanPrefs({ view: 'kanban' })}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
              kanbanPrefs.view !== 'list' ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <LayoutGrid size={13} /> Kanban
          </button>
          <button
            onClick={() => persistKanbanPrefs({ view: 'list' })}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
              kanbanPrefs.view === 'list' ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <ListIcon size={13} /> Lista
          </button>
        </div>

        {kanbanPrefs.view === 'list' && (
          <div className="flex items-center gap-2">
            <label htmlFor="dashboard-list-sort" className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Ordenar por</label>
            <select
              id="dashboard-list-sort"
              value={kanbanPrefs.sortBy}
              onChange={(e) => persistKanbanPrefs({ sortBy: e.target.value as DashboardListSort })}
              className="text-xs font-semibold bg-[var(--surface-pill)] border border-[var(--border-default)] rounded-lg px-2.5 py-2 text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] transition-all"
            >
              {LIST_SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {kanbanPrefs.view !== 'list' && (
          <div className="relative" ref={columnSettingsRef}>
            <button
              onClick={() => setShowColumnSettings(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
            >
              <Settings2 size={13} /> Colunas
            </button>
            {showColumnSettings && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl p-3 z-20">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Organizar colunas</span>
                  <button onClick={resetColumnPrefs} className="text-[10px] font-semibold text-[var(--accent-text)] hover:underline">Restaurar</button>
                </div>
                <div className="space-y-0.5 max-h-[280px] overflow-y-auto scrollbar-thin">
                  {orderedAllColumns.map((col, idx) => {
                    const isHidden = kanbanPrefs.hidden.includes(col.status);
                    return (
                      <div key={col.status} className={cn("flex items-center gap-1.5 px-2 py-1.5 rounded-lg", isHidden ? "opacity-50" : "hover:bg-[var(--surface-pill)]")}>
                        <div className="flex flex-col -my-1 shrink-0">
                          <button
                            disabled={idx === 0}
                            onClick={() => moveColumn(col.status, -1)}
                            title="Mover pra cima"
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-20 disabled:pointer-events-none"
                          >
                            <ChevronUp size={12} />
                          </button>
                          <button
                            disabled={idx === orderedAllColumns.length - 1}
                            onClick={() => moveColumn(col.status, 1)}
                            title="Mover pra baixo"
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-20 disabled:pointer-events-none"
                          >
                            <ChevronDown size={12} />
                          </button>
                        </div>
                        <span className="flex-1 min-w-0 truncate text-xs font-semibold text-[var(--text-secondary)]">{col.title}</span>
                        <button
                          onClick={() => toggleColumnHidden(col.status)}
                          title={isHidden ? 'Mostrar coluna' : 'Ocultar coluna'}
                          className="shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        >
                          {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {kanbanPrefs.view === 'list' ? (
        <div className="bg-[var(--surface-pill)]/50 rounded-2xl border border-dashed border-[var(--border-default)] divide-y divide-[var(--border-default)] overflow-hidden">
          {listTickets.length === 0 ? (
            <p className="text-center text-[11px] font-semibold text-[var(--text-tertiary)] py-8">Nenhum chamado</p>
          ) : (
            listTickets.slice(0, 50).map(({ ticket, isOverdue, isNear }) => (
              <ListTicketRow
                key={ticket.id}
                ticket={ticket}
                statusColor={statusColorMap.get(ticket.status) || findStatusColor(undefined)}
                isOverdue={isOverdue}
                isNear={isNear}
                priorities={priorities}
                users={users}
                onClick={() => setSelectedTicket(ticket)}
              />
            ))
          )}
          {listTickets.length > 50 && (
            <button
              onClick={() => router.push('/tickets')}
              className="w-full py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors bg-[var(--surface-card)]/50"
            >
              Ver mais {listTickets.length - 50} chamados
            </button>
          )}
        </div>
      ) : (
        /* Kanban estilo Bitrix: uma fileira só, colunas de largura fixa e
           estreita, scroll horizontal único (nunca quebra linha). O CSS Grid
           que existia antes (md:grid-cols-4/5) entrava em conflito com o
           minWidth forçado pra caber todas as colunas — com mais colunas do
           que o número de tracks do grid, ele quebrava pra uma 2ª linha e
           esticava a largura de cada coluna de forma inconsistente. Flex
           resolve porque cada coluna tem largura própria e o container só
           rola, nunca quebra. */
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-4 md:overflow-x-auto md:scrollbar-thin md:pb-4">
          {columns.map(col => {
            const colTickets = groupedTickets[col.status] || [];
            const displayTickets = colTickets.slice(0, 20); // Only render first 20 for performance
            const hasMore = colTickets.length > 20;

            return (
              <div key={col.status} className="flex flex-col gap-3 md:w-[248px] md:shrink-0">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{col.title}</h3>
                  <span className="bg-[var(--border-default)] text-[var(--text-secondary)] text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {colTickets.length}
                  </span>
                </div>
                {/* Altura fixa por coluna (md+) em vez de crescer com a
                    quantidade de chamados — clamp() acompanha a tela do
                    usuário (nunca menor que 280px nem maior que 640px) sem
                    precisar recalcular via JS. Rola por dentro (scrollbar já
                    fina/minimalista por padrão, ver app/globals.css) — no
                    mobile continua no tamanho do conteúdo, empilhado com o
                    resto da página. */}
                <div className="bg-[var(--surface-pill)]/50 rounded-2xl p-3 space-y-3 border border-dashed border-[var(--border-default)] md:h-[clamp(280px,calc(100vh_-_460px),640px)] md:overflow-y-auto">
                  {displayTickets.map(ticket => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      availablePriorities={priorities}
                      users={users}
                      onClick={() => setSelectedTicket(ticket)}
                    />
                  ))}
                  {hasMore && (
                    <button
                      onClick={() => router.push(`/tickets?status=${col.status}`)}
                      className="w-full py-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] transition-colors bg-[var(--surface-card)]/50 rounded-xl border border-dashed border-[var(--border-default)]"
                    >
                      Ver mais {colTickets.length - 20} chamados
                    </button>
                  )}
                  {colTickets.length === 0 && (
                    <p className="text-center text-[11px] font-semibold text-[var(--text-tertiary)] py-6">Nenhum chamado</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      ) : canSeeInternal ? (
        <InternalDashboard tickets={internalTickets} loading={loadingInternal} router={router} statuses={internalStatuses} />
      ) : null}

      <AnimatePresence>
        {selectedTicket && (
          <TicketDetailModal
            ticket={selectedTicket}
            onClose={async () => {
              setSelectedTicket(null);
              const loaded = await fetchAllTickets();
              setAllTickets(loaded);
              setFilteredTickets(loaded);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Painel "Tickets Internos" do dashboard geral — mesma linguagem visual do
// board de chamados acima (StatCard, colunas por status), com dados e cores
// vindas de config_statuses (scope=internal_ticket), igual /internal-tickets.
function InternalDashboard({ tickets, loading, router, statuses }: { tickets: InternalTicketItem[]; loading: boolean; router: ReturnType<typeof useRouter>; statuses: InternalStatusMeta[] }) {
  const stats = useMemo(() => {
    const now = new Date();
    const active = tickets.filter(t => !isClosedTicketStatus(t.status));

    const overdue = active.filter(t => t.slaLimit && new Date(t.slaLimit) < now);
    const nearExpiry = active.filter(t => {
      if (!t.slaLimit) return false;
      const diff = new Date(t.slaLimit).getTime() - now.getTime();
      return diff > 0 && diff < 4 * 60 * 60 * 1000; // 4 horas
    });
    // Mesma semântica de "Novos Sem Analista" dos chamados: só o que acabou
    // de chegar e ninguém pegou ainda, não qualquer ticket ativo sem dono.
    const unassignedNew = active.filter(t => t.status === 'Novo' && !t.assigneeId);
    const highPriority = active.filter(t => t.priority === 3);
    // "Parado" é um sinal diferente de SLA vencido: SLA é opcional em ticket
    // interno (poucos analistas preenchem), então isso cobre o caso mais
    // comum — o ticket simplesmente não anda há dias.
    const stale = active.filter(t => {
      if (!t.updatedAt) return false;
      const days = (now.getTime() - new Date(t.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return days >= 3;
    }).sort((a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime());

    return { active: active.length, overdue, nearExpiry, unassignedNew, highPriority, stale };
  }, [tickets]);

  const workload = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; thumbUrl?: string | null }>();
    tickets.filter(t => !isClosedTicketStatus(t.status) && t.assigneeId).forEach(t => {
      const key = t.assigneeId as string;
      // A miniatura viaja no próprio item (não há a lista de perfis aqui
      // dentro — este é um componente filho que só recebe `tickets`).
      const entry = map.get(key) || { id: key, name: t.assigneeName || 'Analista', count: 0, thumbUrl: t.assigneeAvatarThumbUrl };
      entry.count += 1;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [tickets]);

  const columns = statuses.map(status => ({
    ...status,
    tickets: tickets.filter(t => (t.status || 'Novo') === status.value)
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[var(--text-warning-strong)]/30 border-t-[var(--text-warning-strong)] rounded-full animate-spin" />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="bg-[var(--surface-card)] border-2 border-dashed border-[var(--border-default)] rounded-2xl p-12 text-center">
        <FolderKanban size={40} className="mx-auto text-slate-300 mb-4" />
        <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">Nenhum ticket interno por aqui</h3>
        <p className="text-[var(--text-tertiary)] text-sm">Sua equipe ainda não tem tickets internos registrados.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard label="Total Ativos" value={stats.active} color="bg-[var(--text-warning-strong)]" textColor="text-white" icon={<FolderKanban size={14} />} highlight />
        <StatCard label="SLA Vencido" value={stats.overdue.length} color={stats.overdue.length > 0 ? "bg-[var(--surface-danger)] border-[var(--text-danger)]/30" : "bg-[var(--surface-card)]"} textColor="text-[var(--text-danger)]" icon={<AlertCircle size={14} className="text-[var(--text-danger)]" />} pulse={stats.overdue.length > 0} />
        <StatCard label="Próximos do Vencimento" value={stats.nearExpiry.length} color={stats.nearExpiry.length > 0 ? "bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30" : "bg-[var(--surface-card)]"} textColor="text-orange-600 dark:text-orange-400" icon={<Clock size={14} className="text-orange-500 dark:text-orange-400" />} />
        <StatCard label="Novos Sem Responsável" value={stats.unassignedNew.length} color={stats.unassignedNew.length > 0 ? "bg-[var(--surface-warning)] border-[var(--border-alert)]" : "bg-[var(--surface-card)]"} textColor="text-[var(--text-warning)]" icon={<User size={14} className="text-[var(--text-warning-strong)]" />} />
      </div>

      {(stats.overdue.length > 0 || stats.nearExpiry.length > 0 || stats.unassignedNew.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-2">
             <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-danger)] animate-pulse" />
             <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Tickets Internos Prioritários</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <InternalPriorityList title="SLA Vencido" tickets={stats.overdue} color="rose" router={router} />
            <InternalPriorityList title="Próximos do Vencimento" tickets={stats.nearExpiry} color="orange" router={router} />
            <InternalPriorityList title="Novos Sem Responsável" tickets={stats.unassignedNew} color="amber" router={router} />
          </div>
        </div>
      )}

      {(workload.length > 0 || stats.stale.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {workload.length > 0 && (
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-3 flex items-center gap-2">
                <Users size={13} /> Carga da Equipe
              </h3>
              <div className="space-y-2.5">
                {workload.map(w => (
                  <div key={w.id} className="flex items-center gap-3">
                    <UserAvatar
                      name={w.name}
                      thumbUrl={w.thumbUrl}
                      size={24}
                      fallbackClassName="bg-[var(--accent)]/15 text-[var(--accent-text)] font-black"
                    />
                    <span className="text-xs font-semibold text-[var(--text-secondary)] flex-1 truncate">{w.name}</span>
                    <div className="w-24 h-1.5 bg-[var(--surface-pill)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.min(100, (w.count / (workload[0]?.count || 1)) * 100)}%` }} />
                    </div>
                    <span className={cn("text-xs font-bold w-4 text-right", w.count >= 6 ? "text-[var(--text-danger)]" : "text-[var(--text-tertiary)]")}>{w.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.stale.length > 0 && (
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-tertiary)] mb-3 flex items-center gap-2">
                <Clock size={13} /> Sem Movimento (3+ dias)
              </h3>
              <div className="space-y-2 max-h-[160px] overflow-y-auto scrollbar-thin pr-1">
                {stats.stale.slice(0, 5).map(t => (
                  <div
                    key={t.uuid}
                    onClick={() => router.push(`/internal-tickets/${t.uuid}`)}
                    className="cursor-pointer flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-[var(--surface-pill)] transition-colors"
                  >
                    <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">{t.title}</span>
                    <span className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase shrink-0">{t.displayId}</span>
                  </div>
                ))}
                {stats.stale.length > 5 && (
                  <p className="text-[9px] text-[var(--text-tertiary)] uppercase font-semibold tracking-wide pt-1">+ {stats.stale.length - 5} tickets</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 flex-1 min-h-[500px] items-start mt-2">
        {columns.map(col => (
          <div key={col.value} className="rounded-2xl border-t-4 bg-[var(--surface-card)] overflow-hidden" style={{ borderTopColor: col.accent }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
              <span className={cn("w-2 h-2 rounded-full", col.dot)} />
              <h3 className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">{col.label}</h3>
              <span className="text-[10px] font-bold text-[var(--text-tertiary)] ml-auto bg-[var(--surface-pill)] px-2 py-0.5 rounded-full">{col.tickets.length}</span>
            </div>
            <div className="p-3 space-y-2.5 min-h-[100px] max-h-[440px] overflow-y-auto">
              {col.tickets.length === 0 ? (
                <p className="text-center py-8 text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">Vazio</p>
              ) : (
                col.tickets.slice(0, 15).map(ticket => {
                  const isOverdue = ticket.slaRemaining === 'Expirado';
                  return (
                    <div
                      key={ticket.uuid}
                      onClick={() => router.push(`/internal-tickets/${ticket.uuid}`)}
                      className="bg-[var(--surface-card)] rounded-xl p-3.5 border border-[var(--border-default)] hover:shadow-md hover:border-[var(--text-warning-strong)]/40 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-[10px] font-semibold text-[var(--text-warning)]">{ticket.displayId}</span>
                        <div className="flex items-end gap-[3px]">
                          {[0, 1, 2].map(i => (
                            <div key={i} className={cn("w-[3px] rounded-full", i === 0 ? "h-2" : i === 1 ? "h-3" : "h-4", i < (ticket.priority || 1) ? (ticket.priority === 3 ? "bg-[var(--text-danger)]" : "bg-[var(--text-warning-strong)]") : "bg-[var(--border-default)]")} />
                          ))}
                        </div>
                      </div>
                      <h4 className="font-bold text-[var(--text-primary)] text-sm mb-2 line-clamp-2 leading-snug">{ticket.title}</h4>
                      <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
                        {isOverdue ? (
                          <span className="flex items-center gap-1 font-bold text-[var(--text-danger)]"><Clock size={11} />Atrasado</span>
                        ) : ticket.slaRemaining ? (
                          <span className="flex items-center gap-1 font-semibold text-orange-600 dark:text-orange-400"><Clock size={11} />{ticket.slaRemaining}</span>
                        ) : <span className="truncate max-w-[100px]">{ticket.teamId || 'Sem equipe'}</span>}
                        {ticket.assigneeName ? (
                          <UserAvatar
                            name={ticket.assigneeName}
                            thumbUrl={ticket.assigneeAvatarThumbUrl}
                            size={20}
                            fallbackClassName="bg-[var(--accent)]/15 text-[var(--accent-text)] font-black"
                          />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-[var(--surface-pill)] border border-dashed border-[var(--border-default)] flex items-center justify-center">
                            <User size={11} className="text-[var(--text-tertiary)]" />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function InternalPriorityList({ title, tickets, color, router }: {
  title: string,
  tickets: InternalTicketItem[],
  color: 'rose' | 'orange' | 'amber',
  router: ReturnType<typeof useRouter>
}) {
  if (tickets.length === 0) return null;

  const bgColors = {
    rose: "bg-[var(--surface-danger)] border-[var(--text-danger)]/20",
    orange: "bg-orange-50 dark:bg-orange-500/10 border-orange-100 dark:border-orange-500/20",
    amber: "bg-[var(--surface-warning)] border-[var(--border-alert)]"
  };

  const textColors = {
    rose: "text-[var(--text-danger)]",
    orange: "text-orange-600 dark:text-orange-400",
    amber: "text-[var(--text-warning)]"
  };

  const bulletColors = {
    rose: "bg-[var(--text-danger)]",
    orange: "bg-orange-500 dark:bg-orange-500",
    amber: "bg-[var(--text-warning-strong)]"
  };

  return (
    <div className={cn("p-4 rounded-2xl border border-dashed flex flex-col gap-3", bgColors[color])}>
      <h4 className={cn("text-[10px] font-semibold uppercase tracking-wider flex items-center gap-2", textColors[color])}>
        <div className={cn("w-1 h-1 rounded-full", bulletColors[color])} />
        {title} ({tickets.length})
      </h4>
      <div className="space-y-2 max-h-[160px] overflow-y-auto scrollbar-thin pr-1">
        {tickets.slice(0, 5).map(t => (
          <div
            key={t.uuid}
            onClick={() => router.push(`/internal-tickets/${t.uuid}`)}
            className="group cursor-pointer bg-[var(--surface-card)]/80 backdrop-blur-sm p-3 rounded-xl border border-[var(--surface-card)] hover:border-[var(--border-default)] transition-all flex items-center justify-between gap-3 shadow-sm"
          >
            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-semibold text-[var(--text-secondary)] truncate group-hover:text-[var(--accent-text)] transition-colors">
                {t.title}
              </h5>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-tighter">{t.displayId}</span>
                <span className="text-[9px] text-[var(--text-tertiary)]">•</span>
                {t.assigneeName ? (
                  <div className="flex items-center gap-1">
                    <UserAvatar
                      name={t.assigneeName}
                      thumbUrl={t.assigneeAvatarThumbUrl}
                      size={16}
                      rounded="rounded"
                      fallbackClassName="bg-[var(--accent)]/15 text-[var(--accent-text)]"
                    />
                    <span className="text-[9px] text-[var(--text-tertiary)] font-semibold truncate max-w-[80px]">{t.assigneeName.split(' ')[0]}</span>
                  </div>
                ) : (
                  <span className="text-[9px] text-[var(--text-warning-strong)] font-semibold uppercase tracking-tighter">Não atribuído</span>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-end gap-[3px]">
              {[0, 1, 2].map(i => (
                <div key={i} className={cn("w-[3px] rounded-full", i === 0 ? "h-2" : i === 1 ? "h-3" : "h-4", i < (t.priority || 1) ? (t.priority === 3 ? "bg-[var(--text-danger)]" : "bg-[var(--text-warning-strong)]") : "bg-[var(--border-default)]")} />
              ))}
            </div>
          </div>
        ))}
        {tickets.length > 5 && (
          <button
            onClick={() => router.push('/tickets?mode=internal')}
            className="w-full py-1 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-[var(--accent-text)]"
          >
            + {tickets.length - 5} tickets
          </button>
        )}
      </div>
    </div>
  );
}

function PriorityList({ title, tickets, color, onSelect, priorities, users }: {
  title: string, 
  tickets: TicketType[], 
  color: 'rose' | 'orange' | 'amber',
  onSelect: (t: TicketType) => void,
  priorities: any[],
  users: any[]
}) {
  if (tickets.length === 0) return null;

  const bgColors = {
    rose: "bg-[var(--surface-danger)] border-[var(--text-danger)]/20",
    orange: "bg-orange-50 dark:bg-orange-500/10 border-orange-100 dark:border-orange-500/20",
    amber: "bg-[var(--surface-warning)] border-[var(--border-alert)]"
  };

  const textColors = {
    rose: "text-[var(--text-danger)]",
    orange: "text-orange-600 dark:text-orange-400",
    amber: "text-[var(--text-warning)]"
  };

  const bulletColors = {
    rose: "bg-[var(--text-danger)]",
    orange: "bg-orange-500 dark:bg-orange-500",
    amber: "bg-[var(--text-warning-strong)]"
  };

  return (
    <div className={cn("p-4 rounded-2xl border border-dashed flex flex-col gap-3", bgColors[color])}>
      <div className="flex items-center justify-between">
        <h4 className={cn("text-[10px] font-semibold uppercase tracking-wider flex items-center gap-2", textColors[color])}>
          <div className={cn("w-1 h-1 rounded-full", bulletColors[color])} />
          {title} ({tickets.length})
        </h4>
      </div>
      <div className="space-y-2 max-h-[160px] overflow-y-auto scrollbar-thin pr-1">
        {tickets.slice(0, 5).map(t => {
          const assignee = t.assigneeId ? users.find(u => u.id === t.assigneeId) : null;
          return (
            <div
              key={t.id}
              onClick={() => onSelect(t)}
              className="group cursor-pointer bg-[var(--surface-card)]/80 backdrop-blur-sm p-3 rounded-xl border border-[var(--surface-card)] hover:border-[var(--border-default)] transition-all flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <h5 className="text-xs font-semibold text-[var(--text-secondary)] truncate group-hover:text-[var(--accent-text)] transition-colors">
                  {t.title}
                </h5>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-tighter">#{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}</span>
                  <span className="text-[9px] text-[var(--text-tertiary)]">•</span>
                  {assignee ? (
                    <div className="flex items-center gap-1">
                      <UserAvatar
                        name={assignee.name}
                        thumbUrl={(assignee as any).avatarThumbUrl}
                        size={16}
                        rounded="rounded"
                        fallbackClassName="bg-[var(--accent)]/15 text-[var(--accent-text)]"
                      />
                      <span className="text-[9px] text-[var(--text-tertiary)] font-semibold truncate max-w-[80px]">{assignee.name.split(' ')[0]}</span>
                    </div>
                  ) : (
                    <span className="text-[9px] text-[var(--text-warning-strong)] font-semibold uppercase tracking-tighter">Não atribuído</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                 <div className={cn(
                   "text-[8px] font-semibold px-2 py-0.5 rounded uppercase tracking-tighter",
                   priorities.find(p => p.label === t.priority)?.color || "bg-[var(--surface-pill)] text-[var(--text-secondary)]"
                 )}>
                   {t.priority}
                 </div>
              </div>
            </div>
          );
        })}
        {tickets.length > 5 && (
          <button className="w-full py-1 text-[9px] font-semibold uppercase text-[var(--text-tertiary)] hover:text-[var(--accent-text)]">
            + {tickets.length - 5} chamados
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, textColor, icon, highlight, pulse }: { 
  label: string, 
  value: number, 
  color: string, 
  textColor?: string,
  icon?: React.ReactNode,
  highlight?: boolean,
  pulse?: boolean
}) {
  if (highlight) {
    return (
      <div className={cn(color, "p-6 rounded-2xl text-white shadow-lg shadow-[var(--accent)]/20 flex flex-col justify-between")}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] opacity-70 uppercase font-semibold tracking-widest">{label}</p>
          {icon}
        </div>
        <p className="text-3xl font-bold">{value}</p>
      </div>
    );
  }
  return (
    <div className={cn(
      "p-6 rounded-2xl border transition-all duration-500 flex flex-col justify-between",
      color,
      !color.includes('border') && "border-[var(--border-default)] shadow-sm",
      pulse && "animate-[pulse_2s_infinite]"
    )}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">{label}</p>
        <div className="opacity-50">{icon}</div>
      </div>
      <p className={cn("text-3xl font-bold", textColor || "text-[var(--text-primary)]")}>{value}</p>
    </div>
  );
}

// Linha compacta do modo "Lista" — mesma informação do TicketCard (status,
// prioridade, número, título, responsável, SLA), só que numa linha em vez de
// cartão, já que aqui os chamados de status diferentes ficam misturados.
function ListTicketRow({ ticket, statusColor, isOverdue, isNear, priorities, users, onClick }: {
  ticket: TicketType;
  statusColor: { dot: string };
  isOverdue: boolean;
  isNear: boolean;
  priorities: any[];
  users: any[];
  onClick: () => void;
}) {
  const priorityConfig = priorities.find(p => p.label === ticket.priority);
  const assignee = ticket.assigneeId ? users.find(u => u.id === ticket.assigneeId) : null;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-card)] transition-colors"
    >
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusColor.dot)} title={ticket.status} />
      <span className={cn(
        "shrink-0 hidden sm:inline-block text-[9px] font-semibold px-2 py-0.5 rounded uppercase tracking-tighter",
        priorityConfig?.color || 'bg-[var(--surface-pill)] text-[var(--text-secondary)]'
      )}>
        {ticket.priority}
      </span>
      <span className="shrink-0 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">
        #{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}
      </span>
      <h3 className="flex-1 min-w-0 truncate text-xs font-semibold text-[var(--text-primary)]">{ticket.title}</h3>
      {(isOverdue || isNear) && (
        <span className={cn(
          "shrink-0 text-[8px] font-semibold px-2 py-0.5 rounded uppercase tracking-tighter text-white",
          isOverdue ? "bg-[var(--text-danger)]" : "bg-orange-500 dark:bg-orange-500"
        )}>
          {isOverdue ? 'Vencido' : 'Expira logo'}
        </span>
      )}
      <div className="shrink-0 hidden sm:flex items-center gap-1.5 w-[110px] justify-end">
        {assignee ? (
          <>
            <UserAvatar
              name={assignee.name}
              thumbUrl={(assignee as any).avatarThumbUrl}
              size={16}
              rounded="rounded"
              fallbackClassName="bg-[var(--accent)]/15 text-[var(--accent-text)]"
            />
            <span className="text-[9px] text-[var(--text-tertiary)] font-semibold truncate">{assignee.name.split(' ')[0]}</span>
          </>
        ) : (
          <span className="text-[9px] text-[var(--text-warning-strong)] font-semibold uppercase tracking-tighter">Sem analista</span>
        )}
      </div>
      <span className="shrink-0 hidden md:inline text-[9px] text-[var(--text-tertiary)] font-medium w-[70px] text-right">
        {new Date(ticket.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' })}
      </span>
    </div>
  );
}

function TicketCard({ ticket, availablePriorities, users, onClick }: { ticket: TicketType, availablePriorities: any[], users: any[], onClick: () => void }) {
  const priorityConfig = availablePriorities.find(p => p.label === ticket.priority) || 
                       availablePriorities.find(p => p.label === 'Baixa') || 
                       availablePriorities[0];

  const assignee = ticket.assigneeId ? users.find(u => u.id === ticket.assigneeId) : null;
  const isUnassignedNew = ticket.status === TicketStatus.NEW && !ticket.assigneeId;

  const now = new Date();
  
  // Dynamic SLA limit calculation
  const slaLimit = useMemo(() => {
    if (!priorityConfig || !priorityConfig.sla_hours) return null;
    return addBusinessHours(ticket.createdAt, priorityConfig.sla_hours);
  }, [ticket.createdAt, priorityConfig]);

  const isOverdue = slaLimit && slaLimit < now && !isClosedTicketStatus(ticket.status);
  const isNear = slaLimit && !isOverdue && (slaLimit.getTime() - now.getTime() < 4 * 60 * 60 * 1000) && !isClosedTicketStatus(ticket.status);

  const formatDate = (date: Date) => {
    return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <motion.div
      layoutId={ticket.id}
      onClick={onClick}
      className={cn(
        "bg-[var(--surface-card)] p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md active:scale-[0.98] shadow-sm relative overflow-hidden group",
        isUnassignedNew
          ? "border-[var(--border-alert)] bg-[var(--surface-warning)]/10"
          : isOverdue
            ? "border-[var(--text-danger)]/30 bg-[var(--surface-danger)]/10"
            : isNear
              ? "border-orange-200 dark:border-orange-500/30 bg-orange-50/10 dark:bg-orange-500/10"
              : "border-[var(--border-default)] hover:border-[var(--accent)]/40"
      )}
    >
      {/* Indicador lateral de status */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1",
        isOverdue ? "bg-[var(--text-danger)]" : isNear ? "bg-orange-500 dark:bg-orange-500" : isUnassignedNew ? "bg-[var(--text-warning-strong)]" : "bg-transparent"
      )} />

      {isOverdue && <div className="absolute top-0 right-0 bg-[var(--text-danger)] text-white text-[8px] font-semibold px-2 py-0.5 rounded-bl uppercase tracking-tighter">SLA Vencido</div>}
      {isNear && <div className="absolute top-0 right-0 bg-orange-500 dark:bg-orange-500 text-white text-[8px] font-semibold px-2 py-0.5 rounded-bl uppercase tracking-tighter">Expira logo</div>}
      {isUnassignedNew && <div className="absolute top-0 right-0 bg-[var(--text-warning-strong)] text-white text-[8px] font-semibold px-2 py-0.5 rounded-bl uppercase tracking-tighter">Sem Analista</div>}

      <div className="flex items-start justify-between mb-3">
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase", priorityConfig?.color || 'bg-[var(--surface-pill)] text-[var(--text-secondary)]')}>
          {ticket.priority}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
      </div>
      <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1 line-clamp-2 leading-tight">{ticket.title}</h3>

      {slaLimit && !isClosedTicketStatus(ticket.status) && (
        <div className={cn(
          "text-[9px] font-semibold uppercase mb-3 flex items-center gap-1",
          isOverdue ? "text-[var(--text-danger)]" : isNear ? "text-orange-600 dark:text-orange-400" : "text-[var(--text-tertiary)]"
        )}>
          <Clock size={10} />
          Vence {formatDate(slaLimit)}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-[var(--border-default)] mt-2 text-[10px] text-[var(--text-tertiary)] font-medium">
        <div className="flex items-center gap-1.5" title="Criado em">
          <div className="w-1 h-1 rounded-full bg-[var(--text-tertiary)]" />
          {new Date(ticket.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' })}
        </div>
        <div className="flex items-center gap-2">
           {assignee ? (
             <div className="flex items-center gap-2">
               <span className="text-[9px] text-[var(--text-tertiary)] font-semibold truncate max-w-[60px] hidden sm:inline">{assignee.name.split(' ')[0]}</span>
               <UserAvatar
                 name={assignee.name}
                 thumbUrl={(assignee as any).avatarThumbUrl}
                 size={24}
                 rounded="rounded-lg"
                 fallbackClassName="bg-[var(--accent)] text-white shadow-sm"
                 className="shadow-sm"
               />
             </div>
           ) : (
             <div className={cn(
               "w-6 h-6 rounded-lg flex items-center justify-center border",
               isUnassignedNew ? "bg-[var(--surface-warning)] border-[var(--border-alert)]" : "bg-[var(--surface-pill)] border-[var(--border-default)]"
             )} title="Sem Analista">
               <User size={10} className={isUnassignedNew ? "text-[var(--text-warning-strong)]" : "text-[var(--text-tertiary)]"} />
             </div>
           )}
        </div>
      </div>
    </motion.div>
  );
}

