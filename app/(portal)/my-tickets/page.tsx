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
  FolderKanban
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, normalizeString } from '@/lib/utils';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { isClosedTicketStatus, getCustomerStatusLabel } from '@/lib/ticket-status';
import { useSearchParams, useRouter } from 'next/navigation';

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

function matchesCustomerStatusFilter(status: string, filter: CustomerStatusFilter) {
  if (filter === 'all') return true;
  return getCustomerStatusLabel(status) === filter;
}

export default function MyTicketsPage() {
  const { currentUser, hasPermission, setIsNewTicketModalOpen, refreshTrigger } = useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]); // Renamed from tickets = useState<Ticket[]>([])
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CustomerStatusFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
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

  useEffect(() => {
    if (!canSeeTickets && canSeeInternal) setTicketMode('internal');
    else if (canSeeTickets && !canSeeInternal) setTicketMode('tickets');
  }, [canSeeTickets, canSeeInternal]);

  useEffect(() => {
    async function loadData() {
        if (!currentUser) return;
        // Time interno sem "Visualizar chamados": nem busca — evita chamado
        // nenhum chegando na memória do cliente pra quem só tem Tickets
        // Internos.
        if (!canSeeTickets) { setAllTickets([]); return; }
        const all = await fetchAllTickets(undefined, { includeClosed: true });
        
        const canViewEverything = hasPermission(Permission.OUTSIDE_QUEUE_VIEW) || currentUser.role === UserRole.ADMIN;
    
        const filtered = all.filter(t => {
          if (canViewEverything) return true;
          if (currentUser.role === UserRole.CUSTOMER) {
            if (currentUser.viewAllCompanyTickets) {
              return t.companyId === currentUser.companyId;
            }
            return t.customerId === currentUser.id;
          }
          return (
            t.customerId === currentUser.id || 
            t.employeeIds?.includes(currentUser.id) ||
            t.assigneeId === currentUser.id
          );
        });
        setAllTickets(filtered);

        const ticketId = searchParams?.get('ticket');
        if (ticketId) {
          const ticket = filtered.find(t => t.id === ticketId);
          if (ticket) {
            setSelectedTicket(ticket);
          }
        }
    }
    loadData();
  }, [currentUser?.id, currentUser?.companyId, currentUser?.viewAllCompanyTickets, currentUser?.role, refreshTrigger, hasPermission, searchParams, canSeeTickets]);

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
      const matchesSearch = normalizeString(t.title).includes(normalQuery) || 
                           normalizeString(t.id).includes(normalQuery);
      const matchesStatus = matchesCustomerStatusFilter(t.status, filter);
      return matchesSearch && matchesStatus;
    });
  }, [allTickets, search, filter]);

  const visibleTickets = useMemo(() => {
    return filteredTickets.slice(0, visibleCount);
  }, [filteredTickets, visibleCount]);

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
                onClick={() => { setTicketMode('internal'); setVisibleCount(12); }}
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

        {ticketMode === 'tickets' && (
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
                <div className="text-center py-6">
                  <button
                    onClick={() => setVisibleCount(prev => prev + 12)}
                    className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-6 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--text-warning-strong)]/40 hover:text-[var(--text-warning)] transition-all shadow-sm group active:scale-95"
                  >
                    Carregar mais tickets <span className="text-[var(--text-warning)] ml-1">({filteredInternalTickets.length - visibleCount})</span>
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
                    "bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-6 shadow-sm cursor-pointer transition-all hover:shadow-md hover:border-[var(--accent)]/40 group flex flex-col",
                    view === 'list' && "flex-row items-center gap-6 py-4"
                  )}
                >
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
              <div className="text-center py-6">
                <button
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-6 py-2.5 rounded-xl text-[10px] font-semibold uppercase tracking-widest hover:border-[var(--accent)]/40 hover:text-[var(--accent-text)] transition-all shadow-sm group active:scale-95"
                >
                  Carregar mais chamados <span className="text-[var(--accent-text)] ml-1">({filteredTickets.length - visibleCount})</span>
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
              Abrir Primeiro Chamado
            </button>
          </div>
        )}
      </div>

      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
        />
      )}
    </div>
  );
}
