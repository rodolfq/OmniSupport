'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { StyledSelect } from '@/components/styled-select';
import { UserAvatar } from '@/components/user-avatar';
import { Clock, Info, AlertCircle, CheckCircle2, Coffee, Users, Filter, Plus, Trash2, ArrowRight } from 'lucide-react';
import { UserStatusHistory, User } from '@/lib/types';
import { AbsenceReasonService, UserStatusHistoryService } from '@/lib/services/chat-service';
import { useProfilesLiteQuery } from '@/lib/query-hooks';
import { useApp } from '@/app/app-context';
import { UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

interface StatusHistoryPanelProps {
  userId: string;
}

type StatusValue = 'online' | 'away' | 'offline';

// Um "turno" é uma sequência contínua de linhas de user_status_history com o
// mesmo status+motivo — o heartbeat de 60s grava uma linha nova mesmo sem
// nenhuma troca real, então olhar linha a linha "floodava" a tela (uma
// pessoa online por 3h virava ~180 linhas idênticas). Aqui a granularidade
// exibida passa a ser "das 09:12 às 12:40, Online", não cada heartbeat.
interface StatusTurn {
  id: string;
  userId: string;
  status: StatusValue;
  reason?: string;
  start: string;
  end: string | null; // null enquanto isCurrent
  isCurrent: boolean;
}

function getPeriodRange(periodFilter: string, selectedDate: string): { from?: Date; to?: Date } {
  const now = new Date();
  if (periodFilter === 'today') {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  if (periodFilter === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to };
  }
  if (periodFilter === 'year') {
    const from = new Date(now.getFullYear(), 0, 1);
    const to = new Date(now.getFullYear() + 1, 0, 1);
    return { from, to };
  }
  if (periodFilter === 'specific' && selectedDate) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const from = new Date(y, m - 1, d);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }
  return {};
}

// Agrupa o histórico bruto (já ordenado por usuário) em turnos contínuos.
// periodEndBoundary decide o que significa "o último turno de cada pessoa":
// só é tratado como "em andamento" (isCurrent, com relógio ao vivo) quando o
// período filtrado realmente alcança o presente — filtrando um mês passado,
// o último registro daquele mês não está "ativo agora", só terminou onde os
// dados acabam.
function buildTurns(history: UserStatusHistory[], periodEndBoundary: Date, now: Date): StatusTurn[] {
  const byUser = new Map<string, UserStatusHistory[]>();
  for (const h of history) {
    if (!byUser.has(h.userId)) byUser.set(h.userId, []);
    byUser.get(h.userId)!.push(h);
  }

  const boundaryIsNow = periodEndBoundary.getTime() >= now.getTime() - 60_000;

  const turns: StatusTurn[] = [];
  for (const [uid, rows] of byUser) {
    const sorted = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let open: StatusTurn | null = null;
    for (const row of sorted) {
      const sameTurn = open && open.status === row.status && (open.reason || '') === (row.reason || '');
      if (sameTurn) continue;
      if (open) {
        open.end = row.timestamp;
        turns.push(open);
      }
      open = { id: `${uid}:${row.timestamp}`, userId: uid, status: row.status as StatusValue, reason: row.reason, start: row.timestamp, end: null, isCurrent: false };
    }
    if (open) {
      if (boundaryIsNow) {
        open.isCurrent = true;
      } else {
        open.end = periodEndBoundary.toISOString();
      }
      turns.push(open);
    }
  }
  return turns;
}

function turnDurationSeconds(turn: StatusTurn, now: Date): number {
  const start = new Date(turn.start).getTime();
  const end = turn.isCurrent ? now.getTime() : new Date(turn.end!).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

const STATUS_LABELS: Record<StatusValue, string> = { online: 'Disponível', away: 'Ausente', offline: 'Offline' };

export function StatusHistoryPanel({ userId }: StatusHistoryPanelProps) {
  const { currentUser, absenceReasons, refreshAbsenceReasons } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [history, setHistory] = useState<UserStatusHistory[]>([]);
  // Só usado no <select> de filtro por nome/papel (sem avatar) — via hook
  // compartilhado "lite", habilitado só para quem realmente usa (isAdmin).
  const { data: profilesLiteData } = useProfilesLiteQuery({ enabled: isAdmin });
  const profiles = useMemo(() => (profilesLiteData || []) as User[], [profilesLiteData]);
  const [selectedUserId, setSelectedUserId] = useState<string>(userId);
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'month' | 'year' | 'specific'>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState<'all' | StatusValue>('all');
  const [newReason, setNewReason] = useState('');
  const [now, setNow] = useState(() => new Date());

  // Atualiza a cada 30s pra manter "tempo do status atual" contando ao vivo
  // sem precisar recarregar o histórico.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      const { from, to } = getPeriodRange(periodFilter, selectedDate);
      const targetUserId = isAdmin ? selectedUserId : userId;
      const data = await UserStatusHistoryService.getAll({
        userId: targetUserId,
        from: from?.toISOString(),
        to: to?.toISOString()
      });
      setHistory(data);
    };
    loadHistory();
  }, [selectedUserId, isAdmin, periodFilter, selectedDate, userId]);

  const periodEndBoundary = useMemo(() => {
    const { to } = getPeriodRange(periodFilter, selectedDate);
    return to ? new Date(Math.min(to.getTime(), Date.now())) : new Date();
  }, [periodFilter, selectedDate, now]);

  const turns = useMemo(() => buildTurns(history, periodEndBoundary, now), [history, periodEndBoundary, now]);

  const totalsByStatus = useMemo(() => {
    const totals: Record<StatusValue, number> = { online: 0, away: 0, offline: 0 };
    for (const t of turns) totals[t.status] += turnDurationSeconds(t, now);
    return totals;
  }, [turns, now]);

  const visibleTurns = useMemo(
    () => turns.filter(t => statusFilter === 'all' || t.status === statusFilter).sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()),
    [turns, statusFilter]
  );

  const filteredTotalSeconds = useMemo(
    () => visibleTurns.reduce((acc, t) => acc + turnDurationSeconds(t, now), 0),
    [visibleTurns, now]
  );

  const groupedByUser = useMemo(() => {
    if (!isAdmin || selectedUserId !== 'all') return null;
    const map = new Map<string, StatusTurn[]>();
    for (const t of visibleTurns) {
      if (!map.has(t.userId)) map.set(t.userId, []);
      map.get(t.userId)!.push(t);
    }
    return [...map.entries()].sort((a, b) => new Date(b[1][0]?.start || 0).getTime() - new Date(a[1][0]?.start || 0).getTime());
  }, [visibleTurns, isAdmin, selectedUserId]);

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
    return user ? user.name : 'Usuário removido';
  };

  const getUserThumb = (id: string) => profiles.find(p => p.id === id)?.avatarThumbUrl || null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* Header com Filtros */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--surface-card)] p-6 border border-[var(--border-default)] rounded-[2rem] shadow-sm">
        <div>
          <h2 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Análise de Tempo e Presença</h2>
          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
            {isAdmin ? 'Gestão completa de disponibilidade e motivos' : 'Seu histórico pessoal de disponibilidade'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
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
          )}

          {isAdmin && (
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
          )}

          {/* Filtro por status — o total de cada opção já vem embutido no
              rótulo, então escolher "Ausente" já mostra quanto tempo isso
              representou no período, sem precisar somar linha por linha. */}
          <StyledSelect
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2 text-xs font-bold text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20 transition-all"
          >
            <option value="all">Todos os Status ({turns.length} turnos)</option>
            <option value="online">Disponível — {formatDuration(totalsByStatus.online)}</option>
            <option value="away">Ausente — {formatDuration(totalsByStatus.away)}</option>
            <option value="offline">Offline — {formatDuration(totalsByStatus.offline)}</option>
          </StyledSelect>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Tempo Online"
          value={formatDuration(totalsByStatus.online)}
          color="emerald"
          icon={<CheckCircle2 size={20} />}
          active={statusFilter === 'online'}
          onClick={() => setStatusFilter(prev => prev === 'online' ? 'all' : 'online')}
        />
        <StatCard
          label="Tempo em Ausência"
          value={formatDuration(totalsByStatus.away)}
          color="amber"
          icon={<Clock size={20} />}
          active={statusFilter === 'away'}
          onClick={() => setStatusFilter(prev => prev === 'away' ? 'all' : 'away')}
        />
        <StatCard
          label="Tempo Offline"
          value={formatDuration(totalsByStatus.offline)}
          color="slate"
          icon={<AlertCircle size={20} />}
          active={statusFilter === 'offline'}
          onClick={() => setStatusFilter(prev => prev === 'offline' ? 'all' : 'offline')}
        />
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
            <TurnList
              turns={visibleTurns}
              groupedByUser={groupedByUser}
              statusFilter={statusFilter}
              filteredTotalSeconds={filteredTotalSeconds}
              isAdmin={isAdmin}
              getUserName={getUserName}
              getUserThumb={getUserThumb}
              now={now}
            />
          </div>
        </div>
      )}

      {!isAdmin && (
        <TurnList
          turns={visibleTurns}
          groupedByUser={null}
          statusFilter={statusFilter}
          filteredTotalSeconds={filteredTotalSeconds}
          isAdmin={isAdmin}
          getUserName={getUserName}
          getUserThumb={getUserThumb}
          now={now}
        />
      )}
    </div>
  );
}

function getStatusIcon(status: StatusValue, reason?: string) {
  if (status === 'online') return <CheckCircle2 className="text-[var(--text-success)]" size={16} />;
  if (status === 'offline') return <AlertCircle className="text-[var(--text-tertiary)]" size={16} />;

  if (reason === 'Almoço') return <Coffee className="text-[var(--text-warning-strong)]" size={16} />;
  if (reason === 'Reunião') return <Users className="text-[var(--text-warning-strong)]" size={16} />;
  return <Info className="text-[var(--text-warning-strong)]" size={16} />;
}

// Formato inteligente D:H:M — turnos de "Todo o Período"/mês/ano podem passar
// de 24h fácil (ex.: alguém que nunca deslogou), então "39h 40m" vira "1d 15h
// 40m". Só entra a unidade de baixo quando há resto: "2d" em vez de "2d 0h
// 0m", "3h" em vez de "3h 0m".
function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;

  const totalMinutes = Math.floor(seconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    const parts = [`${days}d`];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ');
  }
  if (totalHours > 0) {
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }
  return `${minutes}m`;
}

function TurnList({
  turns,
  groupedByUser,
  statusFilter,
  filteredTotalSeconds,
  isAdmin,
  getUserName,
  getUserThumb,
  now
}: {
  turns: StatusTurn[];
  groupedByUser: [string, StatusTurn[]][] | null;
  statusFilter: 'all' | StatusValue;
  filteredTotalSeconds: number;
  isAdmin: boolean;
  getUserName: (id: string) => string;
  getUserThumb: (id: string) => string | null;
  now: Date;
}) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] overflow-hidden shadow-sm">
      <div className="px-8 py-6 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-card)]/50">
        <div>
          <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">Registro de Atividade</h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-semibold uppercase tracking-widest">
            {turns.length} turno{turns.length === 1 ? '' : 's'}
            {statusFilter !== 'all' && <> · {STATUS_LABELS[statusFilter]} · {formatDuration(filteredTotalSeconds)} no período</>}
          </p>
        </div>
        <div className="p-2 bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] text-[var(--text-tertiary)]">
           <Clock size={20} />
        </div>
      </div>

      <div className="divide-y divide-[var(--border-default)] max-h-[600px] overflow-y-auto custom-scrollbar">
        {turns.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[var(--text-tertiary)] font-medium italic">Nenhum registro encontrado.</p>
          </div>
        ) : groupedByUser ? (
          groupedByUser.map(([uid, userTurns]) => (
            <div key={uid}>
              <div className="px-8 py-3 bg-[var(--surface-card)]/70 flex items-center gap-3">
                <UserAvatar
                  name={getUserName(uid)}
                  thumbUrl={getUserThumb(uid)}
                  size={28}
                  rounded="rounded-lg"
                  fallbackClassName="bg-[var(--accent)]/10 text-[var(--accent-text)] font-black"
                />
                <p className="text-xs font-black text-[var(--text-primary)] uppercase tracking-tight truncate flex-1">{getUserName(uid)}</p>
                <span className="text-[9px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest shrink-0">
                  {userTurns.length} turno{userTurns.length === 1 ? '' : 's'}
                </span>
              </div>
              {userTurns.map(turn => <TurnRow key={turn.id} turn={turn} now={now} showUser={false} getUserName={getUserName} />)}
            </div>
          ))
        ) : (
          turns.map(turn => <TurnRow key={turn.id} turn={turn} now={now} showUser={isAdmin} getUserName={getUserName} />)
        )}
      </div>
    </div>
  );
}

function TurnRow({ turn, now, showUser, getUserName }: { turn: StatusTurn; now: Date; showUser: boolean; getUserName: (id: string) => string }) {
  const start = new Date(turn.start);
  const end = turn.isCurrent ? now : new Date(turn.end!);
  const duration = turnDurationSeconds(turn, now);
  const sameDay = isSameDay(start, end);

  return (
    <div className="px-8 py-4 flex items-center justify-between hover:bg-[var(--surface-card)]/50 transition-all group">
      <div className="flex items-center gap-4 min-w-0">
        <div className={cn(
          "w-10 h-10 rounded-2xl flex items-center justify-center transition-all shadow-sm shrink-0",
          turn.status === 'online' ? "bg-[var(--surface-success)] text-[var(--text-success)] group-hover:bg-[var(--surface-success)]" :
          turn.status === 'away' ? "bg-[var(--surface-warning)] text-[var(--text-warning)] group-hover:bg-[var(--surface-warning)]" :
          "bg-[var(--surface-card)] text-[var(--text-tertiary)] group-hover:bg-[var(--surface-pill)]"
        )}>
          {getStatusIcon(turn.status, turn.reason)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {showUser && (
              <span className="text-[10px] font-semibold text-[var(--accent-text)] uppercase bg-[var(--accent)]/10 px-2 py-0.5 rounded-lg border border-[var(--accent)]/20">
                {getUserName(turn.userId)}
              </span>
            )}
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-widest",
              turn.status === 'online' ? "text-[var(--text-success)]" :
              turn.status === 'away' ? "text-[var(--text-warning)]" :
              "text-[var(--text-tertiary)]"
            )}>
              {STATUS_LABELS[turn.status]}
            </span>
            {turn.reason && (
              <span className="text-[10px] font-bold text-[var(--text-tertiary)] italic">
                {">"} {turn.reason}
              </span>
            )}
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{format(start, "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
            {!turn.isCurrent && (
              <>
                <ArrowRight size={10} className="shrink-0" />
                <span>{format(end, sameDay ? "HH:mm" : "dd/MM 'às' HH:mm", { locale: ptBR })}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="text-right shrink-0">
        {turn.isCurrent ? (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[9px] font-semibold uppercase text-[var(--text-success)] bg-[var(--surface-success)] px-2 py-1 rounded-full border border-[var(--text-success)]/20 tracking-widest animate-pulse">
              Ativo agora
            </span>
            <span className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">há {formatDuration(duration)}</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
             <span className="text-xs font-black text-[var(--text-secondary)] tracking-tight">{formatDuration(duration)}</span>
             <span className="text-[8px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest leading-none">Duração</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon, active, onClick }: { label: string; value: string | number; color: 'emerald' | 'amber' | 'slate'; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
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
    <button
      type="button"
      onClick={onClick}
      title="Filtrar o registro abaixo por este status"
      className={cn(
        "p-6 rounded-[2rem] border shadow-sm flex items-center gap-4 transition-all hover:scale-[1.02] hover:shadow-md text-left w-full",
        colors[color],
        active && "ring-4 ring-[var(--accent)]/30"
      )}
    >
      <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg shrink-0", iconColors[color])}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest opacity-70 mb-0.5">{label}</p>
        <p className="text-xl font-black tracking-tight leading-tight">{value}</p>
      </div>
    </button>
  );
}
