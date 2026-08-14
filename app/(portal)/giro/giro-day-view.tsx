'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, CalendarDays, RotateCcw, Download, Trash2,
  CheckCircle2, GripVertical, Mail, MailX, Lock, Loader2, History, UserPlus, X, Check
} from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/user-avatar';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { StyledSelect } from '@/components/styled-select';
import { GIRO_SERVICE_TYPES, GIRO_LUNCH_SLOTS, GiroChecklistItem, GiroDay, GiroRow, GiroServiceType } from '@/lib/types';
import {
  getGiroDay, getGiroConfig, updateGiroRow, completeGiroService, reorderGiro,
  addGiroMember, removeGiroMember, setGiroHandoff, reprocessGiro, deleteGiroHistory,
  giroExportUrl, GiroCandidate
} from '@/lib/services/giro-client';

// -------------------------------------------------------------- datas (pt-BR)

/** AAAA-MM-DD -> DD/MM/AAAA. Tudo que o usuário lê usa o formato brasileiro. */
function toBr(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Aritmética de calendário sobre a data já ancorada em UTC — nunca `new Date()`
 * local, que muda de dia conforme o fuso de quem está olhando.
 */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayLabel(iso: string): string {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return dias[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

// ------------------------------------------------------------------ cores

const TYPE_STYLE: Record<GiroServiceType, string> = {
  'Chamado': 'text-[var(--accent-text)]',
  'Telefone': 'text-[var(--text-success)]',
  'Almoço': 'text-[var(--text-warning)]',
  'Ausente': 'text-[var(--text-danger)]'
};

interface GiroDayViewProps {
  canManage: boolean;
}

export function GiroDayView({ canManage }: GiroDayViewProps) {
  // `null` até a primeira resposta: quem define a data de hoje é o servidor.
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<GiroDay | null>(null);
  const [checklistItems, setChecklistItems] = useState<GiroChecklistItem[]>([]);
  const [candidates, setCandidates] = useState<GiroCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  // Seleção múltipla no modal "Incluir": marca vários antes de salvar tudo
  // de uma vez, em vez de uma chamada (e um recarregamento da tela) por
  // pessoa. Zera sempre que o modal fecha, pra não sobrar marcação de uma
  // sessão anterior na próxima vez que abrir.
  const [selectedNewMembers, setSelectedNewMembers] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [exportStart, setExportStart] = useState('');
  const [exportEnd, setExportEnd] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<GiroRow | null>(null);
  const [confirmHistory, setConfirmHistory] = useState<string | null>(null);

  const readOnly = !!day?.isReadOnly;

  // Sensor do dnd-kit no topo do componente: a lista arrastável está dentro de
  // um ramo condicional do JSX, e criar o sensor lá dentro chamaria um hook em
  // ordem variável entre renders.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const load = useCallback(async (targetDate?: string) => {
    setLoading(true);
    const result = await getGiroDay(targetDate);
    if ('error' in result) {
      toast.error(result.error);
      setLoading(false);
      return;
    }
    setDay(result);
    setDate(result.date);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Itens do checklist e candidatos mudam muito pouco — uma carga só, junto
    // da primeira abertura, em vez de a cada troca de data.
    getGiroConfig().then(cfg => {
      if ('error' in cfg) return;
      setChecklistItems(cfg.checklistItems.filter(i => i.isActive));
      setCandidates(cfg.candidates);
    });
  }, [load]);

  const goTo = (targetDate: string) => load(targetDate);

  // ------------------------------------------------------------- mutações

  /**
   * Toda ação segue o mesmo ciclo: trava a tela, executa, recarrega o dia. O
   * recarregamento não é preguiça de atualizar o estado local — concluir um
   * atendimento muda a ordem inteira e o histórico ao mesmo tempo, e remontar
   * isso na mão daria margem para a tela discordar do banco.
   */
  const run = async (fn: () => Promise<{ error?: string }>, successMessage?: string) => {
    setBusy(true);
    const result = await fn();
    if (result.error) {
      toast.error(result.error);
      setBusy(false);
      // Recarrega mesmo em erro: 409 quase sempre significa tela desatualizada.
      await load(date ?? undefined);
      return false;
    }
    if (successMessage) toast.success(successMessage);
    await load(date ?? undefined);
    setBusy(false);
    return true;
  };

  const handleComplete = (row: GiroRow) =>
    run(() => completeGiroService(row.id), `Atendimento de ${row.userName} concluído.`);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !day) return;
    const oldIndex = day.rows.findIndex(r => r.id === active.id);
    const newIndex = day.rows.findIndex(r => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(day.rows, oldIndex, newIndex);
    // Atualização otimista só da ordem: sem isso a linha "volta" para o lugar
    // antigo por um instante enquanto o servidor responde, e o arrastar fica
    // com cara de que não funcionou.
    setDay({ ...day, rows: reordered.map((r, i) => ({ ...r, position: i + 1 })) });
    await run(() => reorderGiro(day.id, reordered.map(r => r.id)));
  };

  const availableCandidates = useMemo(() => {
    const inDay = new Set(day?.rows.map(r => r.userId) || []);
    const term = memberSearch.trim().toLowerCase();
    return candidates
      .filter(c => !inDay.has(c.id))
      .filter(c => !term || c.name.toLowerCase().includes(term));
  }, [candidates, day, memberSearch]);

  const closeAddMember = () => {
    setShowAddMember(false);
    setSelectedNewMembers(new Set());
    setMemberSearch('');
  };

  const toggleSelectedNewMember = (id: string) => {
    setSelectedNewMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /**
   * Confirma a inclusão de todo mundo marcado, de uma vez. As chamadas vão
   * uma de cada vez (não Promise.all): addMemberToDay calcula a posição como
   * MAX(position)+1 lendo o banco — em paralelo, duas inclusões poderiam ler
   * o mesmo máximo antes de qualquer uma comitar e nascerem na mesma posição.
   * Uma pessoa que falhar (ex.: já foi incluída por outra aba enquanto o
   * modal estava aberto) não impede as demais.
   */
  const handleConfirmAddMembers = async () => {
    if (!date || selectedNewMembers.size === 0) return;
    setBusy(true);
    const ids = Array.from(selectedNewMembers);
    let successCount = 0;
    const failedNames: string[] = [];
    for (const id of ids) {
      const result = await addGiroMember(date, id);
      if (result.error) {
        failedNames.push(candidates.find(c => c.id === id)?.name || id);
      } else {
        successCount++;
      }
    }
    if (successCount > 0) {
      toast.success(successCount === 1 ? '1 pessoa incluída no Giro de hoje.' : `${successCount} pessoas incluídas no Giro de hoje.`);
    }
    if (failedNames.length > 0) {
      toast.error(`Não foi possível incluir: ${failedNames.join(', ')}.`);
    }
    await load(date);
    setBusy(false);
    closeAddMember();
  };

  // --------------------------------------------------------------- render

  if (loading && !day) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--text-tertiary)]">
        <Loader2 className="animate-spin mr-2" size={18} /> Carregando o Giro...
      </div>
    );
  }

  const handoffRow = day?.rows.find(r => r.isHandoff);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ barra de navegação */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-5 shadow-sm flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => date && goTo(addDays(date, -1))}
            className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
            title="Dia anterior"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="min-w-[190px] text-center">
            <p className="text-lg font-black text-[var(--text-primary)] tracking-tight">{date ? toBr(date) : '--/--/----'}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
              {date ? weekdayLabel(date) : ''}{readOnly && ' · somente leitura'}
            </p>
          </div>

          <button
            onClick={() => date && goTo(addDays(date, 1))}
            className="p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
            title="Próximo dia"
          >
            <ChevronRight size={18} />
          </button>

          <label className="relative p-2 rounded-xl border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all cursor-pointer" title="Escolher data">
            <CalendarDays size={18} />
            <input
              type="date"
              value={date ?? ''}
              onChange={e => e.target.value && goTo(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>

          <button
            onClick={() => load()}
            className="px-3 py-2 rounded-xl border border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-all"
          >
            Hoje
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="px-4 py-2 rounded-xl bg-[var(--surface-pill)] border border-[var(--border-default)] flex items-center gap-2" title="Quem recebe a passagem de turno por e-mail">
            <Mail size={13} className={cn(handoffRow ? 'text-[var(--accent-text)]' : 'text-[var(--text-tertiary)]')} />
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
              Passagem: <span className="text-[var(--text-primary)]">{handoffRow?.userName || 'Sem responsável'}</span>
            </span>
          </div>

          <button
            onClick={() => setShowExport(true)}
            className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-all flex items-center gap-2"
          >
            <Download size={13} /> Exportar
          </button>

          {canManage && !readOnly && (
            <>
              <button
                onClick={() => setShowAddMember(true)}
                disabled={busy}
                className="px-4 py-2 rounded-xl border border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-pill)] transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <UserPlus size={13} /> Incluir
              </button>
              <button
                onClick={() => date && run(() => reprocessGiro(date), 'Giro reprocessado.')}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2 disabled:opacity-50"
                title="Reaplica posições fixas, ausências e participantes novos"
              >
                <RotateCcw size={13} /> Reprocessar
              </button>
            </>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="px-5 py-3 rounded-2xl bg-[var(--surface-pill)] border border-[var(--border-default)] flex items-center gap-3">
          <Lock size={15} className="text-[var(--text-tertiary)] shrink-0" />
          <p className="text-[11px] font-bold text-[var(--text-tertiary)]">
            Este dia já passou: a consulta é livre, mas nada aqui pode ser alterado.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------ ordem do dia */}
      {!day?.exists || day.rows.length === 0 ? (
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-16 text-center">
          <CalendarDays size={40} className="mx-auto text-[var(--text-tertiary)] mb-4 opacity-50" />
          <p className="text-sm font-black uppercase tracking-tight text-[var(--text-secondary)]">
            {readOnly ? 'Não houve Giro nesta data' : 'Nenhum participante no Giro de hoje'}
          </p>
          <p className="text-[11px] font-medium text-[var(--text-tertiary)] mt-2">
            {readOnly
              ? 'Datas passadas nunca são geradas — o que aparece aqui é só o que existiu no dia.'
              : canManage
                ? 'Cadastre quem participa do rodízio na aba Configuração e reprocesse este dia.'
                : 'Peça a quem administra o Giro para cadastrar os participantes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Cabeçalho de colunas — só a partir de telas largas, onde a linha
              vira mesmo uma única fileira e o rótulo faz sentido acompanhar. */}
          <div className="hidden lg:flex items-center gap-2.5 px-3 text-[8px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
            <span className="w-[14px]" />
            <span className="w-7 text-center">#</span>
            <span className="w-[26px]" />
            <span className="w-[170px]">Analista</span>
            {checklistItems.length > 0 && (
              <span className="shrink-0" style={{ width: `${checklistItems.length * 32}px` }}>Checklist</span>
            )}
            <span className="w-[92px] shrink-0">Almoço</span>
            <span className="w-[130px] shrink-0">Atendimento</span>
            <span className="w-[90px] shrink-0">Hora</span>
            <span className="flex-1">Observações</span>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={day.rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {day.rows.map(row => (
                <GiroRowCard
                  key={row.id}
                  row={row}
                  dayId={day.id}
                  checklistItems={checklistItems}
                  canManage={canManage}
                  readOnly={readOnly}
                  busy={busy}
                  onComplete={() => handleComplete(row)}
                  onRemove={() => setConfirmRemove(row)}
                  onPinHandoff={() => run(
                    () => row.isHandoff
                      ? setGiroHandoff(day.id, 'none')
                      : setGiroHandoff(day.id, 'pinned', row.userId),
                    row.isHandoff ? 'Passagem removida: o dia fica sem responsável.' : `Passagem fixada em ${row.userName}.`
                  )}
                  onSaved={() => load(date ?? undefined)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {canManage && !readOnly && day?.exists && day.handoffMode !== 'auto' && (
        <button
          onClick={() => run(() => setGiroHandoff(day.id, 'auto'), 'Passagem voltou ao cálculo automático.')}
          className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)] hover:text-[var(--accent-hover)] transition-colors"
        >
          Voltar a passagem para o cálculo automático
        </button>
      )}

      {/* --------------------------------------------------------- histórico */}
      {day?.exists && (
        <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-5">
          <div className="flex items-center gap-2">
            <History size={20} className="text-[var(--accent-text)]" />
            <h3 className="text-lg font-black text-[var(--text-primary)] uppercase tracking-tight">Atendimentos concluídos</h3>
            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] ml-1">
              {day.history.length}
            </span>
          </div>

          {day.history.length === 0 ? (
            <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic">
              Nenhum atendimento concluído neste dia até agora.
            </p>
          ) : (
            <div className="space-y-2">
              {day.history.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-pill)]/40">
                  <span className="px-2.5 py-1 rounded-lg bg-[var(--surface-card)] border border-[var(--border-default)] text-[10px] font-black tabular-nums text-[var(--text-secondary)]">
                    {entry.serviceTime || '--:--'}
                  </span>
                  <span className="text-xs font-black text-[var(--text-primary)] truncate">{entry.userName}</span>
                  <span className={cn('text-[10px] font-black uppercase tracking-widest', TYPE_STYLE[entry.serviceType])}>
                    {entry.serviceType}
                  </span>
                  {entry.note && (
                    <span className="text-[11px] font-medium text-[var(--text-tertiary)] truncate flex-1">{entry.note}</span>
                  )}
                  {canManage && !readOnly && (
                    <button
                      onClick={() => setConfirmHistory(entry.id)}
                      disabled={busy}
                      className="ml-auto p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all shrink-0 disabled:opacity-50"
                      title="Excluir registro"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ modal incluir */}
      <AnimatePresence>
        {showAddMember && day && date && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeAddMember}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 16 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="px-7 py-5 border-b border-[var(--border-default)] flex items-center justify-between shrink-0">
                <h3 className="text-base font-black uppercase tracking-tight text-[var(--text-primary)]">Incluir no Giro de hoje</h3>
                <button onClick={closeAddMember} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3 overflow-y-auto">
                <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
                  Marque quantas pessoas quiser e confirme no fim — todas entram no fim da ordem de uma vez.
                  Quem ainda não participava do rodízio passa a participar das próximas gerações automaticamente.
                </p>
                <input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Buscar pessoa..."
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <div className="max-h-[300px] overflow-y-auto space-y-1.5">
                  {availableCandidates.length === 0 ? (
                    <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic py-6 text-center">
                      Todo mundo do time já está no Giro de hoje.
                    </p>
                  ) : availableCandidates.map(candidate => {
                    const selected = selectedNewMembers.has(candidate.id);
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => toggleSelectedNewMember(candidate.id)}
                        disabled={busy}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-2xl border transition-all text-left disabled:opacity-50',
                          selected
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border-default)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5'
                        )}
                      >
                        <UserAvatar name={candidate.name} thumbUrl={candidate.avatarThumbUrl} url={candidate.avatarUrl} size={28} />
                        <div className="min-w-0">
                          <p className="text-xs font-black text-[var(--text-primary)] truncate">{candidate.name}</p>
                          <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">{candidate.role}</p>
                        </div>
                        <span className={cn(
                          'ml-auto w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all',
                          selected ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border-default)] text-transparent'
                        )}>
                          <Check size={13} strokeWidth={3} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {availableCandidates.length > 0 && (
                <div className="px-5 py-4 border-t border-[var(--border-default)] flex items-center justify-between gap-3 shrink-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
                    {selectedNewMembers.size === 0
                      ? 'Nenhuma selecionada'
                      : selectedNewMembers.size === 1 ? '1 selecionada' : `${selectedNewMembers.size} selecionadas`}
                  </span>
                  <button
                    onClick={handleConfirmAddMembers}
                    disabled={busy || selectedNewMembers.size === 0}
                    className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all disabled:opacity-50 flex items-center gap-2 shrink-0"
                  >
                    <UserPlus size={14} /> Incluir {selectedNewMembers.size > 0 ? selectedNewMembers.size : ''}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------ modal exportar */}
      <AnimatePresence>
        {showExport && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowExport(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 16 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="px-7 py-5 border-b border-[var(--border-default)] flex items-center justify-between">
                <h3 className="text-base font-black uppercase tracking-tight text-[var(--text-primary)]">Exportar período</h3>
                <button onClick={() => setShowExport(false)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-7 space-y-5">
                <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
                  Sai um arquivo CSV com uma linha por analista por dia: posição, passagem de turno,
                  horário de trabalho, atendimento, observação, almoço, checklist e os atendimentos concluídos.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">De</span>
                    <input
                      type="date" value={exportStart} onChange={e => setExportStart(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Até</span>
                    <input
                      type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] text-xs font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>
                <a
                  href={exportStart && exportEnd ? giroExportUrl(exportStart, exportEnd) : undefined}
                  onClick={e => {
                    if (!exportStart || !exportEnd) { e.preventDefault(); toast.error('Informe as duas datas.'); return; }
                    if (exportStart > exportEnd) { e.preventDefault(); toast.error('A data inicial não pode ser maior que a final.'); return; }
                    setShowExport(false);
                  }}
                  className="w-full px-6 py-3.5 rounded-2xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2"
                >
                  <Download size={14} /> Baixar CSV
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove && day) run(() => removeGiroMember(day.id, confirmRemove.id), `${confirmRemove.userName} saiu do Giro de hoje.`);
        }}
        title="Remover do Giro deste dia?"
        description={`${confirmRemove?.userName ?? ''} sai apenas da ordem de hoje. Amanhã ele volta pela geração automática, a menos que esteja marcado como "fora do rodízio" na configuração.`}
        confirmLabel="Remover do dia"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmHistory}
        onClose={() => setConfirmHistory(null)}
        onConfirm={() => {
          if (confirmHistory) run(() => deleteGiroHistory(confirmHistory), 'Registro excluído.');
        }}
        title="Excluir registro do histórico?"
        description="Se o analista estiver na última posição da ordem, ele volta para a primeira. Em qualquer outra posição, a ordem não muda."
        confirmLabel="Excluir registro"
        variant="danger"
      />
    </div>
  );
}

// ==========================================================================
// Linha do Giro
// ==========================================================================

interface GiroRowCardProps {
  row: GiroRow;
  dayId: string;
  checklistItems: GiroChecklistItem[];
  canManage: boolean;
  readOnly: boolean;
  busy: boolean;
  onComplete: () => void;
  onRemove: () => void;
  onPinHandoff: () => void;
  onSaved: () => void;
}

function GiroRowCard({
  row, checklistItems, canManage, readOnly, busy, onComplete, onRemove, onPinHandoff, onSaved
}: GiroRowCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canManage || readOnly
  });

  // A observação é o único campo digitado letra a letra: mantê-la em estado
  // local e salvar no blur evita uma requisição por tecla. Os demais campos
  // são escolhas discretas e salvam na hora.
  const [note, setNote] = useState(row.note ?? '');
  const [time, setTime] = useState(row.serviceTime ?? '');
  const noteRef = useRef(row.note ?? '');

  useEffect(() => {
    setNote(row.note ?? '');
    noteRef.current = row.note ?? '';
    setTime(row.serviceTime ?? '');
  }, [row.note, row.serviceTime, row.id]);

  const save = async (patch: Parameters<typeof updateGiroRow>[1]) => {
    const result = await updateGiroRow(row.id, patch);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    onSaved();
  };

  const editable = !readOnly;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border bg-[var(--surface-card)] transition-all',
        row.isHandoff ? 'border-[var(--accent)]/40' : 'border-[var(--border-default)]',
        isDragging && 'opacity-60 shadow-lg'
      )}
    >
      <div className="px-3 py-2 flex flex-wrap lg:flex-nowrap items-center gap-2.5">
        {canManage && !readOnly ? (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing shrink-0"
            title="Arrastar para reordenar"
          >
            <GripVertical size={14} />
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}

        <span className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black tabular-nums shrink-0',
          row.position === 1
            ? 'bg-[var(--accent)] text-white'
            : 'bg-[var(--surface-pill)] text-[var(--text-secondary)] border border-[var(--border-default)]'
        )}>
          {row.position}
        </span>

        <UserAvatar name={row.userName} thumbUrl={row.avatarThumbUrl} url={row.avatarUrl} size={26} />

        <div className="min-w-0 w-[170px] shrink-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] font-black text-[var(--text-primary)] truncate">{row.userName}</p>
            {row.isHandoff && (
              <span title="Responsável pela passagem de turno por e-mail" className="shrink-0">
                <Mail size={11} className="text-[var(--accent-text)]" />
              </span>
            )}
          </div>
          <p className="text-[8px] font-black uppercase tracking-widest text-[var(--text-tertiary)] truncate">
            {row.isFixed ? `${row.position}º fixo` : (row.workSchedule || 'sem horário')}
          </p>
        </div>

        {/* checklist: ícone + nome do item embaixo, em fonte minúscula — não
            dá pra saber o que cada quadradinho significa só de olhar, então o
            nome fica sempre visível, não só na dica ao passar o mouse. */}
        {checklistItems.length > 0 && (
          <div className="flex items-start gap-1 shrink-0">
            {checklistItems.map(item => {
              const checked = !!row.checklist?.[item.id];
              return (
                <button
                  key={item.id}
                  disabled={!editable || busy}
                  onClick={() => save({ checklist: { ...(row.checklist || {}), [item.id]: !checked } })}
                  title={item.label}
                  className="flex flex-col items-center gap-0.5 shrink-0 disabled:opacity-60"
                >
                  <span className={cn(
                    'w-5 h-5 rounded-md border flex items-center justify-center transition-all',
                    checked
                      ? 'bg-[var(--text-success)]/15 border-[var(--text-success)]/40 text-[var(--text-success)]'
                      : 'border-[var(--border-default)] text-transparent hover:border-[var(--accent)]'
                  )}>
                    {checked && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="text-[6px] font-bold uppercase tracking-tighter leading-none text-[var(--text-tertiary)] max-w-[28px] truncate">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="w-[92px] shrink-0">
          <StyledSelect
            value={row.lunchTime ?? ''}
            disabled={!editable || busy}
            onChange={e => save({ lunchTime: e.target.value || null })}
            className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]"
          >
            <option value="">--:--</option>
            {GIRO_LUNCH_SLOTS.map(slot => (
              <option key={slot} value={slot}>{slot}</option>
            ))}
          </StyledSelect>
        </div>

        <div className="w-[130px] shrink-0">
          <StyledSelect
            value={row.serviceType}
            disabled={!editable || busy}
            onChange={e => save({ serviceType: e.target.value as GiroServiceType })}
            className={cn('text-[9px] font-black uppercase tracking-widest', TYPE_STYLE[row.serviceType])}
          >
            {GIRO_SERVICE_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </StyledSelect>
        </div>

        <input
          type="time"
          value={time}
          disabled={!editable || busy}
          onChange={e => setTime(e.target.value)}
          onBlur={() => { if ((row.serviceTime ?? '') !== time) save({ serviceTime: time || null }); }}
          className="w-[90px] px-2 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] text-[11px] font-bold tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60 shrink-0"
          title="Hora do atendimento"
        />

        <input
          value={note}
          disabled={!editable || busy}
          onChange={e => setNote(e.target.value)}
          onBlur={() => { if (noteRef.current !== note) { noteRef.current = note; save({ note: note || null }); } }}
          placeholder="Observação..."
          className="flex-1 min-w-[100px] px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] text-[11px] font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
        />

        {/* ações */}
        <div className="flex items-center gap-1 shrink-0 ml-auto lg:ml-0">
          {editable && (
            <button
              onClick={onComplete}
              disabled={busy}
              className="p-1.5 rounded-lg bg-[var(--text-success)]/10 text-[var(--text-success)] hover:bg-[var(--text-success)]/20 transition-all disabled:opacity-50"
              title="Concluir: grava no histórico, limpa a linha e manda para o fim da ordem"
            >
              <CheckCircle2 size={14} />
            </button>
          )}
          {canManage && editable && (
            <>
              <button
                onClick={onPinHandoff}
                disabled={busy}
                className={cn(
                  'p-1.5 rounded-lg transition-all disabled:opacity-50',
                  row.isHandoff
                    ? 'text-[var(--accent-text)] bg-[var(--accent)]/10'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10'
                )}
                title={row.isHandoff ? 'Remover a passagem de turno (dia fica sem responsável)' : 'Designar esta pessoa para a passagem de turno por e-mail'}
              >
                {row.isHandoff ? <MailX size={14} /> : <Mail size={14} />}
              </button>
              <button
                onClick={onRemove}
                disabled={busy}
                className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all disabled:opacity-50"
                title="Remover do Giro deste dia"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
