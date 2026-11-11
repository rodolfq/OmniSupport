"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { StyledSelect } from '@/components/styled-select';
import { NotificationCountBadge, UnreadDot } from '@/components/notification-count-badge';
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "@/app/app-context";
import { InternalTicket, Permission, User } from "@/lib/types";
import { InternalTicketService } from "@/lib/services/ticket-service";
import { NewInternalTicketModal } from "@/components/new-internal-ticket-modal";
import { ConfigService } from "@/lib/services/config-service";
import { useInternalTeamsQuery, useProfilesLiteQuery } from "@/lib/query-hooks";
import { findStatusColor } from "@/lib/status-colors";
import { InlineAssigneePicker } from "@/components/inline-assignee-picker";
import { MultiSelectFilter } from "@/components/multi-select-filter";
import { toast } from "sonner";
import {
  Plus, Search, Filter, Clock, Edit3, Loader2,
  MessageCircle, Link2, User as UserIcon, Inbox, AlertTriangle, Flame,
  CheckSquare, Square, X, Users
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useOpenInternalTicket } from "@/components/internal-ticket-modal-host";
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent
} from "@dnd-kit/core";

interface InternalTicketItem extends InternalTicket {
  linkedTicketTitles?: string[];
  assigneeName?: string;
  assigneeAvatarThumbUrl?: string | null;
  slaRemaining?: string | null;
  commentCount?: number;
}

const ITEMS_PER_PAGE = 20;
// A tela carrega TODOS os tickets do recorte de uma vez (2026-11-11, pedido
// do usuário: sem "Carregar mais"). Teto de segurança igual ao da action=board
// no servidor — passou disso, aparece um aviso pedindo pra refinar o filtro.
const MAX_ITEMS = 5000;

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

interface KanbanStatusMeta {
  value: string;
  label: string;
  color: string;
  dot: string;
  accent: string;
  isClosed?: boolean;
}

const DEFAULT_KANBAN_STATUSES: KanbanStatusMeta[] = [
  { value: "Novo", label: "Novo", color: "bg-[var(--surface-info)] text-[var(--text-info)]", dot: "bg-[var(--text-info)]", accent: "#2563EB" },
  { value: "Em Andamento", label: "Em Andamento", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]", dot: "bg-[var(--text-warning-strong)]", accent: "#D97706" },
  { value: "Em Espera", label: "Em Espera", color: "bg-[var(--surface-pill)] text-[var(--text-secondary)]", dot: "bg-[var(--text-secondary)]", accent: "#64748B" },
  { value: "Concluído", label: "Concluído", color: "bg-[var(--surface-success)] text-[var(--text-success)]", dot: "bg-[var(--text-success)]", accent: "#16A34A", isClosed: true },
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

function Avatar({ name, avatarThumbUrl, size = 24 }: { name?: string | null; avatarThumbUrl?: string | null; size?: number }) {
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
  if (avatarThumbUrl) {
    return (
      <img
        src={avatarThumbUrl}
        alt={name}
        title={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
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

/**
 * Filtros da tela, guardados no navegador.
 *
 * Quem trabalha em ticket interno volta pra mesma fatia todo dia (a própria
 * equipe, quase sempre). Refazer a seleção a cada visita é atrito puro — e é o
 * que substituiu o antigo recorte automático por equipe: em vez de o sistema
 * decidir o que esconder, o usuário escolhe uma vez e a escolha persiste.
 *
 * Por usuário do navegador, não por conta: é preferência de tela, não dado de
 * negócio, e mandar isso pro banco custaria uma ida a mais em cada visita.
 *
 * O sufixo -v1 na chave é proposital: mudando o formato do que é salvo, basta
 * subir pra -v2 e as preferências antigas são ignoradas em vez de quebrarem a
 * tela com um formato que o código novo não entende.
 */
const FILTROS_STORAGE_KEY = 'internal-tickets-filtros-v1';

interface FiltrosSalvos {
  searchTerm: string;
  filterTeams: string[];
  filterAssignee: string;
  filterStatus: string;
  filterPriority: string;
  dateFrom: string;
  dateTo: string;
  showClosed: boolean;
  // Preferência separada pro Kanban (2026-11-11, pedido do usuário): nasce
  // DESLIGADA (sem a coluna "Concluído") e NÃO é restaurada — toda entrada ou
  // recarga volta a esconder os encerrados. Tabela/Cards guardam a própria.
  showClosedKanban: boolean;
  quickFilter: "all" | "mine" | "unassigned" | "overdue" | "high";
  viewScope: ViewScope;
}

// Recorte principal da lista (2026-11-11, pedido do usuário): "Minha equipe"
// é o padrão; "Todos" e "Atribuído a mim" são as alternativas. Aplicado no
// SERVIDOR (parâmetro `scope` da action=board), porque a lista é paginada —
// diferente dos chips rápidos ao lado, que recortam só a página carregada.
type ViewScope = "team" | "all" | "assigned";

const FILTROS_PADRAO: FiltrosSalvos = {
  searchTerm: "",
  filterTeams: [],
  filterAssignee: "",
  filterStatus: "",
  filterPriority: "",
  dateFrom: "",
  dateTo: "",
  showClosed: false,
  showClosedKanban: false,
  quickFilter: "all",
  viewScope: "team",
};

function carregarFiltros(): FiltrosSalvos {
  if (typeof window === 'undefined') return FILTROS_PADRAO;
  try {
    const raw = localStorage.getItem(FILTROS_STORAGE_KEY);
    if (!raw) return FILTROS_PADRAO;
    const p = JSON.parse(raw);
    // Campo a campo, checando tipo: o que está no localStorage veio de uma
    // versão anterior do código ou de edição manual, e um array onde se espera
    // string quebra a montagem da query silenciosamente.
    return {
      searchTerm: typeof p.searchTerm === 'string' ? p.searchTerm : "",
      filterTeams: Array.isArray(p.filterTeams) ? p.filterTeams.filter((t: any) => typeof t === 'string') : [],
      filterAssignee: typeof p.filterAssignee === 'string' ? p.filterAssignee : "",
      filterStatus: typeof p.filterStatus === 'string' ? p.filterStatus : "",
      filterPriority: typeof p.filterPriority === 'string' ? p.filterPriority : "",
      dateFrom: typeof p.dateFrom === 'string' ? p.dateFrom : "",
      dateTo: typeof p.dateTo === 'string' ? p.dateTo : "",
      showClosed: p.showClosed === true,
      showClosedKanban: false, // nunca restaurado, ver FiltrosSalvos
      quickFilter: ["all", "mine", "unassigned", "overdue", "high"].includes(p.quickFilter) ? p.quickFilter : "all",
      // NÃO restaura (2026-11-11, pedido do usuário): toda entrada ou
      // recarga da tela abre em "Minha equipe", mesmo que a pessoa tenha
      // trocado pra "Todos" antes. Os demais filtros continuam salvos.
      viewScope: "team",
    };
  } catch {
    return FILTROS_PADRAO;
  }
}

// Default team options (will be replaced by DB values)
const DEFAULT_TEAM_OPTIONS = [
  { value: "Desenvolvimento", label: "Desenvolvimento", color: "bg-[var(--accent)]/20 text-[var(--accent-text)]" },
  { value: "Infraestrutura", label: "Infraestrutura", color: "bg-[var(--surface-success)] text-[var(--text-success)]" },
  { value: "QA / Testes", label: "QA / Testes", color: "bg-[var(--surface-warning)] text-[var(--text-warning)]" },
  { value: "Produto", label: "Produto", color: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

export function InternalTicketsView({
  viewToggle,
  viewModeSwitcher,
  viewMode,
  openNewModal,
}: {
  viewToggle?: React.ReactNode;
  viewModeSwitcher?: React.ReactNode;
  viewMode: "cards" | "table" | "kanban";
  // Atalho do Dashboard (?new=1) — abre a criação direto, sem exigir um
  // segundo clique em "Novo Ticket" depois de chegar na lista.
  openNewModal?: boolean;
}) {
  const router = useRouter();
  const { currentUser, hasPermission, refreshTrigger, navBadges } = useApp();
  const openInternalTicket = useOpenInternalTicket();
  const [tickets, setTickets] = useState<InternalTicketItem[]>([]);
  // Só usado em <select> de filtro/responsável (sem avatar, ver componente
  // Avatar local — só aceita {name,size}) — via hook compartilhado "lite"
  // filtrado no client, mesmo papel (Equipe/Administrador) que a busca
  // direta trazia, sem pagar avatar_url de ninguém.
  const { data: profilesLiteData } = useProfilesLiteQuery();
  const analysts = useMemo(
    () => ((profilesLiteData || []) as User[]).filter((u) => u.role === "Equipe" || u.role === "Administrador"),
    [profilesLiteData]
  );

  // Opções do seletor inline de responsável. Inclui "Time Interno", que atende
  // ticket interno mas não entra no filtro `analysts` acima (usado para outra
  // coisa) — quem trabalha nesses tickets precisa poder ser atribuído a eles.
  // Mantém `internalTeamIds` (ao contrário da versão anterior, que descartava
  // no .map) — é o que `assignableUsersByTeam` (abaixo de `sortedInternalTeams`,
  // mais abaixo neste arquivo) usa pra escopar por equipe.
  const assignableUsers = useMemo(
    () => ((profilesLiteData || []) as any[])
      .filter((u) => ["Administrador", "Equipe", "Time Interno"].includes(u.role))
      .map((u) => ({ id: u.id, name: u.name, avatarThumbUrl: u.avatarThumbUrl, internalTeamIds: u.internalTeamIds || [] })),
    [profilesLiteData]
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Edição em massa (2026-09-30, pedido do usuário) — seleção só na visão
  // Tabela (ver TicketTable). Campos editáveis em lote: Status, Responsável,
  // Equipe e Prioridade, mesmos 4 que o usuário pediu pra esta tela.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkStatusOpen, setIsBulkStatusOpen] = useState(false);
  const [isBulkAssigneeOpen, setIsBulkAssigneeOpen] = useState(false);
  const [isBulkTeamOpen, setIsBulkTeamOpen] = useState(false);
  const [isBulkPriorityOpen, setIsBulkPriorityOpen] = useState(false);
  useEscapeToClose(isBulkStatusOpen, () => setIsBulkStatusOpen(false));
  useEscapeToClose(isBulkAssigneeOpen, () => setIsBulkAssigneeOpen(false));
  useEscapeToClose(isBulkTeamOpen, () => setIsBulkTeamOpen(false));
  useEscapeToClose(isBulkPriorityOpen, () => setIsBulkPriorityOpen(false));
  const [isBulkSaving, setIsBulkSaving] = useState(false);

// Filters
  const [searchTerm, setSearchTerm] = useState(FILTROS_PADRAO.searchTerm);
  // Busca só vai ao servidor 300ms depois da última tecla (2026-11-11,
  // análise de performance): antes cada letra digitada disparava uma carga
  // completa da lista. Mesmo intervalo do ModernSearchBar dos chamados.
  const [debouncedSearch, setDebouncedSearch] = useState(FILTROS_PADRAO.searchTerm);
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(h);
  }, [searchTerm]);
  // Várias equipes de uma vez: o normal é acompanhar a própria E as vizinhas
  // com quem o trabalho cruza, não uma só.
  const [filterTeams, setFilterTeams] = useState<string[]>(FILTROS_PADRAO.filterTeams);
  const [filterAssignee, setFilterAssignee] = useState(FILTROS_PADRAO.filterAssignee);
  const [filterStatus, setFilterStatus] = useState(FILTROS_PADRAO.filterStatus);
  const [filterPriority, setFilterPriority] = useState(FILTROS_PADRAO.filterPriority);
  const [dateFrom, setDateFrom] = useState(FILTROS_PADRAO.dateFrom);
  const [dateTo, setDateTo] = useState(FILTROS_PADRAO.dateTo);
  // Encerrados fora por padrão: abrir a tela carregando todo o histórico
  // concluído é justamente o que ninguém está procurando.
  const [showClosed, setShowClosed] = useState(FILTROS_PADRAO.showClosed);
  const [showClosedKanban, setShowClosedKanban] = useState(FILTROS_PADRAO.showClosedKanban);
  const isKanban = viewMode === "kanban";
  const effectiveShowClosed = isKanban ? showClosedKanban : showClosed;
  const setEffectiveShowClosed = isKanban ? setShowClosedKanban : setShowClosed;
  const [showFilters, setShowFilters] = useState(false);
  // Chips de atalho — a mesma ideia do "Minhas tarefas"/"Sem responsável"
  // que Jira/Linear/ClickUp sempre têm de cara, sem precisar abrir filtro
  // avançado pra isso.
  const [quickFilter, setQuickFilter] = useState<"all" | "mine" | "unassigned" | "overdue" | "high">(FILTROS_PADRAO.quickFilter);
  const [viewScope, setViewScope] = useState<ViewScope>(FILTROS_PADRAO.viewScope);
  const [totalCount, setTotalCount] = useState(0);
  // Carrega o recorte inteiro de uma vez (2026-11-11, pedido do usuário):
  // a tela antes mostrava só os 20 primeiros e depois tinha "Carregar mais".
  // Sem equipe interna (ex.: Administrador fora de qualquer equipe), "Minha
  // equipe" não teria o que mostrar — a opção some e a tela cai em "Todos",
  // sem mexer na preferência salva (se a pessoa entrar numa equipe depois, a
  // visão padrão volta a valer sozinha).
  const hasTeam = (currentUser?.internalTeamIds?.length ?? 0) > 0;
  const effectiveScope: ViewScope = viewScope === "team" && !hasTeam ? "all" : viewScope;

  // Restauração das preferências salvas.
  //
  // Feita depois da montagem, e não como valor inicial do useState, porque
  // este componente também é renderizado no servidor: ler localStorage no
  // primeiro render faz o HTML do servidor divergir do cliente. O `hidratado`
  // segura a primeira busca até a restauração terminar — sem ele a tela faria
  // duas requisições, uma com os filtros vazios e outra com os salvos, e a
  // lista piscaria o resultado errado no caminho.
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => {
    const salvos = carregarFiltros();
    setSearchTerm(salvos.searchTerm);
    setDebouncedSearch(salvos.searchTerm);
    setFilterTeams(salvos.filterTeams);
    setFilterAssignee(salvos.filterAssignee);
    setFilterStatus(salvos.filterStatus);
    setFilterPriority(salvos.filterPriority);
    setDateFrom(salvos.dateFrom);
    setDateTo(salvos.dateTo);
    setShowClosed(salvos.showClosed);
    setQuickFilter(salvos.quickFilter);
    // Filtro avançado já aberto quando algum deles está valendo — senão a
    // lista volta recortada por um filtro invisível, que é o jeito mais rápido
    // de alguém achar que "sumiram tickets".
    const temFiltroAvancado = salvos.filterTeams.length > 0 || !!salvos.filterAssignee
      || !!salvos.filterStatus || !!salvos.filterPriority || !!salvos.dateFrom || !!salvos.dateTo
      || salvos.showClosed;
    if (temFiltroAvancado) setShowFilters(true);
    setHidratado(true);
  }, []);

  useEffect(() => {
    if (!hidratado) return; // não sobrescrever o salvo com os padrões antes de ler
    const atual: FiltrosSalvos = {
      searchTerm, filterTeams, filterAssignee, filterStatus,
      filterPriority, dateFrom, dateTo, showClosed, showClosedKanban: false, quickFilter, viewScope: "team"
    };
    try {
      localStorage.setItem(FILTROS_STORAGE_KEY, JSON.stringify(atual));
    } catch {
      // Sem espaço ou storage bloqueado: preferência de filtro não vale
      // interromper a tela.
    }
  }, [hidratado, searchTerm, filterTeams, filterAssignee, filterStatus, filterPriority, dateFrom, dateTo, showClosed, quickFilter]);

  // Teams (dado de referência — via hook compartilhado, cache de 60s, em vez
  // de buscar internal_teams do zero toda vez que a tela monta).
  const { data: internalTeamsData } = useInternalTeamsQuery();
  const sortedInternalTeams = useMemo(
    () => [...(internalTeamsData || [])].sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [internalTeamsData]
  );
  const teams = useMemo(
    () => sortedInternalTeams.length > 0
      ? sortedInternalTeams.map((t: any) => ({
          value: t.name,
          label: t.name,
          color: "bg-[var(--accent)]/20 text-[var(--accent-text)]"
        }))
      : DEFAULT_TEAM_OPTIONS,
    [sortedInternalTeams]
  );

  // Pedido do usuário, 2026-11-08: o seletor de responsável (inline na
  // tabela/cards/kanban) mostrava TODO MUNDO (qualquer equipe), não só quem
  // pertence à equipe do próprio ticket — mesma correção já feita na criação
  // (components/new-internal-ticket-modal.tsx). `teamId` do ticket é o NOME
  // da equipe (mesmo valor de `teams[].value`, não o uuid), então resolve
  // pelo nome antes de filtrar por `internalTeamIds` (que são uuids).
  const assignableUsersByTeam = useMemo(() => {
    const map = new Map<string, typeof assignableUsers>();
    sortedInternalTeams.forEach((t: any) => {
      map.set(t.name, assignableUsers.filter(u => (u.internalTeamIds || []).includes(t.id)));
    });
    return map;
  }, [assignableUsers, sortedInternalTeams]);
  // Sem equipe reconhecida (ticket legado, ou equipe fora do cadastro atual)
  // cai pra lista inteira — melhor mostrar todo mundo do que não mostrar
  // ninguém nesse caso raro.
  const getAssignableUsersForTeam = (teamName?: string) =>
    (teamName && assignableUsersByTeam.get(teamName)) || assignableUsers;

  // Status (fetched de config_statuses, scope=internal_ticket — cadastrados
  // em Configurações > Geral > Status) — DEFAULT_KANBAN_STATUSES só cobre o
  // primeiro render, antes do fetch resolver.
  const [statuses, setStatuses] = useState<KanbanStatusMeta[]>(DEFAULT_KANBAN_STATUSES);
  // Colunas do Kanban (2026-11-11, pedido do usuário): desmarcado, só as
  // colunas abertas; marcado, SÓ as fechadas (is_closed, ex.: "Concluído") —
  // nunca as duas juntas, mesmo padrão do Kanban de "Todos os Chamados". O
  // servidor também só devolve os encerrados nesse caso (closedOnly=1). Só o
  // Kanban: `statuses` continua completo pros seletores de status (lote, cards).
  // Exceção: com BUSCA (título ou número) todas as colunas aparecem — o
  // servidor devolve abertos e encerrados juntos nesse caso (ver
  // action=board), e sem a coluna o ticket encerrado achado ficaria invisível.
  const temBusca = debouncedSearch.trim().length > 0;
  const kanbanStatuses = useMemo(
    () => (temBusca ? statuses : statuses.filter((st) => (showClosedKanban ? !!st.isClosed : !st.isClosed))),
    [statuses, showClosedKanban, temBusca]
  );

// Modal states
  const [showNewModal, setShowNewModal] = useState(false);

  // Mesma checagem de permissão do botão "Novo Ticket" abaixo — sem ela, o
  // link do Dashboard abriria o modal pra quem só tem permissão de VER
  // ticket interno, não de criar.
  useEffect(() => {
    if (openNewModal && hasPermission(Permission.INTERNAL_TICKETS_EDIT)) {
      setShowNewModal(true);
      router.replace('/tickets?mode=internal');
    }
  }, [openNewModal]);

  // View mode state
  const fetchTickets = useCallback(async (page = 1, isLoadMore = false) => {
    if (!currentUser) return;

    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      // Uma chamada resolve página, total, responsáveis, vínculos e
      // contagem de comentários — antes eram cinco consultas encadeadas
      // saindo do navegador (ver action=board em app/api/internal-tickets).
      const qs = new URLSearchParams({ page: '1', pageSize: String(MAX_ITEMS) });
      if (debouncedSearch) qs.set('search', debouncedSearch);
      if (filterTeams.length > 0) qs.set('teamIds', filterTeams.join(','));
      if (filterAssignee) qs.set('assigneeId', filterAssignee);
      if (filterStatus) qs.set('status', filterStatus);
      if (filterPriority) qs.set('priority', filterPriority);
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      // Marcado = só os encerrados, em qualquer visão (Tabela/Cards/Kanban).
      if (effectiveShowClosed) qs.set('closedOnly', '1');
      if (effectiveScope !== 'all') qs.set('scope', effectiveScope);

      // O recorte por equipe é FILTRO (viewScope, padrão "Minha equipe"),
      // não permissão: ticket interno é visível a todo o time (ver
      // app/api/internal-tickets/route.ts) e "Todos" mostra tudo.

      const boardRes = await fetch(`/api/internal-tickets?action=board&${qs}`);
      if (!boardRes.ok) throw new Error(`Falha ao carregar tickets internos (HTTP ${boardRes.status}).`);
      const board = await boardRes.json();

      const internalData = board.tickets || [];
      setTotalPages(Math.max(1, Math.ceil((board.total || 0) / ITEMS_PER_PAGE)));
      setTotalCount(board.total || 0);

      const assigneeMap = new Map<string, { name: string; avatarThumbUrl: string | null }>(
        Object.entries(board.assignees || {}) as any
      );
      const links = board.links || [];
      const ticketMap = new Map<string, string>(Object.entries(board.ticketLabels || {}) as any);
      const commentCountMap = new Map<string, number>(Object.entries(board.commentCounts || {}) as any);

      // Vínculos agrupados uma vez (antes: varrer a lista de vínculos inteira
      // para cada ticket).
      const linksByInternal = new Map<string, string[]>();
      for (const l of links as any[]) {
        const arr = linksByInternal.get(l.internal_ticket_id);
        if (arr) arr.push(l.ticket_id); else linksByInternal.set(l.internal_ticket_id, [l.ticket_id]);
      }

      setTickets((internalData || []).map((it: any) => {
        const linkedIds = linksByInternal.get(it.id) || [];

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
          // O shim do Supabase devolve a linha crua (assignee_id/creator_id/
          // team_id) — sem esse mapeamento, o filtro "Meus" (usa
          // t.assigneeId/t.creatorId) nunca batia com nada, "Não atribuído"
          // mostrava todos os tickets, e o card sempre caía no fallback
          // teams[0] em vez da equipe real (ver linhas 673/773 embaixo).
          assigneeId: it.assignee_id || undefined,
          creatorId: it.creator_id || undefined,
          teamId: it.team_id || undefined,
          parentTicketIds: linkedIds,
          linkedTicketTitles: linkedIds.map((id: string) => ticketMap.get(id) || "Ticket removido").filter(Boolean),
          assigneeName: it.assignee_id ? assigneeMap.get(it.assignee_id)?.name || null : null,
          assigneeAvatarThumbUrl: it.assignee_id ? assigneeMap.get(it.assignee_id)?.avatarThumbUrl || null : null,
          slaRemaining,
          status: it.status || "Novo",
          tags: it.tags || [],
          commentCount: commentCountMap.get(it.id) || 0,
          // A linha vem em snake_case do servidor e a tabela lê estes quatro
          // em camelCase — sem o mapeamento as colunas Sub-status/Resolvido/
          // QA/Entrega ficavam sempre "-" (achado na análise de 2026-11-11).
          subStatus: it.sub_status ?? null,
          resolvedAt: it.resolved_at ?? null,
          qaRejected: !!it.qa_rejected,
          lateDelivery: !!it.late_delivery,
        };
      }));
    } catch (error) {
      console.error("Error loading tickets:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // showClosed e filterStatus entram aqui: sem eles nas dependências, o
    // controle muda de estado mas a lista não recarrega, e o filtro parece
    // simplesmente não funcionar. filterStatus já estava faltando antes —
    // trocar o status no filtro avançado também não surtia efeito.
  }, [currentUser, debouncedSearch, filterTeams, filterAssignee, filterStatus, filterPriority, dateFrom, dateTo, effectiveShowClosed, effectiveScope]);

  useEffect(() => {
    if (!hidratado) return; // espera a restauração dos filtros salvos
    fetchTickets(1);
  // refreshTrigger (o NÚMERO), não triggerRefresh (a função, que nunca muda):
  // com a função aqui, salvar algo no modal do ticket não recarregava a lista.
  }, [hidratado, fetchTickets, refreshTrigger]);

  // Edição em massa — troca o campo de todos os selecionados numa chamada só
  // (InternalTicketService.bulkUpdate → POST /api/internal-tickets,
  // action=update com `ids`) e recarrega a lista.
  const handleBulkFieldChange = async (fields: Partial<{ status: string; assigneeId: string; teamId: string; priority: number }>, successMessage: string) => {
    if (selectedIds.length === 0) return;
    setIsBulkSaving(true);
    try {
      await InternalTicketService.bulkUpdate(selectedIds, fields);
      toast.success(successMessage);
      setSelectedIds([]);
      setIsBulkStatusOpen(false);
      setIsBulkAssigneeOpen(false);
      setIsBulkTeamOpen(false);
      setIsBulkPriorityOpen(false);
      fetchTickets(currentPage);
    } catch (error: any) {
      toast.error(error?.message || "Erro na atualização em massa.");
    } finally {
      setIsBulkSaving(false);
    }
  };

  const toggleSelectTicket = (uuid: string) => {
    setSelectedIds(prev => prev.includes(uuid) ? prev.filter(id => id !== uuid) : [...prev, uuid]);
  };
  const toggleSelectAllTickets = () => {
    setSelectedIds(prev => prev.length === displayTickets.length ? [] : displayTickets.map(t => t.uuid!).filter(Boolean));
  };

  // Troca de responsável direto no card, sem abrir o ticket. Otimista, com
  // desfazer em caso de recusa — mesma escolha da lista de chamados.
  // ATENÇÃO ao id: `ticket.id` neste componente é o número FORMATADO
  // ("int-0001"), usado só para exibir. O id real do banco é `ticket.uuid`
  // (ver o mapeamento em fetchTickets e handleStatusChange, que já fazia
  // assim). Mandar o formatado faz o UPDATE não encontrar nada e a rota
  // responder 404 — foi exatamente o que quebrou a primeira versão disto.
  const reassignInternalTicket = async (ticketUuid: string, assigneeId: string | null) => {
    const alvo = tickets.find(t => t.uuid === ticketUuid);
    const anterior = alvo?.assigneeId;
    const anteriorNome = alvo?.assigneeName;
    const anteriorAvatar = alvo?.assigneeAvatarThumbUrl;
    const novo = assignableUsers.find(u => u.id === assigneeId);

    setTickets(prev => prev.map(t => t.uuid === ticketUuid ? {
      ...t,
      assigneeId: assigneeId || undefined,
      assigneeName: novo?.name,
      assigneeAvatarThumbUrl: novo?.avatarThumbUrl
    } : t));

    try {
      const res = await fetch('/api/internal-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: ticketUuid, fields: { assigneeId } })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Erro ao trocar o responsável.');
      }
      toast.success(novo ? `Ticket atribuído a ${novo.name}.` : 'Responsável removido do ticket.');
    } catch (err: any) {
      setTickets(prev => prev.map(t => t.uuid === ticketUuid ? {
        ...t,
        assigneeId: anterior,
        assigneeName: anteriorNome,
        assigneeAvatarThumbUrl: anteriorAvatar
      } : t));
      toast.error(err?.message || 'Não foi possível trocar o responsável.');
    }
  };

  useEffect(() => {
    async function loadStatuses() {
      try {
        const data = await ConfigService.getStatuses('internal_ticket');
        const topLevel = data.filter(s => !s.parentStatusId);
        if (topLevel.length > 0) {
          setStatuses(topLevel.map(s => {
            const c = findStatusColor(s.color);
            return { value: s.label, label: s.label, color: `${c.bg} ${c.text}`, dot: c.dot, accent: c.accent, isClosed: !!s.isClosed };
          }));
        }
      } catch (error) {
        console.error('Error loading internal ticket statuses:', error);
      }
    }
    loadStatuses();
  }, []);

  const resetFilters = () => {
    setSearchTerm("");
    setFilterTeams([]);
    setFilterAssignee("");
    setFilterStatus("");
    setFilterPriority("");
    setDateFrom("");
    setDateTo("");
    setShowClosed(false);
    setShowClosedKanban(true);
    setQuickFilter("all");
    setViewScope("team");
  };

  // Quantos filtros avançados estão valendo — vira o contador no botão
  // "Filtros". Filtro salvo que não se anuncia é filtro que some da vista:
  // com a barra fechada, a lista volta recortada sem nada explicando por quê.
  const filtrosAtivos = useMemo(() => (
    (filterTeams.length > 0 ? 1 : 0) + (filterAssignee ? 1 : 0) + (filterStatus ? 1 : 0)
    + (filterPriority ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
    // Conta só quando difere do padrão da visão — senão o Kanban, que nasce
    // com encerrados ligados, abriria sempre anunciando um filtro "ativo".
    + (effectiveShowClosed !== (isKanban ? FILTROS_PADRAO.showClosedKanban : FILTROS_PADRAO.showClosed) ? 1 : 0)
  ), [filterTeams, filterAssignee, filterStatus, filterPriority, dateFrom, dateTo, effectiveShowClosed, isKanban]);

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

const openEditModal = (ticket: InternalTicketItem) => {
     // Modal por cima da lista (?internalTicket=), não mais outra página.
     openInternalTicket(ticket.id || ticket.uuid || "");
   };

   const handleStatusChange = async (ticketUuid: string, newStatus: string) => {
     try {
       const previousStatus = tickets.find(t => t.uuid === ticketUuid)?.status || 'Novo';
       const res = await fetch('/api/internal-tickets', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ action: 'update', id: ticketUuid, fields: { status: newStatus } })
       });
       if (!res.ok) throw new Error('Erro ao atualizar o status.');
       if (newStatus !== previousStatus) {
         await InternalTicketService.logEvent(ticketUuid, currentUser?.id, `Status alterado de "${previousStatus}" para "${newStatus}"`);
       }
       fetchTickets(1);
     } catch (error) {
       console.error('Error updating status:', error);
     }
   };

  return (
    // Mesmo wrapper "space-y-8" solto de Chamados (tickets-view.tsx), sem
    // altura fixa nem scroll interno próprio — as duas telas rolam junto com
    // <main> (layout.tsx), senão o cabeçalho troca de posição/moldura ao
    // alternar entre elas (uma tinha m-6 + scroll aninhado, a outra não).
    <div className="space-y-8">
      {/* Header — mesmo cartão (borda nos 4 lados + cantos arredondados,
          sem margem extra) do cabeçalho de Chamados. */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-3xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Tickets Internos</h1>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">Gerencie tickets internos de desenvolvimento e manutenção</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {viewToggle}
            {hasPermission(Permission.INTERNAL_TICKETS_EDIT) && (
              <button
                onClick={() => setShowNewModal(true)}
                className="px-4 py-2 bg-[var(--text-warning-strong)] text-white rounded-xl text-xs font-semibold uppercase tracking-widest hover:bg-[var(--accent-warning-hover)] transition-all flex items-center gap-2 whitespace-nowrap"
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
              placeholder="Buscar por título ou número (ex.: 37 ou int-0037)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--border-default)] focus:border-[var(--text-warning-strong)] outline-none text-sm font-medium"
            />
          </div>

          {/* View Switcher — compartilhado com a visão de Chamados, controlado pelo componente pai */}
          {viewModeSwitcher}

          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-widest transition-all flex items-center gap-2",
              showFilters || filtrosAtivos > 0
                ? "bg-[var(--text-warning-strong)] text-white"
                : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
            )}
          >
            <Filter size={16} />
            Filtros
            {filtrosAtivos > 0 && (
              <span className="px-1.5 rounded-full bg-white/25 text-[10px] leading-4">{filtrosAtivos}</span>
            )}
          </button>
        </div>

        {/* Visão principal (servidor) + chips rápidos (página carregada) */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <div role="radiogroup" aria-label="Visão dos tickets" className="flex items-center gap-1 p-1 rounded-full bg-[var(--surface-pill)]">
            {[
              ...(hasTeam ? [{ key: "team" as const, label: "Minha equipe", icon: Users }] : []),
              { key: "all" as const, label: "Todos", icon: Inbox },
              { key: "assigned" as const, label: "Atribuído a mim", icon: UserIcon },
            ].map((opt) => (
              <button
                key={opt.key}
                role="radio"
                aria-checked={effectiveScope === opt.key}
                onClick={() => setViewScope(opt.key)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1.5",
                  effectiveScope === opt.key
                    ? "bg-[var(--text-warning-strong)] text-white shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                <opt.icon size={11} />
                {opt.label}
                {/* Total vem do servidor: só a visão ativa tem número
                    confiável — as outras não são consultadas à toa. */}
                {effectiveScope === opt.key && !loading && (
                  <span className="px-1.5 rounded-full text-[9px] bg-white/20">{totalCount}</span>
                )}
              </button>
            ))}
          </div>
          <span className="w-px h-5 bg-[var(--border-default)] mx-1" aria-hidden />
          {[
            { key: "mine" as const, label: "Meus", icon: UserIcon, count: quickFilterCounts.mine },
            { key: "unassigned" as const, label: "Sem responsável", icon: Inbox, count: quickFilterCounts.unassigned },
            { key: "overdue" as const, label: "Atrasadas", icon: AlertTriangle, count: quickFilterCounts.overdue },
            { key: "high" as const, label: "Alta prioridade", icon: Flame, count: quickFilterCounts.high },
          ].map((chip) => (
            <button
              key={chip.key}
              onClick={() => setQuickFilter(quickFilter === chip.key ? "all" : chip.key)}
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
                {/* Múltipla escolha: acompanhar duas ou três equipes ao mesmo
                    tempo é o caso comum de quem trabalha atravessado. */}
                <MultiSelectFilter
                  options={teams.map((t) => ({ value: t.value, label: t.label }))}
                  selected={filterTeams}
                  onChange={setFilterTeams}
                  allLabel="Todas Equipes"
                  itemLabelPlural="equipes"
                  searchPlaceholder="Buscar equipe..."
                />

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
                   {statuses.map((s) => (
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

                {/* Encerrados ficam fora por padrão (o servidor já os exclui,
                    ver app/api/internal-tickets/route.ts). Este é o caminho
                    para trazê-los de volta quando alguém realmente procura
                    histórico. */}
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-default)] cursor-pointer select-none hover:bg-[var(--surface-pill)] transition-colors">
                  <input
                    type="checkbox"
                    checked={effectiveShowClosed}
                    onChange={(e) => setEffectiveShowClosed(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border-default)] accent-[var(--accent)] cursor-pointer"
                  />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    Mostrar encerrados
                  </span>
                </label>

                {/* Saída única para voltar ao estado limpo. Ganhou importância
                    agora que os filtros ficam salvos: sem isto, desfazer uma
                    combinação antiga vira campo a campo. */}
                {(filtrosAtivos > 0 || searchTerm) && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-3 py-2 rounded-lg border border-[var(--border-default)] text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-colors"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content — sem wrapper de scroll próprio, mesmo padrão de Chamados
          (o conteúdo é filho direto do space-y-8, <main> que rola). */}
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
            <TicketCard
              key={it.id}
              ticket={it}
              onEdit={() => openEditModal(it)}
              teams={teams}
              statuses={statuses}
              assignableUsers={assignableUsers}
              getAssignableUsersForTeam={getAssignableUsersForTeam}
              onReassign={reassignInternalTicket}
              unreadCount={navBadges.internalTicketsUnreadByTicket[it.uuid || ''] || 0}
            />
          ))}
        </div>
      ) : viewMode === "table" ? (
        <>
          {/* Barra de ações em massa — só aparece com algo selecionado, mesmo
              padrão de "Todos os Chamados" (tickets-view.tsx). */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 bg-[var(--surface-card)] border border-[var(--accent)]/30 rounded-2xl px-4 py-3 flex-wrap">
              <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-widest">
                {selectedIds.length} selecionado{selectedIds.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setIsBulkStatusOpen(true)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all">
                  Alterar Status
                </button>
                <button onClick={() => setIsBulkAssigneeOpen(true)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all">
                  Transferir
                </button>
                <button onClick={() => setIsBulkTeamOpen(true)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all">
                  Mudar Equipe
                </button>
                <button onClick={() => setIsBulkPriorityOpen(true)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all">
                  Alterar Prioridade
                </button>
              </div>
              <button onClick={() => setSelectedIds([])} className="ml-auto p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all" title="Limpar seleção">
                <X size={14} />
              </button>
            </div>
          )}
          <TicketTable
            tickets={displayTickets}
            onEdit={openEditModal}
            teams={teams}
            statuses={statuses}
            assignableUsers={assignableUsers}
            getAssignableUsersForTeam={getAssignableUsersForTeam}
            onReassign={reassignInternalTicket}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelectTicket}
            onToggleSelectAll={toggleSelectAllTickets}
            unreadByTicket={navBadges.internalTicketsUnreadByTicket}
          />
        </>
      ) : (
        <KanbanBoard tickets={displayTickets} onEdit={openEditModal} onStatusChange={handleStatusChange} statuses={kanbanStatuses} assignableUsers={assignableUsers} getAssignableUsersForTeam={getAssignableUsersForTeam} onReassign={reassignInternalTicket} />
      )}

      {!loading && tickets.length < totalCount && (
        <p className="text-center text-xs text-[var(--text-tertiary)]">
          Mostrando os {tickets.length} mais recentes de {totalCount} — refine os filtros para ver o restante.
        </p>
      )}

      {/* Modal - Only for creating new tickets */}
      <NewInternalTicketModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={() => fetchTickets(1)}
      />

      {/* Modais de edição em massa — mesmo padrão visual do "Alterar Status"
          de tickets-view.tsx: grid de opções, fecha ao clicar fora. */}
      {isBulkStatusOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setIsBulkStatusOpen(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-1 uppercase">Alterar Status</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">{selectedIds.length} ticket(s) selecionado(s)</p>
            <div className="grid grid-cols-2 gap-3">
              {statuses.map(s => (
                <button
                  key={s.value}
                  disabled={isBulkSaving}
                  onClick={() => handleBulkFieldChange({ status: s.value }, `${selectedIds.length} ticket(s) atualizado(s) para "${s.label}"`)}
                  className={cn("py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest border transition-all disabled:opacity-50", s.color)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {isBulkAssigneeOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setIsBulkAssigneeOpen(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-md w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-1 uppercase">Transferir</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">{selectedIds.length} ticket(s) selecionado(s)</p>
            <div className="flex-1 overflow-y-auto space-y-2">
              <button
                disabled={isBulkSaving}
                onClick={() => handleBulkFieldChange({ assigneeId: "" }, `${selectedIds.length} ticket(s) sem responsável`)}
                className="w-full p-3 text-left border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-pill)] transition-all text-sm font-bold text-[var(--text-tertiary)] disabled:opacity-50"
              >
                Não atribuído
              </button>
              {assignableUsers.map(u => (
                <button
                  key={u.id}
                  disabled={isBulkSaving}
                  onClick={() => handleBulkFieldChange({ assigneeId: u.id }, `${selectedIds.length} ticket(s) transferido(s) para ${u.name}`)}
                  className="w-full p-3 text-left border border-[var(--border-default)] rounded-lg hover:bg-[var(--surface-pill)] transition-all text-sm font-bold text-[var(--text-primary)] disabled:opacity-50"
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {isBulkTeamOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setIsBulkTeamOpen(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-1 uppercase">Mudar Equipe</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">{selectedIds.length} ticket(s) selecionado(s)</p>
            <div className="grid grid-cols-2 gap-3">
              {teams.map(t => (
                <button
                  key={t.value}
                  disabled={isBulkSaving}
                  onClick={() => handleBulkFieldChange({ teamId: t.value }, `${selectedIds.length} ticket(s) movido(s) para ${t.label}`)}
                  className={cn("py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest border transition-all disabled:opacity-50", t.color)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {isBulkPriorityOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4" onClick={() => setIsBulkPriorityOpen(false)}>
          <div className="bg-[var(--surface-card)] rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-[var(--text-primary)] mb-1 uppercase">Alterar Prioridade</h3>
            <p className="text-sm text-[var(--text-tertiary)] mb-4">{selectedIds.length} ticket(s) selecionado(s)</p>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(p => (
                <button
                  key={p}
                  disabled={isBulkSaving}
                  onClick={() => handleBulkFieldChange({ priority: p }, `${selectedIds.length} ticket(s) com prioridade atualizada`)}
                  className="py-3 rounded-xl text-xs font-bold border border-[var(--border-default)] hover:bg-[var(--surface-pill)] transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  <PriorityBars priority={p} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
        </div>
      );
    }

// Ticket Card Component
function TicketCard({
  ticket, onEdit, teams = DEFAULT_TEAM_OPTIONS, statuses = DEFAULT_KANBAN_STATUSES,
  assignableUsers = [], getAssignableUsersForTeam, onReassign, unreadCount = 0
}: {
  ticket: InternalTicketItem;
  onEdit: () => void;
  teams?: typeof DEFAULT_TEAM_OPTIONS;
  statuses?: KanbanStatusMeta[];
  assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[];
  // Pedido do usuário, 2026-11-08: escopa `assignableUsers` pela equipe DESTE
  // ticket — sem isso, o seletor sempre mostrava todo mundo, de qualquer
  // equipe. Opcional (cai pra `assignableUsers` cru) pra não quebrar quem
  // ainda não passa a função.
  getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers;
  onReassign?: (ticketId: string, assigneeId: string | null) => Promise<void>;
  unreadCount?: number;
}) {
  const teamOption = teams.find((t) => t.value === ticket.teamId) || teams[0];
  const scopedAssignableUsers = getAssignableUsersForTeam ? getAssignableUsersForTeam(ticket.teamId) : assignableUsers;
  const statusMeta = statuses.find(s => s.value === (ticket.status || "Novo")) || statuses[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className="relative bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] pl-5 pr-5 py-5 hover:shadow-lg hover:border-[var(--text-warning-strong)]/40 transition-all group cursor-pointer overflow-hidden"
      onClick={onEdit}
    >
      <NotificationCountBadge count={unreadCount} />
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
        {/* Clicável quando a tela passa onReassign: troca o responsável sem
            abrir o ticket. Sem o callback (kanban, telas somente leitura)
            volta a ser só o avatar. */}
        {onReassign ? (
          <InlineAssigneePicker
            currentAssigneeId={ticket.assigneeId}
            options={scopedAssignableUsers}
            emptyLabel="Sem responsável"
            size={24}
            onChange={(id) => onReassign(ticket.uuid!, id)}
          />
        ) : (
          <Avatar name={ticket.assigneeName} avatarThumbUrl={ticket.assigneeAvatarThumbUrl} size={24} />
        )}
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
function TicketTable({
  tickets, onEdit, teams = DEFAULT_TEAM_OPTIONS, statuses = DEFAULT_KANBAN_STATUSES,
  assignableUsers = [], getAssignableUsersForTeam, onReassign, selectedIds, onToggleSelect, onToggleSelectAll, unreadByTicket = {}
}: {
  tickets: InternalTicketItem[];
  onEdit: (t: InternalTicketItem) => void;
  teams?: typeof DEFAULT_TEAM_OPTIONS;
  statuses?: KanbanStatusMeta[];
  assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[];
  getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers;
  onReassign?: (ticketUuid: string, assigneeId: string | null) => Promise<void>;
  unreadByTicket?: Record<string, number>;
  // Edição em massa (2026-09-30) — seleção fica só na visão Tabela, mesma
  // decisão de escopo do padrão já usado em "Todos os Chamados"
  // (tickets-view.tsx): é a visão de gestão em lista, onde selecionar linha a
  // linha faz sentido; Cards/Kanban continuam sem checkbox.
  selectedIds?: string[];
  onToggleSelect?: (uuid: string) => void;
  onToggleSelectAll?: () => void;
}) {
  return (
    <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] overflow-hidden">
      <table className="w-full">
        <thead className="bg-[var(--surface-card)]/50 border-b border-[var(--border-default)]">
          <tr>
            {onToggleSelect && (
              <th className="px-4 py-3 w-10">
                <button onClick={(e) => { e.stopPropagation(); onToggleSelectAll?.(); }} className="flex items-center justify-center">
                  {selectedIds && selectedIds.length === tickets.length && tickets.length > 0 ? (
                    <CheckSquare size={16} className="text-[var(--accent-text)]" />
                  ) : (
                    <Square size={16} className="text-[var(--text-tertiary)]" />
                  )}
                </button>
              </th>
            )}
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Número</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Título</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Status</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Equipe</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Prioridade</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Responsável</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">SLA</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)] whitespace-nowrap">Entrega real</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">QA</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">Atraso</th>
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase text-[var(--text-tertiary)]"><MessageCircle size={12} /></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-default)]">
          {tickets.map((it) => {
            const teamOpt = teams.find((t) => t.value === it.teamId) || teams[0];
            const statusMeta = statuses.find(s => s.value === (it.status || "Novo")) || statuses[0];
            const isSelected = !!selectedIds?.includes(it.uuid!);
            const scopedAssignableUsers = getAssignableUsersForTeam ? getAssignableUsersForTeam(it.teamId) : assignableUsers;
            return (
              <tr key={it.id} className={cn("hover:bg-[var(--surface-card)]/50 transition-colors cursor-pointer group", isSelected && "bg-[var(--accent)]/5")} onClick={() => onEdit(it)}>
                {onToggleSelect && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => onToggleSelect(it.uuid!)} className="flex items-center justify-center">
                      {isSelected ? <CheckSquare size={16} className="text-[var(--accent-text)]" /> : <Square size={16} className="text-[var(--text-tertiary)]" />}
                    </button>
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: statusMeta.accent }} />
                    <span className="text-[10px] font-semibold text-[var(--text-warning)] whitespace-nowrap">{it.id?.startsWith("int-") ? it.id : `#${it.internalTicketNumber?.toString().padStart(4, "0")}`}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--text-warning)] transition-colors max-w-xs truncate">
                  <div className="flex items-center gap-1.5">
                    <UnreadDot show={!!unreadByTicket[it.uuid || '']} />
                    <span className="truncate">{it.title}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-semibold px-2 py-1 rounded-full uppercase flex items-center gap-1 w-fit", statusMeta.color)}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", statusMeta.dot)} />
                    {statusMeta.label}
                  </span>
                  {it.subStatus && (
                    <span className="block mt-1 text-[10px] text-[var(--text-tertiary)]">{it.subStatus}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={cn("text-[10px] font-semibold px-2 py-1 rounded-full uppercase", teamOpt.color)}>
                    {teamOpt.label}
                  </span>
                </td>
                <td className="px-4 py-3"><PriorityBars priority={it.priority || 1} /></td>
                <td className="px-4 py-3">
                  {/* Mesma troca inline da visão em cards — a tabela é a visão
                      padrão da tela, então era justamente onde mais faltava. */}
                  {onReassign ? (
                    <InlineAssigneePicker
                      currentAssigneeId={it.assigneeId}
                      options={scopedAssignableUsers}
                      emptyLabel="Não atribuído"
                      size={20}
                      className="max-w-[160px]"
                      onChange={(id) => onReassign(it.uuid!, id)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Avatar name={it.assigneeName} avatarThumbUrl={it.assigneeAvatarThumbUrl} size={20} />
                      <span className="text-sm text-[var(--text-secondary)] truncate max-w-[120px]">{it.assigneeName || "Não atribuído"}</span>
                    </div>
                  )}
                </td>
                <td className={cn("px-4 py-3 text-[10px] font-bold whitespace-nowrap",
                  it.slaRemaining === "Expirado" ? "text-[var(--text-danger)]" : "text-[var(--text-secondary)]")}>
                  {it.slaRemaining || "-"}
                </td>
                <td className="px-4 py-3 text-[10px] font-bold whitespace-nowrap text-[var(--text-secondary)]">
                  {it.resolvedAt ? new Date(it.resolvedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-"}
                </td>
                <td className="px-4 py-3">
                  {it.qaRejected ? (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full uppercase bg-[var(--surface-danger)] text-[var(--text-danger)] whitespace-nowrap">Reprovado</span>
                  ) : "-"}
                </td>
                <td className="px-4 py-3">
                  {!it.resolvedAt ? "-" : it.lateDelivery ? (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full uppercase bg-[var(--surface-danger)] text-[var(--text-danger)] whitespace-nowrap">Com atraso</span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full uppercase bg-[var(--surface-success)] text-[var(--text-success)] whitespace-nowrap">No prazo</span>
                  )}
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

// Kanban Board Component
function KanbanBoard({
  tickets,
  onEdit,
  onStatusChange,
  statuses = DEFAULT_KANBAN_STATUSES,
  assignableUsers = [],
  getAssignableUsersForTeam,
  onReassign
}: {
  tickets: InternalTicketItem[];
  onEdit: (t: InternalTicketItem) => void;
  onStatusChange?: (ticketId: string, newStatus: string) => void;
  statuses?: KanbanStatusMeta[];
  assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[];
  getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers;
  onReassign?: (ticketUuid: string, assigneeId: string | null) => Promise<void>;
}) {
  const [activeTicket, setActiveTicket] = useState<InternalTicketItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const columns = statuses.map(status => ({
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
          <KanbanColumn key={col.value} col={col} onEdit={onEdit} assignableUsers={assignableUsers} getAssignableUsersForTeam={getAssignableUsersForTeam} onReassign={onReassign} />
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
function KanbanColumn({ col, onEdit, assignableUsers = [], getAssignableUsersForTeam, onReassign }: { col: KanbanStatusMeta & { tickets: InternalTicketItem[] }; onEdit: (t: InternalTicketItem) => void; assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[]; getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers; onReassign?: (ticketUuid: string, assigneeId: string | null) => Promise<void> }) {
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

      {/* Scroll por coluna (2026-11-11, pedido do usuário) — mesmo padrão do
          Kanban do Dashboard: rolar uma coluna longa não arrasta a tela toda.
          Altura pela janela (não fixa) pra aproveitar telas maiores. */}
      <div className="p-3 space-y-2.5 min-h-[120px] max-h-[calc(100vh-16rem)] overflow-y-auto scrollbar-thin">
        {col.tickets.length === 0 ? (
          <div className={cn("text-center py-8 rounded-xl border-2 border-dashed transition-colors", isOver ? "border-[var(--text-warning-strong)]/40" : "border-[var(--border-default)]")}>
            <p className="text-[10px] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">Arraste um card aqui</p>
          </div>
        ) : (
          col.tickets.map((ticket) => (
            <DraggableKanbanCard key={ticket.uuid} ticket={ticket} onEdit={onEdit} assignableUsers={assignableUsers} getAssignableUsersForTeam={getAssignableUsersForTeam} onReassign={onReassign} />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableKanbanCard({ ticket, onEdit, assignableUsers = [], getAssignableUsersForTeam, onReassign }: { ticket: InternalTicketItem; onEdit: (t: InternalTicketItem) => void; assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[]; getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers; onReassign?: (ticketUuid: string, assigneeId: string | null) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.uuid || ticket.id || "" });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, opacity: isDragging ? 0.4 : 1 }}
      className="touch-none"
    >
      <KanbanCard ticket={ticket} onEdit={onEdit} assignableUsers={assignableUsers} getAssignableUsersForTeam={getAssignableUsersForTeam} onReassign={onReassign} />
    </div>
  );
}

// KanbanCard Component
function KanbanCard({ ticket, onEdit, dragging = false, assignableUsers = [], getAssignableUsersForTeam, onReassign }: { ticket: InternalTicketItem; onEdit: (t: InternalTicketItem) => void; dragging?: boolean; assignableUsers?: { id: string; name: string; avatarThumbUrl?: string | null }[]; getAssignableUsersForTeam?: (teamName?: string) => typeof assignableUsers; onReassign?: (ticketUuid: string, assigneeId: string | null) => Promise<void> }) {
  // useApp() direto aqui (em vez de perfurar DndContext → KanbanColumn →
  // DraggableKanbanCard) — menos props pra manter em sincronia, mesmo
  // indicativo de "notas novas" de TicketCard/TicketTable (2026-10-21).
  const { navBadges } = useApp();
  const unreadCount = navBadges.internalTicketsUnreadByTicket[ticket.uuid || ''] || 0;
  const scopedAssignableUsers = getAssignableUsersForTeam ? getAssignableUsersForTeam(ticket.teamId) : assignableUsers;
  return (
    <div
      onClick={() => !dragging && onEdit(ticket)}
      className={cn(
        "relative bg-[var(--surface-card)] rounded-xl p-3.5 border border-[var(--border-default)] transition-all group",
        dragging ? "shadow-2xl rotate-2 cursor-grabbing" : "hover:shadow-md hover:border-[var(--text-warning-strong)]/40 cursor-grab active:cursor-grabbing"
      )}
    >
      <NotificationCountBadge count={unreadCount} />
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
        {/* Trocar responsável sem sair do board. `dragging` é o card fantasma
            do DragOverlay: ali o seletor não pode ser interativo, senão o
            clique cairia num elemento que está sendo arrastado.
            O seletor barra o pointerdown (ver inline-assignee-picker.tsx), o
            que impede o dnd-kit de iniciar arraste ao pressioná-lo. */}
        {onReassign && !dragging ? (
          <InlineAssigneePicker
            currentAssigneeId={ticket.assigneeId}
            options={scopedAssignableUsers}
            emptyLabel=""
            size={22}
            onChange={(id) => onReassign(ticket.uuid!, id)}
          />
        ) : (
          <Avatar name={ticket.assigneeName} avatarThumbUrl={ticket.assigneeAvatarThumbUrl} size={22} />
        )}
      </div>
    </div>
  );
}
