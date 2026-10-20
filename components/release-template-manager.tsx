'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, ArrowUp, ArrowDown, LayoutTemplate, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { ReleaseTemplate, User } from '@/lib/types';
import { saveReleaseTemplate, deleteReleaseTemplate } from '@/lib/services/queue-service';
import { InternalTeamRecord } from '@/lib/services/internal-team-service';
import { MultiSelectFilter } from '@/components/multi-select-filter';
import { StyledSelect } from '@/components/styled-select';
import { ConfirmDialog } from '@/components/confirm-dialog';

interface StageDraft {
  name: string;
  description: string;
  color: string;
  offsetStartDays: number;
  offsetEndDays: number;
  defaultTeamId: string;
  defaultResponsibleIds: string[];
}

const BLANK_STAGE: StageDraft = { name: '', description: '', color: '#2563eb', offsetStartDays: 0, offsetEndDays: 0, defaultTeamId: '', defaultResponsibleIds: [] };

interface ReleaseTemplateManagerProps {
  isOpen: boolean;
  onClose: () => void;
  templates: ReleaseTemplate[];
  teams: InternalTeamRecord[];
  users: User[];
  onChanged: () => void;
}

export function ReleaseTemplateManager({ isOpen, onClose, templates, teams, users, onChanged }: ReleaseTemplateManagerProps) {
  useEscapeToClose(isOpen, onClose);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageDraft[]>([{ ...BLANK_STAGE }]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { if (!isOpen) { setEditingId(null); setIsNew(false); } }, [isOpen]);

  const startNew = () => {
    setIsNew(true);
    setEditingId(null);
    setName('');
    setDescription('');
    setStages([{ ...BLANK_STAGE }]);
  };

  const startEdit = (t: ReleaseTemplate) => {
    setIsNew(false);
    setEditingId(t.id);
    setName(t.name);
    setDescription(t.description || '');
    setStages(t.stages.length > 0
      ? t.stages.map(s => ({
          name: s.name, description: s.description || '', color: s.color,
          offsetStartDays: s.offsetStartDays, offsetEndDays: s.offsetEndDays,
          defaultTeamId: s.defaultTeamId || '', defaultResponsibleIds: s.defaultResponsibleIds || []
        }))
      : [{ ...BLANK_STAGE }]);
  };

  const editing = isNew || editingId !== null;

  const updateStage = (i: number, patch: Partial<StageDraft>) => {
    setStages(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const moveStage = (i: number, dir: -1 | 1) => {
    setStages(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const removeStage = (i: number) => setStages(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Dê um nome ao modelo.'); return; }
    const validStages = stages.filter(s => s.name.trim());
    if (validStages.length === 0) { toast.error('Adicione ao menos uma etapa com nome.'); return; }
    setSaving(true);
    try {
      const res = await saveReleaseTemplate({
        id: editingId, name, description: description || null,
        stages: validStages.map(s => ({
          name: s.name, description: s.description || null, color: s.color,
          offsetStartDays: Number(s.offsetStartDays) || 0, offsetEndDays: Number(s.offsetEndDays) || 0,
          defaultTeamId: s.defaultTeamId || null, defaultResponsibleIds: s.defaultResponsibleIds
        }))
      });
      if (res.error) { toast.error(res.error); return; }
      toast.success('Modelo salvo.');
      setEditingId(null);
      setIsNew(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const res = await deleteReleaseTemplate(deletingId);
    if (res.error) { toast.error(res.error); return; }
    setDeletingId(null);
    if (editingId === deletingId) { setEditingId(null); }
    onChanged();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            className="relative bg-[var(--surface-card)] w-full max-w-3xl max-h-[88vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col">
            <div className="p-7 border-b border-[var(--border-default)] flex items-center justify-between gap-3">
              <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight uppercase flex items-center gap-3">
                <LayoutTemplate className="text-[var(--accent-text)]" size={24} /> Modelos de Ciclo
              </h3>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--surface-pill)] text-[var(--text-tertiary)]"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-7 space-y-6">
              {!editing && (
                <>
                  <button onClick={startNew} className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] text-xs font-black uppercase tracking-widest transition-colors">
                    <Plus size={16} /> Novo Modelo
                  </button>
                  {templates.length > 0 && (
                    <div className="divide-y divide-[var(--border-default)] rounded-2xl border border-[var(--border-default)] overflow-hidden">
                      {templates.map(t => (
                        <div key={t.id} className="flex items-center justify-between gap-3 p-4 hover:bg-[var(--surface-pill)]/40">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[var(--text-primary)] truncate">{t.name}</p>
                            <p className="text-[10px] text-[var(--text-tertiary)]">{t.stages.length} etapa(s){!t.isActive && ' — inativo'}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => startEdit(t)} className="p-2 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]"><Pencil size={13} /></button>
                            <button onClick={() => setDeletingId(t.id)} className="p-2 rounded-lg border border-[var(--border-default)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)]"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {templates.length === 0 && <p className="text-sm text-[var(--text-tertiary)] text-center py-6">Nenhum modelo cadastrado ainda.</p>}
                </>
              )}

              {editing && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Nome do modelo</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Ciclo Padrão de Hotfix"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--accent)]/20" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Descrição</label>
                    <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Opcional"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-3 text-sm font-medium outline-none" />
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase text-[var(--text-tertiary)] tracking-widest">Etapas (em ordem)</label>
                      <button onClick={() => setStages(prev => [...prev, { ...BLANK_STAGE }])} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)]">
                        <Plus size={13} /> Etapa
                      </button>
                    </div>
                    {stages.map((s, i) => (
                      <div key={i} className="rounded-2xl border border-[var(--border-default)] p-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <input type="color" value={s.color} onChange={e => updateStage(i, { color: e.target.value })} className="w-9 h-9 rounded-lg border border-[var(--border-default)] shrink-0 cursor-pointer" />
                          <input value={s.name} onChange={e => updateStage(i, { name: e.target.value })} placeholder={`Etapa ${i + 1}`}
                            className="flex-1 bg-[var(--surface-pill)] rounded-lg px-3 py-2 text-sm font-bold outline-none" />
                          <button onClick={() => moveStage(i, -1)} disabled={i === 0} className="p-1.5 rounded-lg border border-[var(--border-default)] disabled:opacity-30"><ArrowUp size={13} /></button>
                          <button onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} className="p-1.5 rounded-lg border border-[var(--border-default)] disabled:opacity-30"><ArrowDown size={13} /></button>
                          <button onClick={() => removeStage(i)} className="p-1.5 rounded-lg border border-[var(--border-default)] text-[var(--text-danger)]"><Trash2 size={13} /></button>
                        </div>
                        <input value={s.description} onChange={e => updateStage(i, { description: e.target.value })} placeholder="Descrição desta etapa (opcional)"
                          className="w-full bg-[var(--surface-pill)] rounded-lg px-3 py-2 text-xs font-medium outline-none" />
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Começa (dias da âncora)</label>
                            <input type="number" value={s.offsetStartDays} onChange={e => updateStage(i, { offsetStartDays: Number(e.target.value) })}
                              className="w-full bg-[var(--surface-pill)] rounded-lg px-3 py-2 text-sm font-bold outline-none" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-bold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Termina (dias da âncora)</label>
                            <input type="number" value={s.offsetEndDays} onChange={e => updateStage(i, { offsetEndDays: Number(e.target.value) })}
                              className="w-full bg-[var(--surface-pill)] rounded-lg px-3 py-2 text-sm font-bold outline-none" />
                          </div>
                        </div>
                        <p className="text-[9px] text-[var(--text-tertiary)]">Começo = fim: etapa-marco (1 dia só). Deslocamento pode ser negativo (antes da âncora).</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <StyledSelect value={s.defaultTeamId} onChange={e => updateStage(i, { defaultTeamId: e.target.value })}
                            className="w-full bg-[var(--surface-pill)] rounded-lg px-3 py-2 text-xs font-bold outline-none appearance-none">
                            <option value="">Sem equipe padrão</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </StyledSelect>
                          <MultiSelectFilter
                            options={users.map(u => ({ value: u.id, label: u.name }))}
                            selected={s.defaultResponsibleIds}
                            onChange={(v) => updateStage(i, { defaultResponsibleIds: v })}
                            allLabel="Sem responsáveis padrão"
                            itemLabelPlural="pessoas"
                            className="w-full text-xs"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={() => { setEditingId(null); setIsNew(false); }} className="px-6 py-3 rounded-xl text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
                      Cancelar
                    </button>
                    <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-[var(--accent)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] disabled:opacity-50">
                      Salvar Modelo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="Excluir modelo"
        description="Ciclos já criados a partir deste modelo não são afetados — só o modelo em si é removido."
        confirmLabel="Excluir"
        variant="danger"
      />
    </AnimatePresence>
  );
}
