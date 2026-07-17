'use client';

import React, { useState, useEffect } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { Clock, Info, AlertCircle, CheckCircle2, Coffee, Users, Filter, Plus, Trash2 } from 'lucide-react';
import { UserStatusHistory, User } from '@/lib/types';
import { AbsenceReasonService, UserStatusHistoryService } from '@/lib/services/chat-service';
import { UserService } from '@/lib/services/user-service';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface StatusHistoryPanelProps {
  userId: string;
}

export function StatusHistoryPanel({ userId }: StatusHistoryPanelProps) {
  const { currentUser, absenceReasons, refreshAbsenceReasons } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;
  
  const [history, setHistory] = useState<UserStatusHistory[]>([]);
  const [profiles, setProfiles] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(userId);
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'month' | 'year' | 'specific'>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [newReason, setNewReason] = useState('');

  const [stats, setStats] = useState({
    online: 0,
    away: 0,
    offline: 0
  });

useEffect(() => {
     const loadProfiles = async () => {
       if (isAdmin) {
         setProfiles(await UserService.getAllUsers());
       }
     };
     loadProfiles();
   }, [isAdmin]);

useEffect(() => {
     const loadHistory = async () => {
       const allHistory = await UserStatusHistoryService.getAll();
       let targetHistory = isAdmin && selectedUserId === 'all' 
         ? allHistory 
         : allHistory.filter(h => h.userId === (selectedUserId === 'all' ? h.userId : selectedUserId));
      
      // Apply period filter
      const now = new Date();
      if (periodFilter === 'today') {
        const todayStr = format(now, 'yyyy-MM-dd');
        targetHistory = targetHistory.filter(h => format(new Date(h.timestamp), 'yyyy-MM-dd') === todayStr);
      } else if (periodFilter === 'month') {
        const monthStr = format(now, 'yyyy-MM');
        targetHistory = targetHistory.filter(h => format(new Date(h.timestamp), 'yyyy-MM') === monthStr);
      } else if (periodFilter === 'year') {
        const yearStr = format(now, 'yyyy');
        targetHistory = targetHistory.filter(h => format(new Date(h.timestamp), 'yyyy') === yearStr);
      } else if (periodFilter === 'specific' && selectedDate) {
        targetHistory = targetHistory.filter(h => format(new Date(h.timestamp), 'yyyy-MM-dd') === selectedDate);
      }

      const sortedHistory = [...targetHistory].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setHistory(sortedHistory);

      const totalStats = sortedHistory.reduce((acc, curr) => {
        const duration = curr.duration || 0;
        if (curr.status === 'online') acc.online += duration;
        else if (curr.status === 'away') acc.away += duration;
        else if (curr.status === 'offline') acc.offline += duration;
        return acc;
      }, { online: 0, away: 0, offline: 0 });

      setStats(totalStats);
    };

    loadHistory();
  }, [selectedUserId, isAdmin, periodFilter, selectedDate]);

  const handleAddReason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReason.trim()) return;
    
    try {
      await AbsenceReasonService.save({ label: newReason.trim() });
      await refreshAbsenceReasons();
      setNewReason('');
      toast.success('Motivo de ausência adicionado com sucesso!');
    } catch {
      toast.error('Erro ao adicionar motivo.');
    }
  };

  const handleDeleteReason = async (id: string) => {
    try {
      await AbsenceReasonService.delete(id);
      await refreshAbsenceReasons();
      toast.success('Motivo removido.');
    } catch {
      toast.error('Erro ao remover motivo.');
    }
  };

  const getUserName = (id: string) => {
    const user = profiles.find(p => p.id === id);
    return user ? user.name : 'Unknown User';
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return `${mins}m ${secs}s`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  const getStatusIcon = (status: string, reason?: string) => {
    if (status === 'online') return <CheckCircle2 className="text-[var(--text-success)]" size={16} />;
    if (status === 'offline') return <AlertCircle className="text-[var(--text-tertiary)]" size={16} />;

    if (reason === 'Almoço') return <Coffee className="text-[var(--text-warning-strong)]" size={16} />;
    if (reason === 'Reunião') return <Users className="text-[var(--text-warning-strong)]" size={16} />;
    return <Info className="text-[var(--text-warning-strong)]" size={16} />;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header com Filtro para Admin */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--surface-card)] p-6 border border-[var(--border-default)] rounded-[2rem] shadow-sm">
        <div>
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Análise de Tempo e Presença</h2>
          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
            {isAdmin ? 'Gestão completa de disponibilidade e motivos' : 'Seu Histórico pessoal de disponibilidade'}
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[var(--text-tertiary)]" />
              <StyledSelect
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-xs font-bold text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition-all"
              >
                <option value="all">Todos os Analistas</option>
                {profiles.filter(p => p.role !== UserRole.CUSTOMER).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </StyledSelect>
            </div>

            <div className="flex items-center gap-2">
              <StyledSelect
                value={periodFilter}
                onChange={(e: any) => setPeriodFilter(e.target.value)}
                className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-xs font-bold text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition-all"
              >
                <option value="all">Todo o Período</option>
                <option value="today">Hoje</option>
                <option value="month">Este Mês</option>
                <option value="year">Este Ano</option>
                <option value="specific">Data Específica</option>
              </StyledSelect>

              {periodFilter === 'specific' && (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-1.5 text-xs font-bold text-[var(--text-secondary)] outline-none"
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Tempo Online" value={formatDuration(stats.online)} color="emerald" icon={<CheckCircle2 size={20} />} />
        <StatCard label="Tempo em Ausência" value={formatDuration(stats.away)} color="amber" icon={<Clock size={20} />} />
        <StatCard label="Tempo Offline" value={formatDuration(stats.offline)} color="slate" icon={<AlertCircle size={20} />} />
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Gestão de Motivos */}
          <div className="lg:col-span-1 space-y-4">
             <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] overflow-hidden shadow-sm h-full">
                <div className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--surface-card)]/50">
                  <h3 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight">Motivos de Ausência</h3>
                </div>
                <div className="p-6 space-y-4">
                  <form onSubmit={handleAddReason} className="flex gap-2">
                    <input
                      type="text"
                      value={newReason}
                      onChange={(e) => setNewReason(e.target.value)}
                      placeholder="Novo motivo..."
                      className="flex-1 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition-all"
                    />
                    <button type="submit" className="w-10 h-10 bg-[var(--accent)] text-white rounded-xl hover:bg-[var(--accent-hover)] transition-all shadow-md shrink-0 flex items-center justify-center">
                      <Plus size={20} />
                    </button>
                  </form>

                  <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 -mr-1 custom-scrollbar">
                    {absenceReasons.length === 0 ? (
                      <div className="text-center py-6 text-[var(--text-tertiary)]">
                        <p className="text-[10px] font-semibold uppercase tracking-widest italic">Nenhum motivo criado</p>
                      </div>
                    ) : (
                      absenceReasons.map(reason => (
                        <div key={reason.id} className="flex items-center justify-between p-3 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl group transition-all hover:bg-[var(--surface-card)] hover:border-[var(--border-default)]">
                          <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-tight truncate pr-2 flex-1 min-w-0">{reason.label}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDeleteReason(reason.id);
                            }}
                            className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] rounded-lg transition-all shrink-0 ml-2"
                            title="Remover motivo"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
             </div>
          </div>

          {/* Histórico Detalhado */}
          <div className="lg:col-span-2">
            <HistoryList 
              history={history} 
              isAdmin={isAdmin} 
              getUserName={getUserName} 
              getStatusIcon={getStatusIcon} 
              formatDuration={formatDuration} 
            />
          </div>
        </div>
      )}

      {!isAdmin && (
        <HistoryList 
          history={history} 
          isAdmin={isAdmin} 
          getUserName={getUserName} 
          getStatusIcon={getStatusIcon} 
          formatDuration={formatDuration} 
        />
      )}
    </div>
  );
}

function HistoryList({ history, isAdmin, getUserName, getStatusIcon, formatDuration }: any) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] overflow-hidden shadow-sm">
      <div className="px-8 py-6 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-card)]/50">
        <div>
          <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">Registro de Atividade</h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">Fluxo temporal de disponibilidade</p>
        </div>
        <div className="p-2 bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] text-[var(--text-tertiary)]">
           <Clock size={20} />
        </div>
      </div>

      <div className="divide-y divide-[var(--border-default)] max-h-[600px] overflow-y-auto custom-scrollbar">
        {history.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[var(--text-tertiary)] font-medium italic">Nenhum registro encontrado.</p>
          </div>
        ) : (
          history.map((entry: any) => (
            <div key={entry.id} className="px-8 py-4 flex items-center justify-between hover:bg-[var(--surface-card)]/50 transition-all group">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center transition-all shadow-sm",
                  entry.status === 'online' ? "bg-[var(--surface-success)] text-[var(--text-success)] group-hover:bg-[var(--surface-success)]" :
                  entry.status === 'away' ? "bg-[var(--surface-warning)] text-[var(--text-warning)] group-hover:bg-[var(--surface-warning)]" :
                  "bg-[var(--surface-card)] text-[var(--text-tertiary)] group-hover:bg-[var(--surface-pill)]"
                )}>
                  {getStatusIcon(entry.status, entry.reason)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <span className="text-[10px] font-semibold text-[var(--accent-text)] uppercase bg-[var(--accent)]/10 px-2 py-0.5 rounded-lg border border-[var(--accent)]/20">
                        {getUserName(entry.userId)}
                      </span>
                    )}
                    <span className={cn(
                      "text-[10px] font-semibold uppercase tracking-widest",
                      entry.status === 'online' ? "text-[var(--text-success)]" :
                      entry.status === 'away' ? "text-[var(--text-warning)]" :
                      "text-[var(--text-tertiary)]"
                    )}>
                      {entry.status === 'online' ? 'Disponível' :
                       entry.status === 'away' ? 'Ausente' : 'Offline'}
                    </span>
                    {entry.reason && (
                      <span className="text-[10px] font-bold text-[var(--text-tertiary)] italic">
                        {">"} {entry.reason}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5">
                    {format(new Date(entry.timestamp), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </p>
                </div>
              </div>

              <div className="text-right">
                {entry.duration ? (
                  <div className="flex flex-col items-end">
                     <span className="text-xs font-black text-[var(--text-secondary)] tracking-tight">{formatDuration(entry.duration)}</span>
                     <span className="text-[8px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest leading-none">Investido</span>
                  </div>
                ) : (
                  <span className="text-[9px] font-semibold uppercase text-[var(--text-success)] bg-[var(--surface-success)] px-2 py-1 rounded-full border border-[var(--text-success)]/20 tracking-widest animate-pulse">
                    Ativo Agora
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: 'emerald' | 'amber' | 'slate'; icon: React.ReactNode }) {
  const colors = {
    emerald: "bg-[var(--surface-success)] border-[var(--text-success)]/20 text-[var(--text-success)]",
    amber: "bg-[var(--surface-warning)] border-[var(--border-alert)] text-[var(--text-warning)]",
    slate: "bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)]"
  };

  const iconColors = {
    emerald: "bg-[var(--text-success)] text-white",
    amber: "bg-[var(--accent-warning-hover)] text-white",
    slate: "bg-slate-600 text-white"
  };

  return (
    <div className={cn("p-6 rounded-[2rem] border shadow-sm flex items-center gap-4 transition-all hover:scale-[1.02] hover:shadow-md", colors[color])}>
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg", iconColors[color])}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest opacity-70 mb-0.5">{label}</p>
        <p className="text-xl font-black tracking-tight leading-tight">{value}</p>
      </div>
    </div>
  );
}



