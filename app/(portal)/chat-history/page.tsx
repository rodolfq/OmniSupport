'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { useApp } from '@/app/app-context';
import { UserRole, Permission } from '@/lib/types';
import { getChatHistories } from '@/lib/services/chat-service';
import { fetchUsers } from '@/lib/services/config-service';
import { Search, Calendar, Clock, User, MessageSquare, ThumbsUp, ThumbsDown, Filter, History, Users, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ChatHistoryPage() {
  const { currentUser, hasPermission, refreshTrigger } = useApp();
  const [histories, setHistories] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'liked' | 'disliked'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [customerFilter, setCustomerFilter] = useState<string>('all');

  useEffect(() => {
    if (!currentUser || !hasPermission(Permission.TICKETS_READ)) return;
    
    getChatHistories()
      .then(setHistories)
      .catch(err => console.error('Error loading chat histories:', err));
      
    fetchUsers().then(setUsers).catch(() => {});
  }, [currentUser?.id, refreshTrigger]);

  const filteredHistories = useMemo(() => {
    return histories.filter(h => {
      // Search filter
      const matchesSearch = search === '' || 
        h.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        h.transcript?.toLowerCase().includes(search.toLowerCase()) ||
        h.sessionId?.toLowerCase().includes(search.toLowerCase()) ||
        h.assigneeName?.toLowerCase().includes(search.toLowerCase());
      
      // Date filter
      let matchesDate = true;
      if (dateFilter !== 'all') {
        const finished = new Date(h.finishedAt);
        const now = new Date();
        const diffDays = (now.getTime() - finished.getTime()) / (1000 * 60 * 60 * 24);
        
        if (dateFilter === 'today') matchesDate = diffDays < 1;
        else if (dateFilter === 'week') matchesDate = diffDays < 7;
        else if (dateFilter === 'month') matchesDate = diffDays < 30;
      }
      
      // Rating filter
      let matchesRating = true;
      if (ratingFilter === 'liked') matchesRating = h.rating === 1;
      else if (ratingFilter === 'disliked') matchesRating = h.rating === -1;
      
      // Agent filter
      const matchesAgent = agentFilter === 'all' || h.assigneeId === agentFilter;
      
      // Customer filter
      const matchesCustomer = customerFilter === 'all' || h.customerId === customerFilter;
      
      return matchesSearch && matchesDate && matchesRating && matchesAgent && matchesCustomer;
    });
  }, [histories, search, dateFilter, ratingFilter, agentFilter, customerFilter]);

  if (!currentUser || ![UserRole.ADMIN, UserRole.SUPPORT].includes(currentUser.role as UserRole)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-tertiary)]">Acesso negado</p>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-[var(--text-primary)] uppercase tracking-tight">Histórico de Conversas</h2>
          <p className="text-[var(--text-tertiary)] font-medium mt-1">Acesse todas as conversas finalizadas</p>
        </div>
      </div>

{/* Filters */}
       <div className="flex flex-col md:flex-row gap-4">
         <div className="relative flex-1">
           <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={18} />
           <input 
             type="text" 
             placeholder="Buscar por cliente, agente ou conteúdo..." 
             value={search}
             onChange={e => setSearch(e.target.value)}
             className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl py-3 pl-12 pr-4 text-sm font-bold focus:ring-4 focus:ring-[var(--accent)]/10 outline-none"
           />
         </div>

         {/* Handler Filter (Agent/Employee) */}
         <div className="relative">
           <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
           <StyledSelect 
             value={agentFilter}
             onChange={e => setAgentFilter(e.target.value)}
             className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
           >
             <option value="all">Todos Agentes/Funcionários</option>
             <optgroup label="Agentes">
               {users.filter(u => [UserRole.ADMIN, UserRole.SUPPORT].includes(u.role as UserRole)).map(u => (
                 <option key={u.id} value={u.id}>{u.name || u.email}</option>
               ))}
             </optgroup>
             <optgroup label="Funcionários">
               {users.filter(u => u.role === UserRole.EMPLOYEE).map(u => (
                 <option key={u.id} value={u.id}>{u.name || u.email}</option>
               ))}
             </optgroup>
           </StyledSelect>
           <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
         </div>

         {/* Customer Filter */}
         <div className="relative">
           <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
           <StyledSelect 
             value={customerFilter}
             onChange={e => setCustomerFilter(e.target.value)}
             className="pl-9 pr-8 py-2 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10 appearance-none cursor-pointer"
           >
             <option value="all">Todos Clientes</option>
             {users.filter(u => u.role === UserRole.CUSTOMER).map(u => (
               <option key={u.id} value={u.id}>{u.name || u.email}</option>
             ))}
           </StyledSelect>
           <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
         </div>

         <div className="flex items-center gap-2">
           {[
             { value: 'all', label: 'Tudo' },
             { value: 'today', label: 'Hoje' },
             { value: 'week', label: '7 dias' },
             { value: 'month', label: '30 dias' }
           ].map(opt => (
             <button 
               key={opt.value}
               onClick={() => setDateFilter(opt.value as any)}
               className={cn(
                 "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                 dateFilter === opt.value ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
               )}
             >
               {opt.label}
             </button>
           ))}
         </div>

         <div className="flex items-center gap-2">
           <Filter size={16} className="text-[var(--text-tertiary)]" />
           {[
             { value: 'all', label: 'Todos' },
             { value: 'liked', label: 'Curtidos' },
             { value: 'disliked', label: 'Não curtidos' }
           ].map(opt => (
             <button 
               key={opt.value}
               onClick={() => setRatingFilter(opt.value as any)}
               className={cn(
                 "px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all",
                 ratingFilter === opt.value ? "bg-[var(--text-success)] text-white" : "bg-[var(--surface-pill)] text-[var(--text-secondary)] hover:bg-[var(--border-default)]"
               )}
             >
               {opt.label}
             </button>
           ))}
         </div>
       </div>

{/* Histories List */}
       <div className="space-y-4">
         {filteredHistories.length === 0 ? (
           <div className="text-center py-20">
             <MessageSquare className="mx-auto text-slate-300 mb-4" size={48} />
             <p className="text-[var(--text-tertiary)] font-medium">Nenhuma conversa encontrada</p>
           </div>
         ) : filteredHistories.map(h => (
           <div key={h.id} className="bg-[var(--surface-card)] rounded-2xl p-6 border border-[var(--border-default)] shadow-sm hover:shadow-md transition-shadow">
             <div className="flex items-start justify-between mb-4">
               <div>
                 <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">{h.customerName || 'Cliente'}</h3>
                 <p className="text-xs text-[var(--text-tertiary)]">{h.customerPhone || 'Sem telefone'}</p>
                 {h.assigneeName && (
<p className="text-[10px] text-[var(--accent-text)] font-medium mt-1">
                    {h.assigneeName ? `Responsável: ${h.assigneeName}` : 'Sem responsável'}
                  </p>
                 )}
               </div>
               <div className="flex items-center gap-2">
                 {h.rating === 1 && <ThumbsUp className="text-[var(--text-success)]" size={20} />}
                 {h.rating === -1 && <ThumbsDown className="text-[var(--text-danger)]" size={20} />}
                 <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
                   {new Date(h.finishedAt).toLocaleDateString('pt-BR')}
                 </span>
               </div>
             </div>

            <div className="grid grid-cols-3 gap-4 mb-4 text-xs">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-[var(--text-tertiary)]" />
                <span className="font-medium">Duração: {formatDuration(h.durationSeconds)}</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-[var(--text-tertiary)]" />
                <span className="font-medium">1ª resposta: {formatDuration(h.firstResponseSeconds) || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-[var(--text-tertiary)]" />
                <span className="font-medium">Início: {new Date(h.startedAt).toLocaleTimeString('pt-BR')}</span>
              </div>
            </div>

            <div className="bg-[var(--surface-card)] rounded-xl p-4 max-h-48 overflow-y-auto">
              <pre className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap font-mono">{h.transcript}</pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
