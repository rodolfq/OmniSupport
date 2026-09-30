'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/app/app-context';
import { Ticket, Permission, UserRole, InternalTicket } from '@/lib/types';
import { fetchAllTickets } from '@/lib/tickets';
import {
  Search,
  Filter,
  Clock,
  MessageSquare,
  ChevronRight,
  Ticket as TicketIcon,
  Plus,
  LayoutGrid,
  List as ListIcon,
  Tag,
  FolderKanban,
  Kanban,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, normalizeString } from '@/lib/utils';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { CustomerDashboardPanel } from '@/components/customer-dashboard-panel';
import { isClosedTicketStatus, getCustomerStatusLabel } from '@/lib/ticket-status';
import { useSearchParams, useRouter } from 'next/navigation';
import { ConfigService } from '@/lib/services/config-service';
import { findStatusColor } from '@/lib/status-colors';

interface InternalTicketItem extends InternalTicket {
  uuid: string;
  displayId: string;
}

const INTERNAL_STATUS_META: Record<string, { label: string; color: string }> = {
  'Novo': { label: 'Novo', color: 'bg-[var(--surface-info)] text-[var(--text-info)]' },
  'Em Andamento': { label: 'Em andamento', color: 'bg-[var(--surface-warning)] text-[var(--text-warning)]' },
  'Em Espera': { label: 'Em espera', color: 'bg-[var(--surface-pill)] text-[var(--text-secondary)]' },
  'Concluído': { label: 'Concluído', color: 'bg-[var(--surface-success)] text-[var(--text-success)]' },
};

// Cliente/Funcionário só enxergam 3 estados — o restante do fluxo interno
// (sub-status, "Aguardando Cliente" etc.) vira só "Em Andamento" pra eles.
type CustomerStatusFilter = 'all' | 'Novo' | 'Em Andamento' | 'Finalizado';

const CUSTOMER_STATUS_FILTERS: Array<{ value: CustomerStatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'Novo', label: 'Novo' },
  { value: 'Em Andamento', label: 'Em andamento' },
  { value: 'Finalizado', label: 'Finalizado' },
];

// Board Kanban de "Meus Chamados" — mesmo visual do Kanban de "Todos os
// Chamados" (app/(portal)/tickets/tickets-view.tsx: coluna com barra de cor
// no topo + ponto no cabeçalho, card com estrelas de prioridade e tags) e
// sem arrastar-e-soltar — aqui não faz sentido o cliente mudar status do
// próprio chamado arrastando o card, e o card de dnd-kit da outra tela é
// reaproveitado só no visual.
//
// As COLUNAS variam por quem está olhando (decisão do usuário, 2026-09-29):
// Cliente/Funcionário continuam travados nos 3 estados que já enxergam em
// todo o resto desta tela (getCustomerStatusLabel esconde sub-status/
// "Aguardando Cliente" etc — não deve virar 4+ colunas granulares pra quem
// nunca teve acesso a esse detalhe). Equipe/Administrador/Time Interno
// (isInternalRole) veem as MESMAS colunas de "Todos os Chamados" — o
// cadastro real de Configurações > Status, carregado abaixo.
interface KanbanStatusMeta { value: string; label: string; dot: string; accent: string; isClosed: boolean }

const MY_TICKETS_KANBAN_COLUMNS: Array<{ status: 'Novo' | 'Em Andamento' | 'Finalizado'; title: string; dot: string; accent: string }> = [
  { status: 'Novo', title: 'Novos', dot: 'bg-[var(--text-info)]', accent: '#2563EB' },
  { status: 'Em Andamento', title: 'Em Andamento', dot: 'bg-[var(--text-warning-strong)]', accent: '#D97706' },
  { status: 'Finalizado', title: 'Finalizados', dot: 'bg-[var(--text-success)]', accent: '#16A34A' },
];

// Mesmo default de tickets-view.tsx, pro board não ficar em branco enquanto
// o cadastro real ainda carrega (ou se a chamada falhar).
const DEFAULT_INTERNAL_KANBAN_STATUSES: KanbanStatusMeta[] = [
  { value: 'Novo', label: 'Novo', dot: 'bg-[var(--text-info)]', accent: '#2563EB', isClosed: false },
  { value: 'Em Atendimento', label: 'Em Atendimento', dot: 'bg-[var(--text-warning-strong)]', accent: '#D97706', isClosed: false },
  { value: 'Aguardando Cliente', label: 'Aguardando Cliente', dot: 'bg-[var(--text-secondary)]', accent: '#64748B', isClosed: false },
  { value: 'Concluído', label: 'Concluído', dot: 'bg-[var(--text-success)]', accent: '#16A34A', isClosed: true },
];

// Mesmo número do ícone "Meus Chamados" na sidebar (ver NavBadges em
// app/app-context.tsx), só que aplicado ao card do chamado específico que
// gerou a pendência — some assim que o chamado é aberto (o modal marca como
// lido, ver ticket-detail-modal.tsx).
function TicketNotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-2 -right-2 min-w-[20px] h-[20px] px-1.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold flex items-center justify-center shadow-md z-10">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function matchesCustomerStatusFilter(status: string, filter: CustomerStatusFilter) {
  // "Todos" não inclui os finalizados por padrão — chamado encerrado só
  // aparece quando o cliente escolhe o filtro "Finalizado" de propósito.
  if (filter === 'all') return !isClosedTicketStatus(status);
  return getCustomerStatusLabel(status) === filter;
}

// A caixa "Pesquisar por assunto ou ID..." só olhava o título e o id interno
// (o hash longo) — o número que aparece no card ("#0431") nunca casava, então
// digitar 431 não achava o chamado. Aceita "431", "0431" e "#0431".
function ticketMatchesSearch(t: Ticket, normalQuery: string): boolean {
  if (!normalQuery) return true;
  if (normalizeString(t.title).includes(normalQuery) || normalizeString(t.id).includes(normalQuery)) return true;
  const number = t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : '';
  const digits = normalQuery.replace(/^#/, '');
  return !!number && /^\d+$/.test(digits) && number.includes(digits);
}

export default function MyTicketsPage() {
  const { currentUser, hasPermission, setIsNewTicketModalOpen, refreshTrigger, navBadges } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]); // Renamed from tickets = useState<Ticket[]>([])
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CustomerStatusFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [view, setView] = useState<'grid' | 'list' | 'kanban'>('grid');
  const [visibleCount, setVisibleCount] = useState(12);

  // Chave Chamados / Tickets Internos — só existe pra quem enxerga tickets
  // internos (Administrador/Equipe/Time Interno); dá pro time interno usar
  // esta mesma tela pra acompanhar os próprios tickets internos, sem
  // precisar abrir /internal-tickets pra isso. Quem não tem "Visualizar
  // chamados" (tickets:read) nunca deve ver o lado Chamados aqui, nem a
  // própria chave de troca — mesma regra do Dashboard. Cliente/Funcionário
  // não passam pelo sistema de Perfil de Acesso (não tem tickets:read
  // atribuído) — pra eles "Meus Chamados" continua sempre liberado.
  const isInternalRole = !!currentUser && ![UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser.role as UserRole);
  const canSeeTickets = !isInternalRole || hasPermission(Permission.TICKETS_READ);
  const canSeeInternal = isInternalRole && hasPermission(Permission.INTERNAL_TICKETS_VIEW);
  const [ticketMode, setTicketMode] = useState<'tickets' | 'internal'>(() => (
    !canSeeTickets && canSeeInternal ? 'internal' : 'tickets'
  ));
  const [internalTickets, setInternalTickets] = useState<InternalTicketItem[]>([]);
  const [loadingInternal, setLoadingInternal] = useState(false);

  // Colunas do Kanban pra quem é da equipe interna — mesmo cadastro
  // (Configurações > Geral > Status) usado no board de "Todos os Chamados".
  // Cliente/Funcionário nunca chamam isto (ver isInternalRole abaixo);
  // ninguém troca isso via drag-and-drop aqui, então status arquivado ou de
  // sub-status (parentStatusId) não faz diferença prática pro board — só os
  // de topo, igual à outra tela.
  const [internalKanbanStatuses, setInternalKanbanStatuses] = useState<KanbanStatusMeta[]>(DEFAULT_INTERNAL_KANBAN_STATUSES);
  // "Mostrar chamados encerrados" — mesmo padrão de "Todos os Chamados"
  // (tickets-view.tsx, 2026-09-29): por padrão só mostra as colunas ABERTAS;
  // marcado, mostra só as FECHADAS (hoje só "Concluído", já que "Mesclado"
  // nunca vira coluna — ver filtro abaixo).
  const [showClosedKanban, setShowClosedKanban] = useState(false);
  useEffect(() => {
    if (!isInternalRole) return;
    let cancelled = false;
    ConfigService.getStatuses('ticket').then(data => {
      if (cancelled) return;
      // "Mesclado" nunca vira coluna aqui (pedido do usuário, 2026-09-30) —
      // mesclar é operação de bastidor (SQL direto, fora do PATCH normal),
      // não um passo do fluxo que alguém arrastaria um card pra dentro/fora.
      const topLevel = data.filter(s => !s.parentStatusId && s.label !== 'Mesclado');
      if (topLevel.length > 0) {
        setInternalKanbanStatuses(topLevel.map(s => {
          const c = findStatusColor(s.color);
          return { value: s.label, label: s.label, dot: c.dot, accent: c.accent, isClosed: !!s.isClosed };
        }));
      }
    }).catch(error => console.error('Error loading ticket statuses for kanban:', error));
    return () => { cancelled = true; };
  }, [isInternalRole]);

  // Colunas efetivamente exibidas: abertas por padrão, só fechadas quando o
  // checkbox está marcado — nunca as duas categorias juntas (mesmo padrão de
  // "Todos os Chamados").
  const displayedInternalKanbanStatuses = useMemo(
    () => internalKanbanStatuses.filter(s => (showClosedKanban ? s.isClosed : !s.isClosed)),
    [internalKanbanStatuses, showClosedKanban]
  );

  useEffect(() => {
    if (!canSeeTickets && canSeeInternal) setTicketMode('internal');
    else if (canSeeTickets && !canSeeInternal) setTicketMode('tickets');
  }, [canSeeTickets, canSeeInternal]);

  // Extraído do efeito de carga pra poder ser chamado de novo no onClose do
  // TicketDetailModal — mudar o responsável (ou qualquer outro campo que
  // afete o filtro abaixo) precisa sumir da lista na hora, sem esperar F5,
  // já que "Meus Chamados" é literalmente definido por esse filtro.
  const loadTickets = React.useCallback(async (): Promise<Ticket[]> => {
    if (!currentUser) return [];
    // Time interno sem "Visualizar chamados": nem busca — evita chamado
    // nenhum chegando na memória do cliente pra quem só tem Tickets
    // Internos.
    if (!canSeeTickets) { setAllTickets([]); return []; }
    const all = await fetchAllTickets(undefined, { includeClosed: true });

    // OUTSIDE_QUEUE_VIEW ("Central de Atendimento") saiu daqui de propósito:
    // é permissão de atender a FILA DE CHAT do WhatsApp (/chat-management),
    // não de visão de CHAMADO — misturar os dois fazia quem só tinha
    // permissão de chat enxergar todo chamado da empresa em "Meus Chamados",
    // mesmo sem ser responsável por nenhum. Só Administrador vê tudo aqui.
    const canViewEverything = currentUser.role === UserRole.ADMIN;

    const filtered = all.filter(t => {
      if (canViewEverything) return true;
      if (currentUser.role === UserRole.CUSTOMER) {
        if (currentUser.viewAllCompanyTickets) {
          return t.companyId === currentUser.companyId;
        }
        return t.customerId === currentUser.id;
      }
      if (currentUser.role === UserRole.EMPLOYEE) {
        return t.customerId === currentUser.id || t.employeeIds?.includes(currentUser.id);
      }
      // Equipe/Time Interno usando "Meus Chamados": só o que é
      // responsabilidade dele. Chamado sem responsável NÃO entra aqui (antes
      // entrava "pra poder assumir", mas isso enchia a tela de chamado que
      // não é de ninguém) — ele é assumido pela lista de todos os chamados.
      // customerId/employeeIds não fazem sentido pra esses papéis (são
      // conceito do lado empresa-cliente).
      return t.assigneeId === currentUser.id;
    });
    setAllTickets(filtered);
    return filtered;
  }, [currentUser, canSeeTickets]);

  useEffect(() => {
    async function loadData() {
        const filtered = await loadTickets();

        const ticketId = searchParams?.get('ticket');
        if (ticketId) {
          const ticket = filtered.find(t => t.id === ticketId);
          if (ticket) {
            setSelectedTicket(ticket);
          }
        }
    }
    loadData();
  }, [loadTickets, refreshTrigger, searchParams]);

  useEffect(() => {
    async function loadInternal() {
      if (!currentUser || !canSeeInternal || ticketMode !== 'internal') return;
      setLoadingInternal(true);
      try {
        // scope=mine: o servidor resolve "meus" pela sessão (responsável ou
        // criador), em vez de o id do usuário viajar na querystring.
        const res = await fetch('/api/internal-tickets?action=list&scope=mine');
        if (!res.ok) throw new Error('Falha ao carregar tickets internos.');
        const data = await res.json();
        setInternalTickets((data || []).map((it: any) => ({
          ...it,
          uuid: it.id,
          displayId: `INT-${it.internal_ticket_number?.toString().padStart(4, '0') || it.id.slice(0, 8)}`,
          teamId: it.team_id,
          assigneeId: it.assignee_id,
          creatorId: it.creator_id,
          priority: it.priority,
          tags: it.tags || [],
          status: it.status || 'Novo',
          slaLimit: it.sla_limit,
          updatedAt: it.updated_at,
        })));
      } catch (error) {
        console.error('Error loading internal tickets:', error);
      } finally {
        setLoadingInternal(false);
      }
    }
    loadInternal();
  }, [currentUser, canSeeInternal, ticketMode, refreshTrigger]);

  const filteredTickets = useMemo(() => {
    const normalQuery = normalizeString(search);
    return allTickets.filter(t => {
      const matchesSearch = ticketMatchesSearch(t, normalQuery);
      const matchesStatus = matchesCustomerStatusFilter(t.status, filter);
      return matchesSearch && matchesStatus;
    });
  }, [allTickets, search, filter]);

  const visibleTickets = useMemo(() => {
    return filteredTickets.slice(0, visibleCount);
  }, [filteredTickets, visibleCount]);

  // Só a busca por texto — sem o filtro de status de CUSTOMER_STATUS_FILTERS,
  // que no modo "Todos" exclui Finalizado (ver matchesCustomerStatusFilter).
  // O board precisa das 3 colunas sempre, Finalizados incluso.
  const kanbanTickets = useMemo(() => {
    const normalQuery = normalizeString(search);
    return allTickets.filter(t => ticketMatchesSearch(t, normalQuery));
  }, [allTickets, search]);

  const kanbanGrouped = useMemo(() => {
    if (isInternalRole) {
      const groups: Record<string, Ticket[]> = {};
      internalKanbanStatuses.forEach(s => { groups[s.value] = []; });
      kanbanTickets.forEach(t => {
        if (groups[t.status]) groups[t.status].push(t);
      });
      return groups;
    }
    const groups: Record<string, Ticket[]> = { 'Novo': [], 'Em Andamento': [], 'Finalizado': [] };
    kanbanTickets.forEach(t => {
      const label = getCustomerStatusLabel(t.status);
      if (groups[label]) groups[label].push(t);
    });
    return groups;
  }, [kanbanTickets, isInternalRole, internalKanbanStatuses]);

  const filteredInternalTickets = useMemo(() => {
    const normalQuery = normalizeString(search);
    if (!normalQuery) return internalTickets;
    return internalTickets.filter(t =>
      normalizeString(t.title).includes(normalQuery) || normalizeString(t.displayId).includes(normalQuery)
    );
  }, [internalTickets, search]);

  const visibleInternalTickets = useMemo(() => {
    return filteredInternalTickets.slice(0, visibleCount);
  }, [filteredInternalTickets, visibleCount]);

  // Mesma simplificação de 3 estados de getCustomerStatusLabel — a cor
  // sempre acompanha o selo que o cliente realmente vê.
  const getStatusColor = (status: string) => {
    if (isClosedTicketStatus(status)) return 'bg-[var(--surface-success)] text-[var(--text-success)]';
    if (status === 'Novo') return 'bg-[var(--surface-info)] text-[var(--text-info)]';
    return 'bg-[var(--surface-warning)] text-[var(--text-warning)]';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            {ticketMode === 'tickets' ? 'Meus Chamados' : 'Meus Tickets Internos'}
          </h2>
          <p className="text-[var(--text-tertiary)] font-medium mt-1">
            {ticketMode === 'tickets' ? 'Acompanhe suas solicitações e interaja com o suporte.' : 'Tickets internos onde você é responsável ou criador.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {canSeeTickets && canSeeInternal && (
            <div className="flex items-center gap-1 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)]">
              <button
                onClick={() => { setTicketMode('tickets'); setVisibleCount(12); }}
                className={cn(
                  "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
                  ticketMode === 'tickets' ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                <TicketIcon size={14} /> Chamados
              </button>
              <button
                onClick={() => { setTicketMode('internal'); setVisibleCount(12); setView(v => v === 'kanban' ? 'grid' : v); }}
                className={cn(
                  "px-3 py-2 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all flex items-center gap-1.5",
                  ticketMode === 'internal' ? "bg-[var(--surface-card)] text-[var(--text-warning)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                <FolderKanban size={14} /> Tickets Internos
              </button>
            </div>
          )}

          {ticketMode === 'tickets' ? (
            <button
              onClick={() => setIsNewTicketModalOpen(true)}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2 active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            >
              <Plus size={18} />
              Novo Chamado
            </button>
          ) : (
            <button
              onClick={() => router.push('/tickets?mode=internal')}
              className="bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <Plus size={18} />
              Novo Ticket Interno
            </button>
          )}
        </div>
      </div>

      {/* Dashboard: só pro lado empresa-cliente (Cliente/Funcionário), nunca
          pra Equipe/Administrador/Time Interno usando "Meus Chamados" como
          fila pessoal — conceito de "empresa toda vs meus chamados" não se
          aplica a eles aqui. */}
      {!isInternalRole && ticketMode === 'tickets' && <CustomerDashboardPanel />}

      {/* Filters Bar */}
      <div className="bg-[var(--surface-card)] p-4 rounded-2xl border border-[var(--border-default)] shadow-sm flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
          <input
            type="text"
            placeholder="Pesquisar por assunto ou ID..."
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setVisibleCount(12);
            }}
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl py-2.5 pl-12 pr-4 text-sm font-medium focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] outline-none transition-all"
          />
        </div>

        {/* No Kanban os 3 estados já aparecem lado a lado como coluna — o
            filtro de status vira redundante (e "Todos" some Finalizado). */}
        {ticketMode === 'tickets' && view !== 'kanban' && (
          <div className="flex items-center gap-2 p-1 bg-[var(--surface-pill)] rounded-xl border border-[var(--border-default)] overflow-x-auto max-w-full scrollbar-hidden">
            {CUSTOMER_STATUS_FILTERS.map(s => (
              <button
                key={s.value}
                onClick={() => {
                  setFilter(s.value);
                  setVisibleCount(12);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all whitespace-nowrap",
                  filter === s.value ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 border-l border-[var(--border-default)] pl-4 ml-2">
           <button onClick={() => setView('grid')} className={cn("p-2 rounded-lg transition-all", view === 'grid' ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]")}>
             <LayoutGrid size={16} />
           </button>
           <button onClick={() => setView('list')} className={cn("p-2 rounded-lg transition-all", view === 'list' ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]")}>
             <ListIcon size={16} />
           </button>
           {/* Kanban só faz sentido pro lado Chamados — Tickets Internos tem
               um modelo de status próprio (4 estados, INTERNAL_STATUS_META),
               diferente dos 3 que o cliente/funcionário enxerga aqui. */}
           {ticketMode === 'tickets' && (
             <button onClick={() => setView('kanban')} title="Kanban" className={cn("p-2 rounded-lg transition-all", view === 'kanban' ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]")}>
               <Kanban size={16} />
             </button>
           )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-8">
        {ticketMode === 'internal' ? (
          loadingInternal ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-[var(--text-warning-strong)]/30 border-t-[var(--text-warning-strong)] rounded-full animate-spin" />
            </div>
          ) : visibleInternalTickets.length > 0 ? (
            <>
              <div className={cn("grid gap-6", view === 'grid' ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>
                {visibleInternalTickets.map(it => {
                  const meta = INTERNAL_STATUS_META[it.status || 'Novo'] || INTERNAL_STATUS_META['Novo'];
                  const isCreatorOnly = it.creatorId === currentUser?.id && it.assigneeId !== currentUser?.id;
                  return (
                    <motion.div
                      key={it.uuid}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ y: -2 }}
                      onClick={() => router.push(`/internal-tickets/${it.uuid}`)}
                      className={cn(
                        "bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-[var(--text-warning-strong)]/40 group flex flex-col",
                        view === 'list' && "flex-row items-center gap-6 py-4"
                      )}
                    >
                      <div className={cn("flex-1 min-w-0", view === 'list' && "flex items-center gap-6 flex-1")}>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-warning)]">{it.displayId}</span>
                          <span className={cn("px-3 py-1 rounded-full text-[9px] font-semibold uppercase tracking-widest", meta.color)}>
                            {meta.label}
                          </span>
                        </div>

                        <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight mb-1.5 group-hover:text-[var(--text-warning)] transition-colors leading-tight truncate">
                          {it.title}
                        </h3>

                        <p className="text-sm text-[var(--text-tertiary)] font-medium line-clamp-2 mb-4">
                          {(it.description || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() || 'Sem descrição'}
                        </p>

                        <div className="flex flex-wrap gap-2 mb-4">
                          <span className="bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-widest">
                            {it.teamId || 'Sem equipe'}
                          </span>
                          {isCreatorOnly && (
                            <span className="bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-widest">
                              Aberto por você
                            </span>
                          )}
                          {(it.tags || []).map(tag => (
                            <span key={tag} className="bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1.5">
                              <Tag size={10} />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className={cn("flex items-center justify-between pt-4 border-t border-[var(--border-default)]", view === 'list' && "border-t-0 pt-0")}>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3].map(star => (
                            <div key={star} className={cn("w-1.5 h-4 rounded-full", star <= (it.priority || 1) ? "bg-[var(--text-warning-strong)]" : "bg-[var(--border-default)]")} />
                          ))}
                        </div>
                        <ChevronRight className="text-[var(--text-tertiary)] group-hover:text-[var(--text-warning)] transition-all transform group-hover:translate-x-1" size={18} />
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {filteredInternalTickets.length > visibleCount && (
                <div className="text-center py-6 flex items-center justify-center gap-4">
                  <button
                    onClick={() => setVisibleCount(prev => prev + 12)}
                    className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-6 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--text-warning-strong)]/40 hover:text-[var(--text-warning)] transition-all shadow-sm group active:scale-95"
                  >
                    Carregar mais tickets <span className="text-[var(--text-warning)] ml-1">({filteredInternalTickets.length - visibleCount})</span>
                  </button>
                  {/* Mesmo motivo do botão em "Meus Chamados" acima (achado
                      2026-09-29) — dados já carregados, só o render era limitado. */}
                  <button
                    onClick={() => setVisibleCount(filteredInternalTickets.length)}
                    className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-warning)] underline underline-offset-2 transition-all"
                  >
                    Carregar todos
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-[var(--surface-card)] border-2 border-dashed border-[var(--border-default)] rounded-2xl p-12 text-center animate-in fade-in duration-700">
              <div className="w-16 h-16 bg-[var(--surface-pill)] rounded-xl flex items-center justify-center mx-auto mb-6 text-[var(--text-tertiary)]">
                 <FolderKanban size={32} />
              </div>
              <h3 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-2">Nenhum ticket interno seu</h3>
              <p className="text-[var(--text-tertiary)] font-medium mb-6">Você ainda não é responsável nem criou nenhum ticket interno.</p>
              <button
                onClick={() => router.push('/tickets?mode=internal')}
                className="inline-flex items-center gap-2 bg-[var(--text-warning-strong)] hover:bg-[var(--accent-warning-hover)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all"
              >
                <Plus size={18} />
                Criar Ticket Interno
              </button>
            </div>
          )
        ) : view === 'kanban' ? (
          // Mesmo visual do Kanban de "Todos os Chamados" (colunas com barra
          // de cor no topo + card com estrelas/tags). Cliente/Funcionário
          // usam as 3 colunas simplificadas de sempre (MY_TICKETS_KANBAN_COLUMNS);
          // Equipe/Administrador/Time Interno usam o cadastro real de Status
          // (displayedInternalKanbanStatuses) — mesmas colunas de "Todos os
          // Chamados", incluindo o checkbox "Mostrar chamados encerrados"
          // (2026-09-30): por padrão só as colunas abertas aparecem; marcado,
          // só a(s) fechada(s) (hoje só "Concluído" — "Mesclado" nunca vira
          // coluna, em nenhum dos dois estados).
          <>
            {isInternalRole && (
              <label className="flex items-center gap-2 mb-4 cursor-pointer w-fit select-none">
                <input
                  type="checkbox"
                  checked={showClosedKanban}
                  onChange={(e) => setShowClosedKanban(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--border-default)] accent-[var(--accent)] cursor-pointer"
                />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                  Mostrar chamados encerrados
                </span>
              </label>
            )}
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-4 md:overflow-x-auto md:scrollbar-thin md:pb-4">
            {(isInternalRole
              ? displayedInternalKanbanStatuses.map(s => ({ key: s.value, title: s.label, dot: s.dot, accent: s.accent }))
              : MY_TICKETS_KANBAN_COLUMNS.map(c => ({ key: c.status, title: c.title, dot: c.dot, accent: c.accent }))
            ).map(col => {
              const colTickets = kanbanGrouped[col.key] || [];
              return (
                <div
                  key={col.key}
                  className="rounded-2xl border-t-4 bg-[var(--surface-card)] overflow-hidden md:w-[280px] md:shrink-0"
                  style={{ borderTopColor: col.accent }}
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
                    <span className={cn("w-2 h-2 rounded-full", col.dot)} />
                    <h3 className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">{col.title}</h3>
                    <span className="text-[10px] font-bold text-[var(--text-tertiary)] ml-auto bg-[var(--surface-pill)] px-2 py-0.5 rounded-full">
                      {colTickets.length}
                    </span>
                  </div>
                  <div className="p-3 space-y-2.5 min-h-[120px] md:h-[clamp(280px,calc(100vh_-_460px),640px)] md:overflow-y-auto">
                    {colTickets.length === 0 ? (
                      <div className="text-center py-8 rounded-xl border-2 border-dashed border-[var(--border-default)]">
                        <p className="text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">Nenhum chamado por aqui</p>
                      </div>
                    ) : (
                      colTickets.map(ticket => (
                        <MyTicketKanbanCard
                          key={ticket.id}
                          ticket={ticket}
                          notificationCount={navBadges.myTicketsUnreadByTicket[ticket.id] || 0}
                          onClick={() => setSelectedTicket(ticket)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </>
        ) : visibleTickets.length > 0 ? (
          <>
            <div className={cn(
              "grid gap-6",
              view === 'grid' ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
            )}>
              {visibleTickets.map(ticket => (
                <motion.div
                  key={ticket.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  onClick={() => setSelectedTicket(ticket)}
                  className={cn(
                    "relative bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-[var(--accent)]/40 group flex flex-col",
                    view === 'list' && "flex-row items-center gap-6 py-4"
                  )}
                >
                  <TicketNotificationBadge count={navBadges.myTicketsUnreadByTicket[ticket.id] || 0} />
                  <div className={cn(
                    "flex-1 min-w-0",
                    view === 'list' && "flex items-center gap-6 flex-1"
                  )}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
                      <span className={cn("px-3 py-1 rounded-full text-[9px] font-semibold uppercase tracking-widest", getStatusColor(ticket.status))}>
                        {getCustomerStatusLabel(ticket.status)}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight mb-1.5 group-hover:text-[var(--accent-text)] transition-colors leading-tight truncate">
                      {ticket.title}
                    </h3>

                    <p className="text-sm text-[var(--text-tertiary)] font-medium line-clamp-2 mb-4">
                      {(() => {
                        const html = ticket.description || '';
                        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
                      })()}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {ticket.tags?.map(tag => (
                        <span key={tag} className="bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-2 py-1 rounded-md text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1.5">
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={cn(
                    "flex items-center justify-between pt-4 border-t border-[var(--border-default)]",
                    view === 'list' && "border-t-0 pt-0"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
                        <Clock size={13} />
                        <span className="text-[10px] font-semibold uppercase">
                          {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
                        <MessageSquare size={13} />
                        <span className="text-[10px] font-semibold uppercase">
                          -
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="text-[var(--text-tertiary)] group-hover:text-[var(--accent-text)] transition-all transform group-hover:translate-x-1" size={18} />
                  </div>
                </motion.div>
              ))}
            </div>

            {filteredTickets.length > visibleCount && (
              <div className="text-center py-6 flex items-center justify-center gap-4">
                <button
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-6 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)] transition-all shadow-sm group active:scale-95"
                >
                  Carregar mais chamados <span className="text-[var(--accent-text)] ml-1">({filteredTickets.length - visibleCount})</span>
                </button>
                {/* Achado 2026-09-29 (chamado #1858, Ana Julia): quem tem muitos
                    chamados atribuídos (aqui, 578) precisava clicar "Carregar
                    mais" dezenas de vezes pra um chamado antigo aparecer — a
                    busca por número já resolvia na hora (sem precisar disto),
                    mas só pra quem já sabe o número. Um clique único carrega o
                    resto: os dados já estão todos no navegador (só o
                    RENDER era limitado), não pede nada novo ao servidor. */}
                <button
                  onClick={() => setVisibleCount(filteredTickets.length)}
                  className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] underline underline-offset-2 transition-all"
                >
                  Carregar todos
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="bg-[var(--surface-card)] border-2 border-dashed border-[var(--border-default)] rounded-2xl p-12 text-center animate-in fade-in duration-700">
            <div className="w-16 h-16 bg-[var(--surface-pill)] rounded-xl flex items-center justify-center mx-auto mb-6 text-[var(--text-tertiary)]">
               <TicketIcon size={32} />
            </div>
            <h3 className="text-lg font-bold text-[var(--text-primary)] tracking-tight mb-2">Sem chamados por aqui</h3>
            <p className="text-[var(--text-tertiary)] font-medium mb-6">Nenhum chamado corresponde aos filtros selecionados ou você ainda não abriu solicitações.</p>
            <button
              onClick={() => setIsNewTicketModalOpen(true)}
              className="inline-flex items-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            >
              <Plus size={18} />
              Abrir Chamado
            </button>
          </div>
        )}
      </div>

      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={async () => {
            setSelectedTicket(null);
            await loadTickets();
          }}
        />
      )}
    </div>
  );
}

// Card do modo Kanban — mesmo desenho do TicketKanbanCard de "Todos os
// Chamados" (número + estrelas de prioridade, título em itálico, tags,
// rodapé com a data), só sem o cursor de arrastar (aqui o card não é
// draggable — ver comentário de MY_TICKETS_KANBAN_COLUMNS).
const KANBAN_PRIORITY_LABELS = ['Baixa', 'Média', 'Alta', 'Urgente'];

function MyTicketKanbanCard({ ticket, notificationCount = 0, onClick }: { ticket: Ticket; notificationCount?: number; onClick: () => void }) {
  const currentPriority = KANBAN_PRIORITY_LABELS.indexOf(ticket.priority as string) + 1;

  return (
    <div
      onClick={onClick}
      className="relative bg-[var(--surface-card)] rounded-xl p-3.5 border border-[var(--border-default)] cursor-pointer transition-all hover:shadow-md hover:border-[var(--accent)]/40 group"
    >
      <TicketNotificationBadge count={notificationCount} />
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] font-mono font-semibold text-[var(--accent-text)]">
          #{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}
        </span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4].map(star => (
            <Star
              key={star}
              size={10}
              className={cn(star <= currentPriority ? "fill-amber-400 text-[var(--text-warning)]" : "text-slate-200")}
            />
          ))}
        </div>
      </div>

      <h4 className="font-bold text-[var(--text-primary)] text-sm mb-2 line-clamp-2 leading-snug italic" title={ticket.title}>
        {ticket.title}
      </h4>

      {ticket.tags && ticket.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {ticket.tags.slice(0, 3).map(tag => (
            <span key={tag} className="bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
        <Clock size={11} />
        <span className="text-[10px] font-semibold uppercase">
          {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
        </span>
      </div>
    </div>
  );
}
