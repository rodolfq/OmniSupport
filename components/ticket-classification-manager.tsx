'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Gauge, Target } from 'lucide-react';
import { EffortConfig, OutcomeConfig, UserRole } from '@/lib/types';
import { ConfigService } from '@/lib/services/config-service';
import { useApp } from '@/app/app-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EditableLabel } from '@/components/editable-label';
import { toast } from 'sonner';

// Configuração das duas listas de classificação da solução do TICKET INTERNO
// (ver migrations/internal_ticket_effort_outcome.sql). Mesmo padrão do
// TagManager: componente autocontido, carrega e grava pelo ConfigService.
//
// Por que duas listas e não uma: "Esforço" responde quanto custou resolver,
// "Desfecho" responde qual foi a natureza da solução. Um ticket trivial pode
// exigir ação e um complexo pode terminar sem alteração nenhuma — num campo só
// as duas dimensões brigam e o dado sai inconsistente.

export function TicketClassificationManager() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === UserRole.ADMIN;

  const [efforts, setEfforts] = useState<EffortConfig[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [newEffortLabel, setNewEffortLabel] = useState('');
  const [newEffortWeight, setNewEffortWeight] = useState('1');
  const [newOutcomeLabel, setNewOutcomeLabel] = useState('');
  const [newOutcomeIsDefect, setNewOutcomeIsDefect] = useState(false);

  const [deleting, setDeleting] = useState<{ kind: 'effort' | 'outcome'; id: string; label: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [e, o] = await Promise.all([ConfigService.getEfforts(), ConfigService.getOutcomes()]);
        setEfforts(e);
        setOutcomes(o);
      } catch {
        toast.error('Erro ao carregar a classificação de chamados.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAddEffort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return toast.error('Apenas administradores podem editar esta lista.');
    const label = newEffortLabel.trim();
    if (!label) return;
    const weight = Number(newEffortWeight.replace(',', '.'));
    if (!Number.isFinite(weight) || weight <= 0) return toast.error('O peso deve ser um número maior que zero.');

    try {
      const saved = await ConfigService.saveEffort({
        label,
        weight,
        sortOrder: efforts.length + 1
      });
      setEfforts([...efforts, saved]);
      setNewEffortLabel('');
      setNewEffortWeight('1');
      toast.success('Nível de esforço criado.');
    } catch {
      toast.error('Erro ao criar nível de esforço.');
    }
  };

  const handleUpdateWeight = async (effort: EffortConfig, rawWeight: string) => {
    const weight = Number(rawWeight.replace(',', '.'));
    if (!Number.isFinite(weight) || weight <= 0 || weight === effort.weight) return;
    try {
      const saved = await ConfigService.saveEffort({ ...effort, weight });
      setEfforts(efforts.map(e => (e.id === saved.id ? saved : e)));
      toast.success('Peso atualizado.');
    } catch {
      toast.error('Erro ao atualizar o peso.');
    }
  };

  // Renomear é seguro nas duas listas: o ticket interno aponta pra elas por id
  // (effort_id/outcome_id), então o vínculo sobrevive à troca do rótulo. E o
  // "conta como defeito" é uma coluna própria, não o texto — por isso renomear
  // "Bug" não desmonta a taxa de defeito do relatório.
  const handleRenameEffort = async (effort: EffortConfig, label: string) => {
    try {
      const saved = await ConfigService.saveEffort({ ...effort, label });
      setEfforts(efforts.map(e => (e.id === saved.id ? saved : e)));
      toast.success('Nome atualizado.');
    } catch {
      toast.error('Erro ao renomear — talvez já exista um item com esse nome.');
      throw new Error('rename failed');
    }
  };

  const handleRenameOutcome = async (outcome: OutcomeConfig, label: string) => {
    try {
      const saved = await ConfigService.saveOutcome({ ...outcome, label });
      setOutcomes(outcomes.map(o => (o.id === saved.id ? saved : o)));
      toast.success('Nome atualizado.');
    } catch {
      toast.error('Erro ao renomear — talvez já exista um item com esse nome.');
      throw new Error('rename failed');
    }
  };

  const handleAddOutcome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return toast.error('Apenas administradores podem editar esta lista.');
    const label = newOutcomeLabel.trim();
    if (!label) return;

    try {
      const saved = await ConfigService.saveOutcome({
        label,
        countsAsDefect: newOutcomeIsDefect,
        sortOrder: outcomes.length + 1
      });
      setOutcomes([...outcomes, saved]);
      setNewOutcomeLabel('');
      setNewOutcomeIsDefect(false);
      toast.success('Desfecho criado.');
    } catch {
      toast.error('Erro ao criar desfecho.');
    }
  };

  const handleToggleDefect = async (outcome: OutcomeConfig) => {
    if (!isAdmin) return;
    try {
      const saved = await ConfigService.saveOutcome({ ...outcome, countsAsDefect: !outcome.countsAsDefect });
      setOutcomes(outcomes.map(o => (o.id === saved.id ? saved : o)));
    } catch {
      toast.error('Erro ao atualizar o desfecho.');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      if (deleting.kind === 'effort') {
        await ConfigService.deleteEffort(deleting.id);
        setEfforts(efforts.filter(e => e.id !== deleting.id));
      } else {
        await ConfigService.deleteOutcome(deleting.id);
        setOutcomes(outcomes.filter(o => o.id !== deleting.id));
      }
      toast.success('Item removido.');
    } catch {
      toast.error('Erro ao remover o item.');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm">
        <p className="text-sm text-[var(--text-tertiary)]">Carregando classificação...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-8">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <Target className="text-[var(--accent-text)]" size={24} /> Classificação de Tickets Internos
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Preenchida na conclusão do ticket · base do relatório de Carga e Complexidade
          </p>
        </div>

        {/* ------------------------------------------------------ Esforço */}
        <section className="space-y-4">
          <div>
            <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Gauge size={16} className="text-[var(--accent-text)]" /> Esforço
            </h4>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Quanto custou resolver. O <b>peso</b> é o que torna a carga comparável entre analistas nos
              relatórios — dez chamados &quot;Imediato&quot; não representam o mesmo trabalho que dez &quot;Crítico&quot;.
            </p>
          </div>

          <div className="space-y-2">
            {efforts.map(effort => (
              <div key={effort.id} className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: effort.color }} />
                <EditableLabel
                  value={effort.label}
                  disabled={!isAdmin}
                  onSave={(next) => handleRenameEffort(effort, next)}
                  className="text-sm font-bold text-[var(--text-primary)]"
                />
                <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Peso</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  defaultValue={effort.weight}
                  disabled={!isAdmin}
                  onBlur={(e) => handleUpdateWeight(effort, e.target.value)}
                  className="w-20 px-2 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-sm font-bold text-right outline-none focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-50"
                />
                {isAdmin && (
                  <button
                    onClick={() => setDeleting({ kind: 'effort', id: effort.id, label: effort.label })}
                    className="p-2 rounded-lg text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all"
                    title="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <form onSubmit={handleAddEffort} className="flex flex-wrap gap-2">
              <input
                value={newEffortLabel}
                onChange={(e) => setNewEffortLabel(e.target.value)}
                placeholder="Novo nível de esforço"
                className="flex-1 min-w-[180px] px-4 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={newEffortWeight}
                onChange={(e) => setNewEffortWeight(e.target.value)}
                placeholder="Peso"
                className="w-24 px-4 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm text-right outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-[var(--accent-hover)] transition-all"
              >
                <Plus size={14} /> Adicionar
              </button>
            </form>
          )}
        </section>

        {/* ----------------------------------------------------- Desfecho */}
        <section className="space-y-4 pt-2 border-t border-[var(--border-default)]">
          <div className="pt-4">
            <h4 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
              <Target size={16} className="text-[var(--accent-text)]" /> Desfecho
            </h4>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Qual foi a natureza da solução. Marque <b>Defeito</b> nos desfechos que representam falha do
              produto — é o que alimenta a taxa de bug que chegou ao cliente, sem depender do rótulo continuar
              se chamando &quot;Bug&quot;.
            </p>
          </div>

          <div className="space-y-2">
            {outcomes.map(outcome => (
              <div key={outcome.id} className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: outcome.color }} />
                <EditableLabel
                  value={outcome.label}
                  disabled={!isAdmin}
                  onSave={(next) => handleRenameOutcome(outcome, next)}
                  className="text-sm font-bold text-[var(--text-primary)]"
                />
                <button
                  onClick={() => handleToggleDefect(outcome)}
                  disabled={!isAdmin}
                  className={[
                    'px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-60',
                    outcome.countsAsDefect
                      ? 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20'
                      : 'bg-[var(--surface-pill)] text-[var(--text-tertiary)] border-[var(--border-default)]'
                  ].join(' ')}
                  title={outcome.countsAsDefect ? 'Conta como defeito de produto' : 'Não conta como defeito'}
                >
                  {outcome.countsAsDefect ? 'Defeito' : 'Não é defeito'}
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setDeleting({ kind: 'outcome', id: outcome.id, label: outcome.label })}
                    className="p-2 rounded-lg text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all"
                    title="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {isAdmin && (
            <form onSubmit={handleAddOutcome} className="flex flex-wrap gap-2 items-center">
              <input
                value={newOutcomeLabel}
                onChange={(e) => setNewOutcomeLabel(e.target.value)}
                placeholder="Novo desfecho"
                className="flex-1 min-w-[180px] px-4 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              />
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] px-2">
                <input
                  type="checkbox"
                  checked={newOutcomeIsDefect}
                  onChange={(e) => setNewOutcomeIsDefect(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Conta como defeito
              </label>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 hover:bg-[var(--accent-hover)] transition-all"
              >
                <Plus size={14} /> Adicionar
              </button>
            </form>
          )}
        </section>
      </div>

      <ConfirmDialog
        isOpen={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Remover da classificação"
        description={
          `Remover "${deleting?.label}"? Os chamados já classificados com este item ficam sem classificação ` +
          `(não são apagados), e ele deixa de aparecer nos relatórios daqui pra frente.`
        }
        confirmLabel="Remover"
        variant="danger"
      />
    </div>
  );
}
