'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Ticket as TicketType, TicketStatus, UserRole, TicketPriority } from '@/lib/types';
import { fetchAllTickets } from '@/lib/tickets';
import { isClosedTicketStatus, isInProgressTicketStatus } from '@/lib/ticket-status';
import { fetchPriorities, fetchStatuses, fetchUsers } from '@/lib/services/config-service';
import { useApp } from '@/app/app-context';
import { Plus, Clock, AlertCircle, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { TicketDetailModal } from '@/components/ticket-detail-modal';
import { FilterBar } from '@/components/filter-bar';
import { useSearchParams, useRouter } from 'next/navigation';

export default function DashboardPage() {
  const router = useRouter();
  const [allTickets, setAllTickets] = useState<TicketType[]>([]);
  const [filteredTickets, setFilteredTickets] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser, setIsNewTicketModalOpen, refreshTrigger } = useApp();
  const searchParams = useSearchParams();

  const [priorities, setPriorities] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    
    async function loadData() {
      if ([UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole)) {
        router.push('/my-tickets');
        return;
      }
      
      setLoading(true);
      try {
        // O AppContext já lida com o sync inicial.
        
        if (controller.signal.aborted) return;

        const [loadedTickets, loadedPriorities, loadedStatuses, loadedUsers] = await Promise.all([
          fetchAllTickets(controller.signal),
          fetchPriorities(controller.signal),
          fetchStatuses(controller.signal),
          fetchUsers(controller.signal)
        ]);
        
        let tickets = loadedTickets;
        
        if ([UserRole.CUSTOMER, UserRole.EMPLOYEE].includes(currentUser?.role as UserRole)) {
          tickets = tickets.filter(t => t.companyId === currentUser.companyId);
        }
        
        setAllTickets(tickets);
        setFilteredTickets(tickets);
        setPriorities(loadedPriorities || []);
        setStatuses(loadedStatuses || []);
        setUsers(loadedUsers || []);
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
  }, [searchParams, currentUser?.id, currentUser?.role, refreshTrigger, router]);

  const columns = useMemo(() => statuses
    .filter(s => !isClosedTicketStatus(s.label))
    .map(s => ({
      title: s.label,
      status: s.label
    })), [statuses]);

  // ... (rest of component remains same)

  const stats = useMemo(() => {
    const total = filteredTickets.length;
    const now = new Date();
    
    // Alertas críticos sempre usam todos os chamados
    const unassigned = allTickets.filter(t => t.status === TicketStatus.NEW && !t.assigneeId).length;
    const allActive = allTickets.filter(t => !isClosedTicketStatus(t.status));
    
    const overdue = allActive.filter(t => {
      const config = priorities.find(p => p.label === t.priority);
      if (!config || !config.sla_hours) return false;
      const limit = new Date(new Date(t.createdAt).getTime() + config.sla_hours * 60 * 60 * 1000);
      return limit < now;
    }).length;

    const nearExpiry = allActive.filter(t => {
      const config = priorities.find(p => p.label === t.priority);
      if (!config || !config.sla_hours) return false;
      const limit = new Date(new Date(t.createdAt).getTime() + config.sla_hours * 60 * 60 * 1000);
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
    statuses.forEach(s => {
      groups[s.label] = filteredTickets.filter(t => t.status === s.label);
    });
    return groups;
  }, [filteredTickets, statuses]);

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">Visão Geral</h2>
          <p className="text-slate-500 font-medium">Controle de fluxo e produtividade em tempo real</p>
        </div>
        <div className="flex gap-4">
          {loading && (
            <div className="flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-xl text-slate-500 animate-pulse">
               <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
               <span className="text-[10px] font-black uppercase tracking-widest">Sincronizando...</span>
            </div>
          )}
          {stats.unassigned > 0 && !loading && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 px-4 py-2 rounded-xl text-red-800 animate-pulse whitespace-nowrap">
               <AlertCircle size={18} />
               <span className="text-[10px] font-black uppercase tracking-widest">{stats.unassigned} Novos Sem Analista</span>
            </div>
          )}
          {stats.overdue > 0 && (
            <div className="flex items-center gap-2 bg-rose-600 px-4 py-2 rounded-xl text-white whitespace-nowrap shadow-md">
               <span className="text-[10px] font-black uppercase tracking-widest">{stats.overdue} Vencidos</span>
            </div>
          )}
          <button 
            onClick={() => setIsNewTicketModalOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow-md transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <Plus size={18} />
            Novo Chamado
          </button>
        </div>
      </div>

      <FilterBar 
        originalTickets={allTickets} 
        onFilterChange={(filtered) => setFilteredTickets(filtered)} 
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard 
          label="Total em Aberto" 
          value={filteredTickets.filter(t => !isClosedTicketStatus(t.status)).length} 
          color="bg-indigo-600" 
          textColor="text-white"
          icon={<AlertCircle size={14} />}
          highlight 
        />
        <StatCard 
          label="SLA Vencido" 
          value={stats.overdue} 
          color={stats.overdue > 0 ? "bg-rose-50 border-rose-200" : "bg-white"}
          textColor="text-rose-600"
          icon={<AlertCircle size={14} className="text-rose-500" />}
          pulse={stats.overdue > 0}
        />
        <StatCard 
          label="Próximos do Vencimento" 
          value={stats.nearExpiry} 
          color={stats.nearExpiry > 0 ? "bg-orange-50 border-orange-200" : "bg-white"}
          textColor="text-orange-600"
          icon={<Clock size={14} className="text-orange-500" />}
        />
        <StatCard 
          label="Novos Sem Analista" 
          value={stats.unassigned} 
          color={stats.unassigned > 0 ? "bg-amber-50 border-amber-200" : "bg-white"}
          textColor="text-amber-600"
          icon={<User size={14} className="text-amber-500" />}
        />
      </div>

      {/* Seção de Chamados Prioritários */}
      {(stats.overdue > 0 || stats.nearExpiry > 0 || stats.unassigned > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-2">
             <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
             <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Chamados Prioritários</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Lista de Vencidos */}
            <PriorityList 
              title="SLA Vencido" 
              tickets={allTickets.filter(t => {
                const config = priorities.find(p => p.label === t.priority);
                if (!config || !config.sla_hours || isClosedTicketStatus(t.status)) return false;
                const limit = new Date(new Date(t.createdAt).getTime() + config.sla_hours * 60 * 60 * 1000);
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
                const limit = new Date(new Date(t.createdAt).getTime() + config.sla_hours * 60 * 60 * 1000);
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

      <div className={cn(
        "grid gap-6 flex-1 min-h-[600px] overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-slate-200",
        columns.length <= 4 ? "md:grid-cols-4" : "md:grid-cols-5"
      )} style={{ minWidth: columns.length * 280 }}>
        {columns.map(col => {
          const colTickets = groupedTickets[col.status] || [];
          const displayTickets = colTickets.slice(0, 20); // Only render first 20 for performance
          const hasMore = colTickets.length > 20;

          return (
            <div key={col.status} className="flex flex-col gap-4 min-w-[280px]">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{col.title}</h3>
                <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {colTickets.length}
                </span>
              </div>
              <div className="flex-1 bg-slate-100/50 rounded-2xl p-4 space-y-4 border border-dashed border-slate-300">
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
                    className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors bg-white/50 rounded-xl border border-dashed border-slate-300"
                  >
                    Ver mais {colTickets.length - 20} chamados
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
    rose: "bg-rose-50 border-rose-100",
    orange: "bg-orange-50 border-orange-100",
    amber: "bg-amber-50 border-amber-100"
  };

  const textColors = {
    rose: "text-rose-600",
    orange: "text-orange-600",
    amber: "text-amber-600"
  };

  const bulletColors = {
    rose: "bg-rose-500",
    orange: "bg-orange-500",
    amber: "bg-amber-500"
  };

  return (
    <div className={cn("p-4 rounded-2xl border border-dashed flex flex-col gap-3", bgColors[color])}>
      <div className="flex items-center justify-between">
        <h4 className={cn("text-[10px] font-black uppercase tracking-wider flex items-center gap-2", textColors[color])}>
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
              className="group cursor-pointer bg-white/80 backdrop-blur-sm p-3 rounded-xl border border-white hover:border-slate-200 transition-all flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <h5 className="text-xs font-bold text-slate-700 truncate group-hover:text-indigo-600 transition-colors">
                  {t.title}
                </h5>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">#{t.ticketNumber ? String(t.ticketNumber).padStart(4, '0') : t.id.slice(0, 8)}</span>
                  <span className="text-[9px] text-slate-400">•</span>
                  {assignee ? (
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded bg-indigo-100 flex items-center justify-center text-[7px] font-black text-indigo-600 uppercase">
                        {assignee.name.charAt(0)}
                      </div>
                      <span className="text-[9px] text-slate-500 font-bold truncate max-w-[80px]">{assignee.name.split(' ')[0]}</span>
                    </div>
                  ) : (
                    <span className="text-[9px] text-amber-500 font-black uppercase tracking-tighter">Não atribuído</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                 <div className={cn(
                   "text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-tighter",
                   priorities.find(p => p.label === t.priority)?.color || "bg-slate-100 text-slate-600"
                 )}>
                   {t.priority}
                 </div>
              </div>
            </div>
          );
        })}
        {tickets.length > 5 && (
          <button className="w-full py-1 text-[9px] font-black uppercase text-slate-400 hover:text-indigo-600">
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
      <div className={cn(color, "p-6 rounded-2xl text-white shadow-lg shadow-indigo-100 flex flex-col justify-between")}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] opacity-70 uppercase font-black tracking-widest">{label}</p>
          {icon}
        </div>
        <p className="text-3xl font-black">{value}</p>
      </div>
    );
  }
  return (
    <div className={cn(
      "p-6 rounded-2xl border transition-all duration-500 flex flex-col justify-between",
      color,
      !color.includes('border') && "border-slate-200 shadow-sm",
      pulse && "animate-[pulse_2s_infinite]"
    )}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
        <div className="opacity-50">{icon}</div>
      </div>
      <p className={cn("text-3xl font-black", textColor || "text-slate-800")}>{value}</p>
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
    return new Date(new Date(ticket.createdAt).getTime() + priorityConfig.sla_hours * 60 * 60 * 1000);
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
        "bg-white p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md active:scale-[0.98] shadow-sm relative overflow-hidden group",
        isUnassignedNew 
          ? "border-amber-200 bg-amber-50/10" 
          : isOverdue
            ? "border-rose-200 bg-rose-50/10"
            : isNear
              ? "border-orange-200 bg-orange-50/10"
              : "border-slate-200 hover:border-indigo-300"
      )}
    >
      {/* Indicador lateral de status */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1",
        isOverdue ? "bg-rose-500" : isNear ? "bg-orange-500" : isUnassignedNew ? "bg-amber-500" : "bg-transparent"
      )} />

      {isOverdue && <div className="absolute top-0 right-0 bg-rose-600 text-white text-[8px] font-black px-2 py-0.5 rounded-bl uppercase tracking-tighter">SLA Vencido</div>}
      {isNear && <div className="absolute top-0 right-0 bg-orange-500 text-white text-[8px] font-black px-2 py-0.5 rounded-bl uppercase tracking-tighter">Expira logo</div>}
      {isUnassignedNew && <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-black px-2 py-0.5 rounded-bl uppercase tracking-tighter">Sem Analista</div>}
      
      <div className="flex items-start justify-between mb-3">
        <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-md uppercase", priorityConfig?.color || 'bg-slate-100 text-slate-600')}>
          {ticket.priority}
        </span>
        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">#{ticket.ticketNumber ? String(ticket.ticketNumber).padStart(4, '0') : ticket.id.slice(0, 8)}</span>
      </div>
      <h3 className="font-bold text-sm text-slate-800 mb-1 line-clamp-2 leading-tight">{ticket.title}</h3>
      
      {slaLimit && !isClosedTicketStatus(ticket.status) && (
        <div className={cn(
          "text-[9px] font-black uppercase mb-3 flex items-center gap-1",
          isOverdue ? "text-red-600" : isNear ? "text-orange-600" : "text-slate-400"
        )}>
          <Clock size={10} />
          Vence {formatDate(slaLimit)}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-2 text-[10px] text-slate-400 font-bold">
        <div className="flex items-center gap-1.5" title="Criado em">
          <div className="w-1 h-1 rounded-full bg-slate-300" />
          {new Date(ticket.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' })}
        </div>
        <div className="flex items-center gap-2">
           {assignee ? (
             <div className="flex items-center gap-2">
               <span className="text-[9px] text-slate-500 font-bold truncate max-w-[60px] hidden sm:inline">{assignee.name.split(' ')[0]}</span>
               <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-white text-[9px] uppercase shadow-sm" title={assignee.name}>
                 {assignee.name.charAt(0)}
               </div>
             </div>
           ) : (
             <div className={cn(
               "w-6 h-6 rounded-lg flex items-center justify-center border",
               isUnassignedNew ? "bg-amber-50 border-amber-200" : "bg-slate-100 border-slate-200"
             )} title="Sem Analista">
               <User size={10} className={isUnassignedNew ? "text-amber-500" : "text-slate-400"} />
             </div>
           )}
        </div>
      </div>
    </motion.div>
  );
}

