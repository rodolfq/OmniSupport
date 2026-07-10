'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/app/app-context';
import { Ticket, TicketStatus, Permission, UserRole } from '@/lib/types';
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

export default function MyTicketsPage() {
  const { currentUser, hasPermission, setIsNewTicketModalOpen, refreshTrigger } = useApp();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]); // Renamed from tickets = useState<Ticket[]>([])
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    async function loadData() {
        if (!currentUser) return;
        const all = await fetchAllTickets();
        
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
    }
    loadData();
  }, [currentUser, refreshTrigger, hasPermission]);

  const filteredTickets = useMemo(() => {
    const normalQuery = normalizeString(search);
    return allTickets.filter(t => {
      const matchesSearch = normalizeString(t.title).includes(normalQuery) || 
                           normalizeString(t.id).includes(normalQuery);
      const matchesStatus = filter === 'all' || t.status === filter;
      return matchesSearch && matchesStatus;
    });
  }, [allTickets, search, filter]);

  const visibleTickets = useMemo(() => {
    return filteredTickets.slice(0, visibleCount);
  }, [filteredTickets, visibleCount]);

  const getStatusColor = (status: TicketStatus) => {
    switch (status) {
      case TicketStatus.NEW: return 'bg-blue-100 text-blue-700';
      case TicketStatus.IN_PROGRESS: return 'bg-amber-100 text-amber-700';
      case TicketStatus.AWAITING_INTERNAL: return 'bg-purple-100 text-purple-700';
      case TicketStatus.AWAITING_CUSTOMER: return 'bg-pink-100 text-pink-700';
      case TicketStatus.CLOSED: return 'bg-emerald-100 text-emerald-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-800 uppercase tracking-tight">Meus Chamados</h2>
          <p className="text-slate-500 font-medium mt-1">Acompanhe suas solicitações e interaja com o suporte.</p>
        </div>
        
        <button 
          onClick={() => setIsNewTicketModalOpen(true)}
          className="bg-indigo-600 text-white px-8 py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 active:scale-95"
        >
          <Plus size={18} />
          Novo Chamado
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-[2rem] border border-slate-200 shadow-xl shadow-slate-200/50 flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Pesquisar por assunto ou ID..." 
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setVisibleCount(12);
            }}
            className="w-full bg-slate-50 border border-slate-100 rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-2 p-1 bg-slate-50 rounded-2xl border border-slate-100 overflow-x-auto max-w-full scrollbar-hidden">
          {(['all', ...Object.values(TicketStatus)] as const).map(s => (
            <button
              key={s}
              onClick={() => {
                setFilter(s);
                setVisibleCount(12);
              }}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                filter === s ? "bg-white text-indigo-600 shadow-md" : "text-slate-400 hover:text-slate-600"
              )}
            >
              {s === 'all' ? 'Todos' : s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-4 ml-2">
           <button onClick={() => setView('grid')} className={cn("p-2.5 rounded-xl transition-all", view === 'grid' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-400 hover:bg-slate-50")}>
             <LayoutGrid size={18} />
           </button>
           <button onClick={() => setView('list')} className={cn("p-2.5 rounded-xl transition-all", view === 'list' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "text-slate-400 hover:bg-slate-50")}>
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
                    "bg-white border border-slate-200 rounded-[2.5rem] p-8 shadow-lg shadow-slate-200/40 cursor-pointer transition-all hover:shadow-2xl hover:shadow-indigo-100 group flex flex-col",
                    view === 'list' && "flex-row items-center gap-8 py-6 rounded-[2rem]"
                  )}
                >
                  <div className={cn(
                    "flex-1",
                    view === 'list' && "flex items-center gap-8 flex-1"
                  )}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
                      <span className={cn("px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest", getStatusColor(ticket.status))}>
                        {ticket.status}
                      </span>
                    </div>
                    
                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight mb-2 group-hover:text-indigo-600 transition-colors leading-tight truncate">
                      {ticket.title}
                    </h3>
                    
                    <p className="text-sm text-slate-500 font-medium line-clamp-2 mb-6">
                      {(() => {
                        const html = ticket.description || '';
                        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
                      })()}
                    </p>

                    <div className="flex flex-wrap gap-2 mb-6">
                      {ticket.tags?.map(tag => (
                        <span key={tag} className="bg-slate-50 text-slate-500 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5">
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={cn(
                    "flex items-center justify-between pt-6 border-t border-slate-100",
                    view === 'list' && "border-t-0 pt-0"
                  )}>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Clock size={14} />
                        <span className="text-[10px] font-black uppercase">
                          {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <MessageSquare size={14} />
                        <span className="text-[10px] font-black uppercase">
                          -
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="text-slate-300 group-hover:text-indigo-600 transition-all transform group-hover:translate-x-1" size={20} />
                  </div>
                </motion.div>
              ))}
            </div>

            {filteredTickets.length > visibleCount && (
              <div className="text-center py-8">
                <button 
                  onClick={() => setVisibleCount(prev => prev + 12)}
                  className="bg-white border border-slate-200 text-slate-600 px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-md group active:scale-95"
                >
                  Carregar mais chamados <span className="text-indigo-400 group-hover:text-indigo-600 ml-1">({filteredTickets.length - visibleCount})</span>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-20 text-center animate-in fade-in duration-700">
            <div className="w-24 h-24 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 text-slate-300">
               <TicketIcon size={48} />
            </div>
            <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-2">Sem chamados por aqui</h3>
            <p className="text-slate-400 font-medium mb-8">Nenhum chamado corresponde aos filtros selecionados ou você ainda não abriu solicitações.</p>
            <button 
              onClick={() => setIsNewTicketModalOpen(true)}
              className="inline-flex items-center gap-3 bg-slate-900 text-white px-10 py-5 rounded-3xl text-sm font-black uppercase tracking-widest hover:bg-indigo-600 transition-all shadow-xl hover:shadow-indigo-100"
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
