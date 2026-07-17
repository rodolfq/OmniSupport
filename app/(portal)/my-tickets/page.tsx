'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/app/app-context';
import { Ticket, Permission, UserRole } from '@/lib/types';
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
  Tag
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, normalizeString } from '@/lib/utils';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { isClosedTicketStatus, isInProgressTicketStatus } from '@/lib/ticket-status';
import { useSearchParams } from 'next/navigation';

type CustomerStatusFilter = 'all' | 'Novo' | 'Em andamento' | 'Pendente' | 'Resolvido' | 'Concluído';

const CUSTOMER_STATUS_FILTERS: Array<{ value: CustomerStatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'Novo', label: 'Novo' },
  { value: 'Em andamento', label: 'Em andamento' },
  { value: 'Pendente', label: 'Pendente' },
  { value: 'Resolvido', label: 'Resolvido' },
  { value: 'Concluído', label: 'Concluído' },
];

function getCustomerStatusLabel(status: string) {
  if (isClosedTicketStatus(status)) return 'Concluído';
  if (isInProgressTicketStatus(status)) return 'Em andamento';
  return status;
}

function matchesCustomerStatusFilter(status: string, filter: CustomerStatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'Em andamento') return isInProgressTicketStatus(status);
  if (filter === 'Concluído') return isClosedTicketStatus(status);
  return status === filter;
}

export default function MyTicketsPage() {
  const { currentUser, hasPermission, setIsNewTicketModalOpen, refreshTrigger } = useApp();
  const searchParams = useSearchParams();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]); // Renamed from tickets = useState<Ticket[]>([])
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CustomerStatusFilter>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    async function loadData() {
        if (!currentUser) return;
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
  }, [currentUser?.id, currentUser?.companyId, currentUser?.viewAllCompanyTickets, currentUser?.role, refreshTrigger, hasPermission, searchParams]);

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

  const getStatusColor = (status: string) => {
    if (status === 'Novo') return 'bg-[var(--surface-info)] text-[var(--text-info)]';
    if (isInProgressTicketStatus(status)) return 'bg-[var(--surface-warning)] text-[var(--text-warning)]';
    if (status === 'Pendente') return 'bg-[var(--surface-pill)] text-[var(--text-secondary)]';
    if (status === 'Resolvido') return 'bg-[var(--surface-success)] text-[var(--text-success)]';
    if (isClosedTicketStatus(status)) return 'bg-[var(--surface-pill)] text-[var(--text-secondary)]';
    return 'bg-[var(--surface-pill)] text-[var(--text-secondary)]';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tight">Meus Chamados</h2>
          <p className="text-[var(--text-tertiary)] font-medium mt-1">Acompanhe suas solicitações e interaja com o suporte.</p>
        </div>
        
        <button 
          onClick={() => setIsNewTicketModalOpen(true)}
          className="bg-[var(--accent)] text-white px-8 py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-3 active:scale-95"
        >
          <Plus size={18} />
          Novo Chamado
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-[var(--surface-card)] p-4 rounded-[2rem] border border-[var(--border-default)] shadow-xl shadow-slate-200/50 flex flex-wrap items-center gap-4">
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
            className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:bg-[var(--surface-card)] focus:ring-4 focus:ring-[var(--accent)]/10 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-2 p-1 bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] overflow-x-auto max-w-full scrollbar-hidden">
          {CUSTOMER_STATUS_FILTERS.map(s => (
            <button
              key={s.value}
              onClick={() => {
                setFilter(s.value);
                setVisibleCount(12);
              }}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-semibold uppercase tracking-widest transition-all whitespace-nowrap",
                filter === s.value ? "bg-[var(--surface-card)] text-[var(--accent-text)] shadow-md" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-l border-[var(--border-default)] pl-4 ml-2">
           <button onClick={() => setView('grid')} className={cn("p-2.5 rounded-xl transition-all", view === 'grid' ? "bg-[var(--accent)] text-white shadow-lg shadow-indigo-100" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card)]")}>
             <LayoutGrid size={18} />
           </button>
           <button onClick={() => setView('list')} className={cn("p-2.5 rounded-xl transition-all", view === 'list' ? "bg-[var(--accent)] text-white shadow-lg shadow-indigo-100" : "text-[var(--text-tertiary)] hover:bg-[var(--surface-card)]")}>
             <ListIcon size={18} />
           </button>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-8">
        {visibleTickets.length > 0 ? (
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
                  whileHover={{ y: -4 }}
                  onClick={() => setSelectedTicket(ticket)}
                  className={cn(
                    "bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2.5rem] p-8 shadow-lg shadow-slate-200/40 cursor-pointer transition-all hover:shadow-2xl hover:shadow-indigo-100 group flex flex-col",
                    view === 'list' && "flex-row items-center gap-8 py-6 rounded-[2rem]"
                  )}
                >
                  <div className={cn(
                    "flex-1",
                    view === 'list' && "flex items-center gap-8 flex-1"
                  )}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
                      <span className={cn("px-4 py-1.5 rounded-full text-[9px] font-semibold uppercase tracking-widest", getStatusColor(ticket.status))}>
                        {getCustomerStatusLabel(ticket.status)}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight mb-2 group-hover:text-[var(--accent-text)] transition-colors leading-tight truncate">
                      {ticket.title}
                    </h3>
                    
                    <p className="text-sm text-[var(--text-tertiary)] font-medium line-clamp-2 mb-6">
                      {(() => {
                        const html = ticket.description || '';
                        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
                      })()}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-6">
                      {ticket.tags?.map(tag => (
                        <span key={tag} className="bg-[var(--surface-card)] text-[var(--text-tertiary)] px-3 py-1 rounded-lg text-[9px] font-semibold uppercase tracking-widest flex items-center gap-1.5">
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={cn(
                    "flex items-center justify-between pt-6 border-t border-[var(--border-default)]",
                    view === 'list' && "border-t-0 pt-0"
                  )}>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                        <Clock size={14} />
                        <span className="text-[10px] font-semibold uppercase">
                          {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                        <MessageSquare size={14} />
                        <span className="text-[10px] font-semibold uppercase">
                          -
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="text-slate-300 group-hover:text-[var(--accent-text)] transition-all transform group-hover:translate-x-1" size={20} />
                  </div>
                </motion.div>
              ))}
            </div>

            {filteredTickets.length > visibleCount && (
              <div className="text-center py-8">
                <button 
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="bg-[var(--surface-card)] border border-[var(--border-default)] text-[var(--text-secondary)] px-8 py-3 rounded-2xl text-[10px] font-semibold uppercase tracking-widest hover:bg-[var(--surface-card)] hover:border-indigo-300 hover:text-[var(--accent-text)] transition-all shadow-md group active:scale-95"
                >
                  Carregar mais chamados <span className="text-[var(--accent-text)] group-hover:text-[var(--accent-text)] ml-1">({filteredTickets.length - visibleCount})</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="bg-[var(--surface-card)] border-2 border-dashed border-[var(--border-default)] rounded-[3rem] p-20 text-center animate-in fade-in duration-700">
            <div className="w-24 h-24 bg-[var(--surface-card)] rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-slate-300">
               <TicketIcon size={48} />
            </div>
            <h3 className="text-2xl font-black text-[var(--text-primary)] uppercase tracking-tight mb-2">Sem chamados por aqui</h3>
            <p className="text-[var(--text-tertiary)] font-medium mb-8">Nenhum chamado corresponde aos filtros selecionados ou você ainda não abriu solicitações.</p>
            <button 
              onClick={() => setIsNewTicketModalOpen(true)}
              className="inline-flex items-center gap-3 bg-slate-900 text-white px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest hover:bg-[var(--accent)] transition-all shadow-xl hover:shadow-indigo-100"
            >
              <Plus size={20} />
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
