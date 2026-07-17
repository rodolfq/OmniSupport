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
          <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Visão Geral</h2>
          <p className="text-[var(--text-tertiary)] font-medium">Controle de fluxo e produtividade em tempo real</p>
        </div>
        <div className="flex gap-4">
          {loading && (
            <div className="flex items-center gap-2 bg-[var(--surface-pill)] px-4 py-2 rounded-xl text-[var(--text-tertiary)] animate-pulse">
               <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
               <span className="text-[10px] font-semibold uppercase tracking-widest">Sincronizando...</span>
            </div>
          )}
          {stats.unassigned > 0 && !loading && (
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
          <button
            onClick={() => setIsNewTicketModalOpen(true)}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-all flex items-center gap-2 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
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
        "grid gap-6 flex-1 min-h-[600px] overflow-x-auto pb-4 scrollbar-thin",
        columns.length <= 4 ? "md:grid-cols-4" : "md:grid-cols-5"
      )} style={{ minWidth: columns.length * 280 }}>
        {columns.map(col => {
          const colTickets = groupedTickets[col.status] || [];
          const displayTickets = colTickets.slice(0, 20); // Only render first 20 for performance
          const hasMore = colTickets.length > 20;

          return (
            <div key={col.status} className="flex flex-col gap-4 min-w-[280px]">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{col.title}</h3>
                <span className="bg-[var(--border-default)] text-[var(--text-secondary)] text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {colTickets.length}
                </span>
              </div>
              <div className="flex-1 bg-[var(--surface-pill)]/50 rounded-2xl p-4 space-y-4 border border-dashed border-[var(--border-default)]">
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
                      <div className="w-4 h-4 rounded bg-[var(--accent)]/15 flex items-center justify-center text-[7px] font-semibold text-[var(--accent-text)] uppercase">
                        {assignee.name.charAt(0)}
                      </div>
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
               <div className="w-6 h-6 rounded-lg bg-[var(--accent)] flex items-center justify-center font-semibold text-white text-[9px] uppercase shadow-sm" title={assignee.name}>
                 {assignee.name.charAt(0)}
               </div>
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

