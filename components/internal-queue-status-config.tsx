'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Layers, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InternalTicketQueue, Permission, StatusConfig } from '@/lib/types';
import { useApp } from '@/app/app-context';
import { useInternalTicketQueuesQuery, INTERNAL_TICKET_QUEUES_KEY } from '@/lib/query-hooks';
import { findStatusColor } from '@/lib/status-colors';

/**
 * Status por fila de ticket interno (2026-11-24) — fica dentro da Gestão de
 * Status, escopo Tickets Internos. O cadastro de status continua único; aqui
 * cada fila marca quais usa (sub-status um a um) e em que ordem. Fila sem
 * nada marcado usa todos. Permissão: internal:queues_manage (mesma da tela
 * de filas; checada também no servidor).
 */
export function InternalQueueStatusConfig({ statuses }: { statuses: StatusConfig[] }) {
  const { hasPermission } = useApp();
  const canEdit = hasPermission(Permission.INTERNAL_QUEUES_MANAGE);
  const queryClient = useQueryClient();
  const { data: queuesData } = useInternalTicketQueuesQuery();
  const queues = (queuesData || []) as InternalTicketQueue[];

  const [queueId, setQueueId] = useState('');
  const [selected, setSelected] = useState<string[]>([]); // ids na ordem da fila
  const [saving, setSaving] = useState(false);

  const queue = queues.find(q => q.id === queueId);
  const tops = useMemo(
    () => statuses.filter(s => !s.parentStatusId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [statuses]
  );
  const childrenOf = (id: string) => statuses.filter(s => s.parentStatusId === id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  useEffect(() => {
    if (!queueId && queues.length) setQueueId(queues[0].id);
  }, [queues, queueId]);

  // Ao trocar de fila (ou recarregar), parte do que está gravado.
  useEffect(() => {
    setSelected(queue?.statusIds ? [...queue.statusIds] : []);
  }, [queueId, queue?.statusIds?.join(',')]);

  const usesAll = selected.length === 0;
  const selectedTops = selected.filter(id => tops.some(t => t.id === id));
  const isDirty = (queue?.statusIds || []).join(',') !== selected.join(',');

  // Mantém sempre cada sub-status logo depois do seu pai, na ordem dos pais.
  const normalize = (ids: string[]) => {
    const topOrder = ids.filter(id => tops.some(t => t.id === id));
    const out: string[] = [];
    for (const t of topOrder) {
      out.push(t);
      for (const c of childrenOf(t)) if (ids.includes(c.id)) out.push(c.id);
    }
    return out;
  };

  const startCustom = () => setSelected(normalize(statuses.map(s => s.id)));
  const toggleTop = (id: string) => {
    if (selected.includes(id)) {
      const kids = childrenOf(id).map(c => c.id);
      setSelected(normalize(selected.filter(x => x !== id && !kids.includes(x))));
    } else {
      setSelected(normalize([...selected, id]));
    }
  };
  const toggleChild = (child: StatusConfig) => {
    setSelected(prev => normalize(prev.includes(child.id) ? prev.filter(x => x !== child.id) : [...prev, child.id]));
  };
  const move = (id: string, dir: -1 | 1) => {
    const order = [...selectedTops];
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const subs = selected.filter(x => !tops.some(t => t.id === x));
    setSelected(normalize([...order, ...subs]));
  };

  const save = async (ids: string[]) => {
    if (!queue) return;
    if (ids.length > 0 && !ids.some(id => tops.some(t => t.id === id))) {
      toast.error('Marque ao menos um status.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/internal-ticket-queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-statuses', id: queue.id, statusIds: ids })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Erro ao salvar.');
      toast.success(ids.length ? `Status da fila "${queue.name}" salvos` : `"${queue.name}" volta a usar todos os status`);
      await queryClient.invalidateQueries({ queryKey: INTERNAL_TICKET_QUEUES_KEY });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (queues.length === 0) return null;

  // Na lista: primeiro os marcados (na ordem da fila), depois os não usados.
  const listed = usesAll ? tops : [
    ...selectedTops.map(id => tops.find(t => t.id === id)!).filter(Boolean),
    ...tops.filter(t => !selected.includes(t.id))
  ];

  return (
    <div className="rounded-3xl border border-[var(--border-default)] p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <Layers size={16} className="text-[var(--accent-text)]" /> Status por fila
          </h4>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-1 max-w-xl">
            Escolha quais status do cadastro acima cada fila de ticket interno usa, e em que ordem aparecem (colunas do Kanban e opções do ticket).
            Fila sem configuração usa todos os status.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="iqs-queue" className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Fila</label>
          <select
            id="iqs-queue"
            value={queueId}
            onChange={e => {
              if (isDirty && !window.confirm('Descartar as alterações não salvas desta fila?')) return;
              setQueueId(e.target.value);
            }}
            className="min-w-[16rem] px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm font-bold outline-none focus:border-[var(--accent)]"
          >
            {queues.map(q => (
              <option key={q.id} value={q.id}>
                {q.name}{q.statusIds && q.statusIds.length ? ' · personalizada' : ''}{!q.isActive ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {usesAll ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--surface-pill)] px-4 py-3">
          <p className="text-xs text-[var(--text-secondary)]">
            <strong>{queue?.name}</strong> usa <strong>todos os status</strong>, na ordem do cadastro.
          </p>
          {canEdit && (
            <button type="button" onClick={startCustom} className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[var(--accent)] text-white hover:opacity-90">
              Escolher status desta fila
            </button>
          )}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {listed.map(t => {
          const on = usesAll || selected.includes(t.id);
          const color = findStatusColor(t.color);
          const idx = selectedTops.indexOf(t.id);
          const kids = childrenOf(t.id);
          return (
            <div key={t.id} className={cn('rounded-2xl border border-[var(--border-default)] px-3 py-2', !on && 'opacity-60')}>
              <div className="flex items-center gap-2">
                {!usesAll && canEdit && (
                  <button
                    type="button" role="checkbox" aria-checked={on} aria-label={`Usar ${t.label} nesta fila`}
                    onClick={() => toggleTop(t.id)}
                    className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', on ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--border-default)]')}
                  >
                    {on && <Check size={11} />}
                  </button>
                )}
                <span className={cn('px-2.5 py-1 rounded-xl text-[11px] font-black uppercase tracking-tight flex items-center gap-1.5', color.bg, color.text)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', color.dot)} /> {t.label}
                </span>
                {t.isClosed && <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">finaliza</span>}
                {!usesAll && on && canEdit && (
                  <div className="ml-auto flex items-center gap-0.5">
                    <button type="button" onClick={() => move(t.id, -1)} disabled={idx <= 0} aria-label={`Subir ${t.label}`} className="p-1 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" onClick={() => move(t.id, 1)} disabled={idx === selectedTops.length - 1} aria-label={`Descer ${t.label}`} className="p-1 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] disabled:opacity-30"><ArrowDown size={14} /></button>
                  </div>
                )}
              </div>
              {on && kids.length > 0 && (
                <div className="pl-7 pt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {kids.map(c => {
                    const cOn = usesAll || selected.includes(c.id);
                    return (
                      <label key={c.id} className={cn('flex items-center gap-1.5 text-[11px] font-bold', cOn ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')}>
                        {!usesAll && canEdit ? (
                          <input type="checkbox" checked={cOn} onChange={() => toggleChild(c)} className="rounded border-[var(--border-default)]" />
                        ) : (
                          <span className="w-1 h-1 rounded-full bg-[var(--text-tertiary)]" />
                        )}
                        {c.label}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && !usesAll && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button" onClick={() => save([])} disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] disabled:opacity-50"
          >
            Voltar a usar todos
          </button>
          {isDirty && (
            <button type="button" onClick={() => setSelected(queue?.statusIds ? [...queue.statusIds] : [])} disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
              Descartar
            </button>
          )}
          <button
            type="button" onClick={() => save(selected)} disabled={saving || !isDirty}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
          >
            {saving && <Loader2 size={12} className="animate-spin" />} Salvar status da fila
          </button>
        </div>
      )}
      {!canEdit && (
        <p className="text-[11px] text-[var(--text-tertiary)]">Só quem configura as filas de ticket interno pode alterar os status de cada fila.</p>
      )}
    </div>
  );
}
