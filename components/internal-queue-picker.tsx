'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Flame, Inbox, Layers, Loader2, Search, User as UserIcon, Archive, LayoutGrid } from 'lucide-react';
import { cn, normalizeString } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { InternalTicketQueue, Permission, User } from '@/lib/types';
import { useAnalystsQuery, useInternalTicketQueuesQuery } from '@/lib/query-hooks';
import { UserAvatar } from '@/components/user-avatar';

/**
 * Seleção de fila dos Tickets Internos (2026-11-16, pedido do usuário — no
 * padrão da tela de equipes do Odoo): um card por fila com os números
 * principais. Clicar no card abre só aquela fila; clicar num número abre a fila
 * já com aquele recorte. Usado na lista (Todos os Chamados > Tickets Internos)
 * e no Dashboard geral.
 *
 * Quem vê qual fila: com "Ver de todas as equipes" (internal:view_all), todas,
 * mais "Todas as filas" e "Sem fila". Sem ela, só as filas de
 * que a pessoa é membro, mais os sem fila da própria equipe.
 *
 * Chaves devolvidas em onSelect: id da fila, 'none' (sem fila) ou 'all'.
 */

export type InternalQueueQuickFilter = 'all' | 'mine' | 'unassigned' | 'overdue' | 'high';

interface QueueStats { open: number; unassigned: number; overdue: number; high: number; mine: number }
const EMPTY: QueueStats = { open: 0, unassigned: 0, overdue: 0, high: 0, mine: 0 };

export function useVisibleInternalQueues() {
  const { currentUser, hasPermission } = useApp();
  const { data, isLoading } = useInternalTicketQueuesQuery();
  const canSeeAll = hasPermission(Permission.INTERNAL_TICKETS_VIEW_ALL);
  const queues = useMemo(() => {
    const all = ((data || []) as InternalTicketQueue[]).filter(q => q.isActive);
    const mineFirst = [...all].sort((a, b) => {
      const am = currentUser ? a.memberIds.includes(currentUser.id) : false;
      const bm = currentUser ? b.memberIds.includes(currentUser.id) : false;
      if (am !== bm) return am ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return canSeeAll ? mineFirst : mineFirst.filter(q => !!currentUser && q.memberIds.includes(currentUser.id));
  }, [data, canSeeAll, currentUser]);
  return { queues, allQueues: (data || []) as InternalTicketQueue[], canSeeAll, isLoading };
}

/** Nome exibido para a chave escolhida (id da fila, 'none' ou 'all'). */
export function internalQueueLabel(key: string | null, allQueues: InternalTicketQueue[]): string {
  if (!key) return '';
  if (key === 'all') return 'Todas as filas';
  if (key === 'none') return 'Sem fila';
  return allQueues.find(q => q.id === key)?.name || 'Fila';
}

export function InternalQueuePicker({ onSelect, refreshKey }: {
  onSelect: (key: string, quickFilter?: InternalQueueQuickFilter) => void;
  refreshKey?: number;
}) {
  const { currentUser } = useApp();
  const { queues, canSeeAll, isLoading } = useVisibleInternalQueues();
  const { data: analystsData } = useAnalystsQuery();
  const analystsById = useMemo(() => new Map(((analystsData || []) as User[]).map(a => [a.id, a])), [analystsData]);
  const [stats, setStats] = useState<Map<string, QueueStats> | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/internal-tickets?action=queue-overview')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (cancelled) return;
        const map = new Map<string, QueueStats>();
        (rows || []).forEach(r => map.set(r.queue_id || 'none', { open: r.open, unassigned: r.unassigned, overdue: r.overdue, high: r.high, mine: r.mine }));
        setStats(map);
      })
      .catch(() => { if (!cancelled) setStats(new Map()); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const totals = useMemo(() => {
    if (!stats) return EMPTY;
    const t = { ...EMPTY };
    stats.forEach(v => { t.open += v.open; t.unassigned += v.unassigned; t.overdue += v.overdue; t.high += v.high; t.mine += v.mine; });
    return t;
  }, [stats]);

  const filtered = queues.filter(q => normalizeString(q.name).includes(normalizeString(search)));
  const hasTeam = (currentUser?.internalTeamIds?.length ?? 0) > 0;
  const legacy = stats?.get('none') || EMPTY;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-[var(--text-tertiary)]">
        <Loader2 size={18} className="animate-spin" /> Carregando filas...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-[var(--text-primary)] flex items-center gap-2"><Layers size={18} /> Escolha uma fila</h2>
          <p className="text-sm text-[var(--text-tertiary)]">Os tickets internos são organizados por fila. Abra uma para ver só os tickets dela.</p>
        </div>
        {queues.length > 8 && (
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar fila..."
              aria-label="Buscar fila"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:border-[var(--text-warning-strong)]"
            />
          </div>
        )}
      </div>

      {queues.length === 0 && !canSeeAll && (
        <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-6 text-sm text-[var(--text-tertiary)]">
          Você ainda não faz parte de nenhuma fila de ticket interno. Peça a quem administra para incluí-lo em
          Configurações &gt; Filas de Ticket Interno.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {canSeeAll && !search && (
          <QueueCard
            title="Todas as filas"
            icon={<LayoutGrid size={14} />}
            stats={stats ? totals : null}
            onOpen={(qf) => onSelect('all', qf)}
            subtle
          />
        )}
        {filtered.map(q => (
          <QueueCard
            key={q.id}
            title={q.name}
            isMember={!!currentUser && q.memberIds.includes(currentUser.id)}
            members={q.memberIds.map(id => analystsById.get(id)).filter(Boolean) as User[]}
            stats={stats ? (stats.get(q.id) || EMPTY) : null}
            onOpen={(qf) => onSelect(q.id, qf)}
          />
        ))}
        {/* Some sozinho quando não sobrar ticket aberto sem fila — toda criação
            já exige fila; só restam os antigos até serem movidos. */}
        {!search && legacy.open > 0 && (canSeeAll || hasTeam) && (
          <QueueCard
            title="Sem fila"
            icon={<Archive size={14} />}
            description={canSeeAll ? 'Tickets que não estão em nenhuma fila.' : 'Tickets da sua equipe que não estão em nenhuma fila.'}
            // Sem a permissão de ver tudo, o número geral não é o que a pessoa vai enxergar.
            stats={canSeeAll && stats ? legacy : null}
            hideStats={!canSeeAll}
            onOpen={(qf) => onSelect('none', qf)}
            subtle
          />
        )}
      </div>
    </div>
  );
}

function QueueCard({ title, icon, description, isMember, members, stats, hideStats, onOpen, subtle }: {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  isMember?: boolean;
  members?: User[];
  stats: QueueStats | null;
  hideStats?: boolean;
  onOpen: (quickFilter?: InternalQueueQuickFilter) => void;
  subtle?: boolean;
}) {
  const rows: { key: InternalQueueQuickFilter; label: string; icon: React.ReactNode; value: number; alert?: boolean }[] = stats ? [
    { key: 'unassigned', label: 'Sem responsável', icon: <Inbox size={12} />, value: stats.unassigned },
    { key: 'overdue', label: 'Atrasados', icon: <AlertTriangle size={12} />, value: stats.overdue, alert: stats.overdue > 0 },
    { key: 'high', label: 'Alta prioridade', icon: <Flame size={12} />, value: stats.high },
    { key: 'mine', label: 'Meus', icon: <UserIcon size={12} />, value: stats.mine },
  ] : [];

  return (
    // O card inteiro abre a fila; os números dentro dele abrem com o recorte
    // (stopPropagation, senão o clique no número também abriria a fila cheia).
    <div
      role="button"
      tabIndex={0}
      aria-label={`Abrir fila ${title}`}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className={cn(
        'rounded-2xl border bg-[var(--surface-card)] p-4 flex flex-col gap-3 transition-all hover:shadow-md hover:border-[var(--text-warning-strong)]/50 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--text-warning-strong)]/40',
        subtle ? 'border-dashed border-[var(--border-default)]' : 'border-[var(--border-default)]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-black text-[var(--text-primary)] flex items-center gap-1.5 leading-tight">
            {icon}<span className="truncate">{title}</span>
          </h3>
          {description && <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{description}</p>}
          {isMember && (
            <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-warning)]">Você participa</span>
          )}
        </div>
        {members && members.length > 0 && (
          <div className="flex -space-x-1.5 shrink-0" aria-label={`${members.length} membro(s)`}>
            {members.slice(0, 4).map(m => (
              <UserAvatar key={m.id} name={m.name} thumbUrl={m.avatarThumbUrl} size={22} title={m.name} className="ring-2 ring-[var(--surface-card)]" />
            ))}
            {members.length > 4 && (
              <span className="w-[22px] h-[22px] rounded-full bg-[var(--surface-pill)] text-[9px] font-bold flex items-center justify-center ring-2 ring-[var(--surface-card)] text-[var(--text-secondary)]">
                +{members.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 mt-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="px-4 py-2 rounded-xl bg-[var(--text-warning-strong)] text-white text-xs font-bold uppercase tracking-wide hover:bg-[var(--accent-warning-hover)] transition-colors"
        >
          {hideStats ? 'Abrir' : stats ? `${stats.open} aberto${stats.open === 1 ? '' : 's'}` : 'Abrir'}
        </button>
        {!hideStats && (
          stats ? (
            <div className="flex flex-col items-end gap-0.5">
              {rows.map(r => (
                <button
                  key={r.key}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpen(r.key); }}
                  disabled={r.value === 0}
                  className={cn(
                    'text-[11px] flex items-center gap-1 hover:underline disabled:no-underline disabled:opacity-50',
                    r.alert ? 'text-[var(--text-danger)] font-semibold' : 'text-[var(--text-secondary)]'
                  )}
                >
                  {r.icon} {r.value} {r.label.toLowerCase()}
                </button>
              ))}
            </div>
          ) : (
            <Loader2 size={14} className="animate-spin text-[var(--text-tertiary)]" />
          )
        )}
      </div>
    </div>
  );
}
