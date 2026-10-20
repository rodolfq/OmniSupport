'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, RotateCcw, Trash2, History as HistoryIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';
import { ReleaseCycle, ReleaseCycleStage, User } from '@/lib/types';
import {
  updateCycleStage, deleteCycleStage, completeCycleStage, reopenCycleStage, getCycleStageAudit, StageAuditEntry
} from '@/lib/services/queue-service';
import { InternalTeamRecord } from '@/lib/services/internal-team-service';
import { MultiSelectFilter } from '@/components/multi-select-filter';
import { StyledSelect } from '@/components/styled-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { computeBaseStageStatus, isLastStage, STAGE_STATUS_META, formatIsoDatePtBr } from '@/lib/release-stage-logic';
import { cn } from '@/lib/utils';

interface ReleaseStageDrawerProps {
  cycle: ReleaseCycle;
  stage: ReleaseCycleStage;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  teams: InternalTeamRecord[];
  users: User[];
  onChanged: () => void;
}

export function ReleaseStageDrawer({ cycle, stage, isOpen, onClose, canEdit, teams, users, onChanged }: ReleaseStageDrawerProps) {
  useEscapeToClose(isOpen, onClose);

  const [startDate, setStartDate] = useState(stage.startDate);
  const [endDate, setEndDate] = useState(stage.endDate);
  const [teamId, setTeamId] = useState(stage.teamId || '');
  const [responsibleIds, setResponsibleIds] = useState<string[]>(stage.responsibleIds || []);
  const [notes, setNotes] = useState(stage.notes || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCompleteLast, setConfirmCompleteLast] = useState(false);

  const [audit, setAudit] = useState<StageAuditEntry[]>([]);
  const [tab, setTab] = useState<'detalhes' | 'historico'>('detalhes');

  useEffect(() => {
    if (!isOpen) return;
    setStartDate(stage.startDate);
    setEndDate(stage.endDate);
    setTeamId(stage.teamId || '');
    setResponsibleIds(stage.responsibleIds || []);
    setNotes(stage.notes || '');
    setTab('detalhes');
    getCycleStageAudit(stage.id).then(setAudit);
  }, [isOpen, stage.id]);

  const locked = !!cycle.publishedAt;
  const status = computeBaseStageStatus(stage);
  const meta = STAGE_STATUS_META[status];
  const isLast = isLastStage({ stageOrder: stage.stageOrder }, cycle.stages);
  const pendingSiblings = cycle.stages.filter(s => s.id !== stage.id && !s.completedAt).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateCycleStage(stage.id, { startDate, endDate, teamId: teamId || null, responsibleIds, notes: notes || null });
      if (res.error) { toast.error(res.error); return; }
      toast.success('Etapa atualizada.');
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    // A última etapa (por ordem) trava o CICLO inteiro ao ser concluída —
    // ação sem volta pela tela. Confirma antes em vez de só avisar depois.
    if (!stage.completedAt && isLast) { setConfirmCompleteLast(true); return; }
    await runComplete();
  };

  const runComplete = async () => {
    const res = stage.completedAt ? await reopenCycleStage(stage.id) : await completeCycleStage(stage.id);
    if (res.error) { toast.error(res.error); return; }
    if (!stage.completedAt && (res as any).locked) {
      toast.success('Ciclo concluído — travado.');
    } else {
      toast.success(stage.completedAt ? 'Etapa reaberta.' : 'Etapa concluída.');
    }
    setConfirmCompleteLast(false);
    onChanged();
  };

  const handleDelete = async () => {
    const res = await deleteCycleStage(stage.id);
    if (res.error) { toast.error(res.error); return; }
    setConfirmDelete(false);
    onChanged();
    onClose();
  };

  const resolveUserName = (id: string) => users.find(u => u.id === id)?.name || 'Usuário removido';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex justify-end">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="relative w-full max-w-lg bg-[var(--surface-card)] h-full shadow-2xl flex flex-col"
          >
            <div className="p-6 border-b border-[var(--border-default)] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-1 truncate">{cycle.name}</p>
                <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight truncate">{stage.name}</h3>
                <span
                  className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest"
                  style={{ backgroundColor: meta.surfaceVar, color: meta.textVar }}
                >
                  {meta.label}
                </span>
                {locked && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Ciclo travado</span>}
              </div>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-[var(--surface-pill)] text-[var(--text-tertiary)] shrink-0">
                <X size={18} />
              </button>
            </div>

            <div className="flex border-b border-[var(--border-default)] px-6">
              {([['detalhes', 'Detalhes'], ['historico', 'Histórico']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn(
                    'px-3 py-3 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors',
                    tab === k ? 'border-[var(--accent)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {tab === 'detalhes' && (
                <>
                  {stage.description && <p className="text-sm text-[var(--text-secondary)] font-medium">{stage.description}</p>}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Início</label>
                      <input type="date" value={startDate} disabled={!canEdit || locked} onChange={e => setStartDate(e.target.value)}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Fim</label>
                      <input type="date" value={endDate} disabled={!canEdit || locked} onChange={e => setEndDate(e.target.value)}
                        className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60" />
                    </div>
                  </div>
                  {(stage.plannedStartDate !== stage.startDate || stage.plannedEndDate !== stage.endDate) && (
                    <p className="text-[10px] text-[var(--text-tertiary)] font-semibold">
                      Planejado originalmente: {formatIsoDatePtBr(stage.plannedStartDate)} a {formatIsoDatePtBr(stage.plannedEndDate)}
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Equipe responsável</label>
                    <StyledSelect value={teamId} disabled={!canEdit || locked} onChange={e => setTeamId(e.target.value)}
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-bold outline-none appearance-none disabled:opacity-60">
                      <option value="">Sem equipe</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </StyledSelect>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Pessoas responsáveis</label>
                    {canEdit && !locked ? (
                      <MultiSelectFilter
                        options={users.map(u => ({ value: u.id, label: u.name }))}
                        selected={responsibleIds}
                        onChange={setResponsibleIds}
                        allLabel="Nenhuma pessoa"
                        itemLabelPlural="pessoas"
                        className="w-full"
                      />
                    ) : (
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {responsibleIds.length === 0 ? 'Nenhuma' : responsibleIds.map(resolveUserName).join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Observação</label>
                    <textarea value={notes} disabled={!canEdit || locked} onChange={e => setNotes(e.target.value)}
                      placeholder="Anotação livre sobre esta etapa (ex.: por que atrasou)"
                      className="w-full bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-3 py-2.5 text-sm font-medium outline-none resize-none h-20 disabled:opacity-60" />
                  </div>

                  {canEdit && !locked && (
                    <div className="flex gap-2 pt-2">
                      <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 bg-[var(--accent)] text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] disabled:opacity-50">
                        Salvar
                      </button>
                      <button onClick={handleComplete}
                        title={!stage.completedAt && isLast ? 'Esta é a última etapa — concluir trava o ciclo inteiro' : undefined}
                        className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border border-[var(--text-success)]/30 bg-[var(--surface-success)] text-[var(--text-success)]">
                        {stage.completedAt ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
                        {stage.completedAt ? 'Reabrir' : isLast ? 'Concluir e Travar Ciclo' : 'Concluir'}
                      </button>
                      <button onClick={() => setConfirmDelete(true)} className="p-2.5 rounded-xl border border-[var(--border-default)] text-[var(--text-danger)] hover:bg-[var(--surface-danger)]">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  {locked && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] text-center pt-2">
                      Ciclo concluído — etapa travada, sem edição
                    </p>
                  )}
                </>
              )}

              {tab === 'historico' && (
                <div className="space-y-2">
                  {audit.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)]">Nenhuma alteração de data registrada ainda.</p>
                  ) : (
                    audit.map((a, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-xs">
                        <HistoryIcon size={13} className="text-[var(--text-tertiary)] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[var(--text-primary)]">
                            {a.actorName} {a.action === 'publish' ? 'concluiu o ciclo' : a.changes?.field === 'completedAt' ? (a.changes?.to ? 'concluiu a etapa' : 'reabriu a etapa') : 'alterou a data'}
                          </p>
                          {a.changes?.field === 'dates' && (
                            <p className="text-[var(--text-tertiary)]">
                              {formatIsoDatePtBr(a.changes.from.startDate)}–{formatIsoDatePtBr(a.changes.from.endDate)} → {formatIsoDatePtBr(a.changes.to.startDate)}–{formatIsoDatePtBr(a.changes.to.endDate)}
                            </p>
                          )}
                          <p className="text-[10px] text-[var(--text-tertiary)]">{a.createdAt ? new Date(a.createdAt).toLocaleString('pt-BR') : ''}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Excluir etapa"
        description={`Remover a etapa "${stage.name}"? Itens posicionados nela ficam sem etapa (não são apagados).`}
        confirmLabel="Excluir"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={confirmCompleteLast}
        onClose={() => setConfirmCompleteLast(false)}
        onConfirm={runComplete}
        title="Concluir e travar ciclo"
        description={
          pendingSiblings > 0
            ? `"${stage.name}" é a última etapa de "${cycle.name}". Concluí-la trava o ciclo inteiro — nenhuma etapa poderá mais ser editada, mesmo as ${pendingSiblings} que ainda não foram concluídas. Essa ação não pode ser desfeita pela tela.`
            : `"${stage.name}" é a última etapa de "${cycle.name}". Concluí-la trava o ciclo inteiro — nenhuma etapa poderá mais ser editada. Essa ação não pode ser desfeita pela tela.`
        }
        confirmLabel="Concluir e travar"
        variant="danger"
      />
    </AnimatePresence>
  );
}
