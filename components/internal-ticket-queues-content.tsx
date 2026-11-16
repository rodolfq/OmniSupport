'use client';

import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Search, Trash2, Edit2, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { InternalTicketQueue, User } from '@/lib/types';
import { useAnalystsQuery, useInternalTicketQueuesQuery, INTERNAL_TICKET_QUEUES_KEY } from '@/lib/query-hooks';
import { UserAvatar } from '@/components/user-avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';

/**
 * Configurações > Atendimento > Filas de Ticket Interno (2026-11-13).
 *
 * A fila substitui a "Equipe" no ticket interno: diz do que o ticket trata, e
 * o Responsável é escolhido entre os membros da fila. Uma pessoa pode estar em
 * quantas filas quiser. NÃO são as filas de atendimento de chat (aba "Filas").
 * Permissão: internal:queues_manage (checada também no servidor).
 */

type QueueRow = InternalTicketQueue & { ticketCount?: number };

interface Draft {
  id?: string;
  name: string;
  isActive: boolean;
  memberIds: string[];
}

export function InternalTicketQueuesContent() {
  const queryClient = useQueryClient();
  const { data: queuesData, isLoading } = useInternalTicketQueuesQuery();
  const queues = (queuesData || []) as QueueRow[];
  const { data: analystsData } = useAnalystsQuery();
  const analysts = useMemo(
    () => [...((analystsData || []) as User[])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [analystsData]
  );
  const analystsById = useMemo(() => new Map(analysts.map(a => [a.id, a])), [analysts]);

  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<QueueRow | null>(null);

  useEscapeToClose(!!draft && !toDelete, () => setDraft(null));

  const filtered = queues.filter(q => q.name.toLowerCase().includes(search.trim().toLowerCase()));
  const refresh = () => queryClient.invalidateQueries({ queryKey: INTERNAL_TICKET_QUEUES_KEY });

  const openNew = () => { setMemberSearch(''); setDraft({ name: '', isActive: true, memberIds: [] }); };
  const openEdit = (q: QueueRow) => { setMemberSearch(''); setDraft({ id: q.id, name: q.name, isActive: q.isActive, memberIds: [...q.memberIds] }); };

  const post = async (body: any) => {
    const res = await fetch('/api/internal-ticket-queues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Erro ao salvar.');
    return data;
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error('Informe o nome da fila.'); return; }
    setSaving(true);
    try {
      await post({ action: 'save', ...draft, name: draft.name.trim() });
      toast.success(draft.id ? 'Fila atualizada' : 'Fila criada');
      setDraft(null);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (q: QueueRow) => {
    try {
      await post({ action: 'save', id: q.id, name: q.name, memberIds: q.memberIds, isActive: !q.isActive });
      toast.success(q.isActive ? 'Fila desativada' : 'Fila ativada');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await post({ action: 'delete', id: toDelete.id });
      toast.success('Fila excluída');
      setToDelete(null);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleMember = (id: string) => {
    setDraft(d => d ? { ...d, memberIds: d.memberIds.includes(id) ? d.memberIds.filter(x => x !== id) : [...d.memberIds, id] } : d);
  };
  const visibleMembers = analysts.filter(a => a.name.toLowerCase().includes(memberSearch.trim().toLowerCase()));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] flex items-center gap-2"><Layers size={20} /> Filas de Ticket Interno</h3>
          <p className="text-sm text-[var(--text-tertiary)] max-w-2xl">
            Cada ticket interno pertence a uma fila. O responsável do ticket é escolhido entre os membros da fila, e a mesma pessoa pode estar em várias filas.
            Não confundir com as filas de atendimento do chat.
          </p>
        </div>
        <button onClick={openNew} className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--accent)] text-white hover:opacity-90 flex items-center gap-1.5">
          <Plus size={14} /> Nova fila
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar fila..."
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]"><Loader2 size={16} className="animate-spin" /> Carregando filas...</div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--text-tertiary)]">Nenhuma fila encontrada.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(q => (
            <div key={q.id} className={cn('rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 space-y-3', !q.isActive && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text-primary)] truncate">{q.name}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    {q.memberIds.length} membro{q.memberIds.length === 1 ? '' : 's'}
                    {typeof q.ticketCount === 'number' ? ` · ${q.ticketCount} ticket${q.ticketCount === 1 ? '' : 's'}` : ''}
                    {!q.isActive && ' · inativa'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(q)} title="Editar fila" aria-label={`Editar ${q.name}`} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)]"><Edit2 size={14} /></button>
                  <button onClick={() => setToDelete(q)} title="Excluir fila" aria-label={`Excluir ${q.name}`} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {q.memberIds.length === 0 && <span className="text-[11px] text-[var(--text-tertiary)]">Sem membros — ninguém aparece como responsável.</span>}
                {q.memberIds.slice(0, 8).map(id => {
                  const u = analystsById.get(id);
                  return u ? (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-pill)] text-[11px] text-[var(--text-secondary)]">
                      <UserAvatar name={u.name} thumbUrl={u.avatarThumbUrl} size={14} /> {u.name.split(' ')[0]}
                    </span>
                  ) : null;
                })}
                {q.memberIds.length > 8 && <span className="text-[11px] text-[var(--text-tertiary)]">+{q.memberIds.length - 8}</span>}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <input type="checkbox" checked={q.isActive} onChange={() => toggleActive(q)} />
                Ativa (aparece para escolha no ticket interno)
              </label>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setDraft(null)}>
          <div role="dialog" aria-modal="true" aria-label={draft.id ? 'Editar fila' : 'Nova fila'} className="bg-[var(--surface-card)] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-[var(--border-default)] flex items-center justify-between">
              <h4 className="font-black text-[var(--text-primary)]">{draft.id ? 'Editar fila' : 'Nova fila'}</h4>
              <button onClick={() => setDraft(null)} aria-label="Fechar" className="p-1 rounded-lg hover:bg-[var(--surface-pill)]"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-1.5">
                <label htmlFor="iq-name" className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Nome</label>
                <input
                  id="iq-name"
                  autoFocus
                  value={draft.name}
                  onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:border-[var(--accent)]"
                  placeholder="Ex.: Desenvolvimento - Web"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input type="checkbox" checked={draft.isActive} onChange={e => setDraft(d => d ? { ...d, isActive: e.target.checked } : d)} />
                Ativa
              </label>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest">Membros ({draft.memberIds.length})</span>
                </div>
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Buscar pessoa..."
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:border-[var(--accent)]"
                />
                <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-default)]">
                  {visibleMembers.map(a => {
                    const checked = draft.memberIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleMember(a.id)}
                        className={cn('w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-pill)]', checked && 'bg-[var(--accent)]/5')}
                      >
                        <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-[var(--border-default)]')}>
                          {checked && <Check size={11} />}
                        </span>
                        <UserAvatar name={a.name} thumbUrl={a.avatarThumbUrl} size={20} />
                        <span className="truncate text-[var(--text-primary)]">{a.name}</span>
                        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{a.role}</span>
                      </button>
                    );
                  })}
                  {visibleMembers.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">Ninguém encontrado.</p>}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-[var(--border-default)] flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 flex items-center gap-1">
                {saving && <Loader2 size={12} className="animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title={`Excluir a fila "${toDelete?.name || ''}"?`}
        description={toDelete?.ticketCount ? `${toDelete.ticketCount} ticket(s) interno(s) estão nesta fila e ficarão sem fila. Para só esconder a fila, desative-a.` : 'A fila deixa de existir. Para só escondê-la, desative-a.'}
        confirmLabel="Excluir"
        variant="danger"
      />
    </div>
  );
}
