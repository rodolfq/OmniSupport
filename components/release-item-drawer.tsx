'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, RotateCcw, Trash2, ExternalLink, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { ReleaseCycle, ReleaseItem, User } from '@/lib/types';
import { apiJson } from '@/lib/api-client';
import {
  updateReleaseItem, deleteReleaseItem, completeReleaseItem, reopenReleaseItem,
  linkItemTicket, unlinkItemTicket, getItemTickets, ItemLinkedTickets
} from '@/lib/services/queue-service';
import { StyledSelect } from '@/components/styled-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { RELEASE_ITEM_TYPE_META } from '@/lib/release-stage-logic';
import { cn } from '@/lib/utils';

interface ReleaseItemDrawerProps {
  cycle: ReleaseCycle;
  item: ReleaseItem;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  users: User[];
  onChanged: () => void;
}

export function ReleaseItemDrawer({ cycle, item, isOpen, onClose, canEdit, users, onChanged }: ReleaseItemDrawerProps) {
  useEscapeToClose(isOpen, onClose);
  const router = useRouter();

  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description || '');
  const [responsibleId, setResponsibleId] = useState(item.responsibleId || '');
  const [currentStageId, setCurrentStageId] = useState(item.currentStageId || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [linked, setLinked] = useState<ItemLinkedTickets>({ internalTickets: [], clientTickets: [] });
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketKind, setTicketKind] = useState<'internal' | 'client'>('internal');
  const [searchResults, setSearchResults] = useState<{ id: string; label: string }[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(item.name);
    setDescription(item.description || '');
    setResponsibleId(item.responsibleId || '');
    setCurrentStageId(item.currentStageId || '');
    setTicketSearch('');
    setSearchResults([]);
    getItemTickets(item.id).then(setLinked);
  }, [isOpen, item.id]);

  const locked = !!cycle.publishedAt;
  const typeMeta = RELEASE_ITEM_TYPE_META[item.itemType];
  const orderedStages = [...cycle.stages].sort((a, b) => a.stageOrder - b.stageOrder);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateReleaseItem(item.id, { name, description: description || null, responsibleId: responsibleId || null, currentStageId: currentStageId || null });
      if (res.error) { toast.error(res.error); return; }
      toast.success('Item atualizado.');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    const res = item.completedAt ? await reopenReleaseItem(item.id) : await completeReleaseItem(item.id);
    if (res.error) { toast.error(res.error); return; }
    toast.success(item.completedAt ? 'Item reaberto.' : 'Item concluído.');
    onChanged();
  };

  const handleDelete = async () => {
    const res = await deleteReleaseItem(item.id);
    if (res.error) { toast.error(res.error); return; }
    setConfirmDelete(false);
    onChanged();
    onClose();
  };

  const runSearch = useCallback(async (q: string, kind: 'internal' | 'client') => {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      if (kind === 'internal') {
        const rows = await apiJson<any[]>(`/api/internal-tickets?action=list&search=${encodeURIComponent(q)}&limit=8`);
        setSearchResults((rows || []).map(r => ({ id: r.id, label: `int-${String(r.internal_ticket_number).padStart(4, '0')} — ${r.title}` })));
      } else {
        const res = await apiJson<any>(`/api/search?action=tickets&query=${encodeURIComponent(q)}&pageSize=8`);
        const rows = Array.isArray(res) ? res : res?.tickets || res?.data || [];
        setSearchResults(rows.map((r: any) => ({ id: r.id, label: `#${r.publicTicketNumber ?? r.public_ticket_number ?? ''} — ${r.title || r.subject || ''}` })));
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleLinkTicket = async (ticketId: string) => {
    const res = await linkItemTicket(item.id, ticketKind, ticketId);
    if (res.error) { toast.error(res.error); return; }
    setTicketSearch('');
    setSearchResults([]);
    getItemTickets(item.id).then(setLinked);
    toast.success('Chamado vinculado.');
  };

  const handleUnlinkTicket = async (kind: 'internal' | 'client', ticketId: string) => {
    const res = await unlinkItemTicket(item.id, kind, ticketId);
    if (res.error) { toast.error(res.error); return; }
    getItemTickets(item.id).then(setLinked);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex justify-end">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="relative w-full max-w-lg bg-[var(--surface-card)] h-full shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-[var(--border-default)] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1 truncate">{cycle.name}</p>
                <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight truncate">{item.name}</h3>
                <span
                  className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-white"
                  style={{ backgroundColor: typeMeta.color }}
                >
                  {typeMeta.label}
                </span>
                {item.completedAt && <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-[var(--text-success)]">Concluído</span>}
                {locked && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Ciclo travado</span>}
              </div>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--surface-pill)] text-[var(--text-tertiary)] shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome</label>
                <input value={name} disabled={!canEdit || locked} onChange={e => setName(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Descrição</label>
                <textarea value={description} disabled={!canEdit || locked} onChange={e => setDescription(e.target.value)}
                  className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-medium outline-none resize-none h-20 disabled:opacity-60" placeholder="Opcional" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Responsável</label>
                  <StyledSelect value={responsibleId} disabled={!canEdit || locked} onChange={e => setResponsibleId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none appearance-none disabled:opacity-60">
                    <option value="">Sem responsável</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </StyledSelect>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Etapa atual</label>
                  <StyledSelect value={currentStageId} disabled={!canEdit || locked} onChange={e => setCurrentStageId(e.target.value)}
                    className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none appearance-none disabled:opacity-60">
                    <option value="">Sem posição</option>
                    {orderedStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </StyledSelect>
                </div>
              </div>

              {canEdit && !locked && (
                <div className="flex gap-2">
                  <button onClick={handleSave} disabled={saving}
                    className="flex-1 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] disabled:opacity-50">
                    Salvar
                  </button>
                  <button onClick={handleComplete}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-[var(--text-success)]/30 bg-[var(--surface-success)] text-[var(--text-success)]">
                    {item.completedAt ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
                    {item.completedAt ? 'Reabrir' : 'Concluir'}
                  </button>
                  <button onClick={() => setConfirmDelete(true)} className="p-2.5 rounded-xl border border-[var(--border-default)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)]">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              {locked && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] text-center">
                  Ciclo concluído — item travado, sem edição
                </p>
              )}

              <div className="border-t border-[var(--border-default)] pt-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Chamados vinculados</p>
                {canEdit && !locked && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      {(['internal', 'client'] as const).map(k => (
                        <button key={k} onClick={() => { setTicketKind(k); setSearchResults([]); setTicketSearch(''); }}
                          className={cn('px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border',
                            ticketKind === k ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border-default)] text-[var(--text-tertiary)]')}>
                          {k === 'internal' ? 'Ticket interno' : 'Chamado de cliente'}
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                      <input
                        value={ticketSearch}
                        onChange={e => { setTicketSearch(e.target.value); runSearch(e.target.value, ticketKind); }}
                        placeholder="Buscar por número ou título..."
                        className="w-full bg-[var(--surface-pill)] rounded-xl pl-8 pr-3 py-2.5 text-sm font-medium outline-none"
                      />
                    </div>
                    {ticketSearch.length >= 2 && (
                      <div className="rounded-xl border border-[var(--border-default)] divide-y divide-[var(--border-default)] max-h-40 overflow-y-auto">
                        {searching && <p className="text-xs text-[var(--text-tertiary)] p-2.5">Buscando...</p>}
                        {!searching && searchResults.length === 0 && <p className="text-xs text-[var(--text-tertiary)] p-2.5">Nada encontrado.</p>}
                        {searchResults.map(r => (
                          <button key={r.id} onClick={() => handleLinkTicket(r.id)} className="w-full flex items-center justify-between gap-2 p-2.5 text-left hover:bg-[var(--surface-pill)]">
                            <span className="text-xs font-semibold truncate">{r.label}</span>
                            <Plus size={13} className="shrink-0 text-[var(--accent-text)]" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1.5">Tickets internos ({linked.internalTickets.length})</p>
                  {linked.internalTickets.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)]">Nenhum.</p>
                  ) : (
                    <ul className="space-y-1">
                      {linked.internalTickets.map(t => (
                        <li key={t.id} className="flex items-center justify-between gap-2 group">
                          <button onClick={() => router.push(`/internal-tickets/${t.id}`)} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline truncate">
                            <ExternalLink size={11} className="shrink-0" />
                            {t.internalTicketNumber ? `int-${String(t.internalTicketNumber).padStart(4, '0')} — ` : ''}{t.title}
                          </button>
                          {canEdit && !locked && (
                            <button onClick={() => handleUnlinkTicket('internal', t.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-danger)] shrink-0"><X size={13} /></button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1.5">Chamados de cliente ({linked.clientTickets.length})</p>
                  {linked.clientTickets.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)]">Nenhum.</p>
                  ) : (
                    <ul className="space-y-1">
                      {linked.clientTickets.map(t => (
                        <li key={t.id} className="flex items-center justify-between gap-2 group">
                          <button onClick={() => router.push(`/tickets/${t.id}`)} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline truncate">
                            <ExternalLink size={11} className="shrink-0" />
                            #{t.publicTicketNumber} — {t.title}
                          </button>
                          {canEdit && !locked && (
                            <button onClick={() => handleUnlinkTicket('client', t.id)} className="opacity-0 group-hover:opacity-100 text-[var(--text-danger)] shrink-0"><X size={13} /></button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Excluir item"
        description={`Remover "${item.name}"? Chamados vinculados perdem o vínculo, mas não são apagados.`}
        confirmLabel="Excluir"
        variant="danger"
      />
    </AnimatePresence>
  );
}
