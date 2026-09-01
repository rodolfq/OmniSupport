'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Trash2, Loader2, Search, CalendarClock, ListChecks, Plus, Minus, X,
  CircleSlash, Clock, GripVertical, Info, Video, UtensilsCrossed
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
import { GiroChecklistItem, GiroLunchCapacity, GiroParticipant } from '@/lib/types';
import {
  getGiroConfig, saveGiroParticipant, deleteGiroParticipant, reorderGiroParticipants,
  saveGiroChecklistItem, deleteGiroChecklistItem, saveGiroMeetUrl,
  addGiroLunchSlot, removeGiroLunchSlot, GiroCandidate
} from '@/lib/services/giro-client';

/**
 * Configuração do Giro: quem participa do rodízio e o checklist do dia.
 *
 * Só é montada para quem tem giro:manage (ver page.tsx) — a API repete a
 * checagem, porque esconder o botão não é autorização.
 *
 * TODA mutação aqui é OTIMISTA: a tela muda na hora, a chamada de rede corre
 * em segundo plano, e só desfaz (com toast de erro) se o servidor recusar.
 * Antes, cada clique — até um toggle de "fora do rodízio" — esperava uma
 * volta completa (rede + reconsulta de participantes+checklist+candidatos
 * inteiros) pra mudar 1 pixel na tela; numa lista de dezenas de analistas
 * isso é visivelmente lento. `getGiroConfig()` agora só roda UMA vez, na
 * primeira carga — nenhuma ação recarrega a tela inteira.
 */

/** ISO do banco -> valor aceito por <input type="datetime-local">. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO -> DD/MM/AAAA HH:mm, formato brasileiro para leitura. */
function toBrDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ordinal no padrão brasileiro: 1º, 2º, 3º... */
function ordinal(n: number): string {
  return `${n}º`;
}

function computeIsAbsent(absentUntil: string | null): boolean {
  return !!absentUntil && new Date(absentUntil) > new Date();
}

export function GiroConfigView() {
  const [participants, setParticipants] = useState<GiroParticipant[]>([]);
  const [checklistItems, setChecklistItems] = useState<GiroChecklistItem[]>([]);
  const [candidates, setCandidates] = useState<GiroCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Quem está com uma chamada de rede em voo agora — chave é o userId do
  // participante, o id do item de checklist, ou o id do candidato sendo
  // adicionado. Só trava o CONTROLE daquela linha (evita clique duplo),
  // nunca a tela inteira: é o oposto do "busy" global de antes.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const markPending = (id: string, pending: boolean) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      if (pending) next.add(id); else next.delete(id);
      return next;
    });
  };

  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<GiroParticipant | null>(null);
  const [absenceTarget, setAbsenceTarget] = useState<GiroParticipant | null>(null);
  const [absenceUntil, setAbsenceUntil] = useState('');
  const [absenceNote, setAbsenceNote] = useState('');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<GiroChecklistItem | null>(null);

  const [meetUrl, setMeetUrl] = useState('');
  const [meetSaving, setMeetSaving] = useState(false);

  const [lunchCapacity, setLunchCapacity] = useState<GiroLunchCapacity[]>([]);
  const [newLunchTime, setNewLunchTime] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Única leitura completa da tela — só na primeira montagem. Nenhuma
  // mutação chama isto de novo (ver o porquê no comentário do topo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = await getGiroConfig();
      if (cancelled) return;
      if ('error' in cfg) {
        toast.error(cfg.error);
        setLoading(false);
        return;
      }
      setParticipants(cfg.participants);
      setChecklistItems(cfg.checklistItems);
      setCandidates(cfg.candidates);
      setMeetUrl(cfg.meetUrl ?? '');
      setLunchCapacity(cfg.lunchCapacity);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Três grupos: posição fixa (ordinal escolhido à mão), livres (ordem
  // PROGRAMADA — a lista arrastável) e fora do rodízio (não contam pra nada).
  const fixedList = useMemo(
    () => participants.filter(p => p.positionType === 'fixed' && !p.outOfRotation)
      .sort((a, b) => (a.fixedPosition ?? 0) - (b.fixedPosition ?? 0)),
    [participants]
  );
  const freeList = useMemo(
    () => participants.filter(p => p.positionType === 'free' && !p.outOfRotation),
    [participants]
  );
  const oorList = useMemo(() => participants.filter(p => p.outOfRotation), [participants]);
  const totalActive = fixedList.length + freeList.length;

  const term = search.trim().toLowerCase();
  const matches = useCallback((p: GiroParticipant) => !term || p.name.toLowerCase().includes(term), [term]);
  const filteredFixed = useMemo(() => fixedList.filter(matches), [fixedList, matches]);
  const filteredFree = useMemo(() => freeList.filter(matches), [freeList, matches]);
  const filteredOor = useMemo(() => oorList.filter(matches), [oorList, matches]);
  // Arrastar exige a lista completa (senão os índices gravados não batem com
  // quem está fora de vista) — desativa o arraste enquanto a busca filtra.
  const canDrag = term === '';

  const availableCandidates = useMemo(() => {
    const existing = new Set(participants.map(p => p.userId));
    const addTerm = addSearch.trim().toLowerCase();
    return candidates.filter(c => !existing.has(c.id)).filter(c => !addTerm || c.name.toLowerCase().includes(addTerm));
  }, [candidates, participants, addSearch]);

  // --------------------------------------------------------- participantes

  /**
   * Aplica a mudança NA TELA primeiro, manda pro servidor em seguida, e só
   * desfaz se o servidor recusar (ex.: posição fixa inválida, validada só
   * lá). Envia o participante inteiro porque a API grava o registro
   * completo, não um patch.
   */
  // Aviso de que o reprocessamento automático rodou (ver reprocessUpcomingDays
  // no servidor) — só aparece quando de fato mexeu em algum dia futuro.
  const notifyReprocessed = (count?: number) => {
    if (!count) return;
    toast.info(`${count} dia${count > 1 ? 's' : ''} futuro${count > 1 ? 's' : ''} do Giro reprocessado${count > 1 ? 's' : ''} automaticamente.`);
  };

  const persist = async (p: GiroParticipant, changes: Partial<GiroParticipant>, message?: string) => {
    const previous = p;
    const next: GiroParticipant = {
      ...p,
      ...changes,
      isAbsent: changes.absentUntil !== undefined ? computeIsAbsent(changes.absentUntil ?? null) : p.isAbsent
    };
    setParticipants(prev => prev.map(x => (x.userId === p.userId ? next : x)));
    markPending(p.userId, true);

    const result = await saveGiroParticipant({
      userId: p.userId,
      workSchedule: next.workSchedule,
      positionType: next.positionType,
      fixedPosition: next.fixedPosition,
      outOfRotation: next.outOfRotation,
      absentUntil: next.absentUntil,
      absenceNote: next.absenceNote
    });
    markPending(p.userId, false);

    if (result.error) {
      setParticipants(prev => prev.map(x => (x.userId === p.userId ? previous : x)));
      toast.error(result.error);
      return false;
    }
    if (message) toast.success(message);
    if (result.reinserted) toast.info('Como a ausência foi retirada hoje, a pessoa voltou ao fim do Giro de hoje.');
    notifyReprocessed(result.reprocessedDays);
    return true;
  };

  const handleRemoveParticipant = async (p: GiroParticipant) => {
    setParticipants(prev => prev.filter(x => x.userId !== p.userId));
    setConfirmRemove(null);
    const result = await deleteGiroParticipant(p.userId);
    if (result.error) {
      setParticipants(prev => [...prev, p]);
      toast.error(result.error);
      return;
    }
    toast.success(`${p.name} saiu do cadastro do Giro.`);
    notifyReprocessed(result.reprocessedDays);
  };

  const handleAddCandidate = async (candidate: GiroCandidate) => {
    const maxBaseOrder = participants.reduce((max, p) => Math.max(max, p.baseOrder), 0);
    const optimistic: GiroParticipant = {
      userId: candidate.id,
      name: candidate.name,
      avatarUrl: candidate.avatarUrl,
      avatarThumbUrl: candidate.avatarThumbUrl,
      workSchedule: null,
      positionType: 'free',
      fixedPosition: null,
      baseOrder: maxBaseOrder + 1,
      outOfRotation: false,
      absentUntil: null,
      absenceNote: null,
      isAbsent: false
    };
    setParticipants(prev => [...prev, optimistic]);
    markPending(candidate.id, true);

    const result = await saveGiroParticipant({ userId: candidate.id });
    markPending(candidate.id, false);

    if (result.error) {
      setParticipants(prev => prev.filter(x => x.userId !== candidate.id));
      toast.error(result.error);
      return;
    }
    toast.success(`${candidate.name} entrou no Giro.`);
    notifyReprocessed(result.reprocessedDays);
  };

  const handleFreeDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = freeList.findIndex(p => p.userId === active.id);
    const newIndex = freeList.findIndex(p => p.userId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previousParticipants = participants;
    const reordered = arrayMove(freeList, oldIndex, newIndex);
    setParticipants(prev => {
      const reorderedIds = new Set(reordered.map(p => p.userId));
      const others = prev.filter(p => !reorderedIds.has(p.userId));
      const withNewOrder = reordered.map((p, i) => ({ ...p, baseOrder: i + 1 }));
      return [...others, ...withNewOrder];
    });

    const result = await reorderGiroParticipants(reordered.map(p => p.userId));
    if (result.error) {
      setParticipants(previousParticipants);
      toast.error(result.error);
      return;
    }
    notifyReprocessed(result.reprocessedDays);
  };

  // ------------------------------------------------------------ checklist

  const handleAddChecklistItem = async () => {
    const label = newItemLabel.trim();
    if (!label) return;
    setNewItemLabel('');

    // Id temporário só pra existir uma key/alvo de clique até o servidor
    // responder com o id real — trocado abaixo, sem o que qualquer edição
    // seguinte (ativar, excluir) mandaria um id que não existe no banco.
    const tempId = `temp-${Date.now()}`;
    const optimisticItem: GiroChecklistItem = { id: tempId, label, sortOrder: checklistItems.length + 1, isActive: true };
    setChecklistItems(prev => [...prev, optimisticItem]);
    markPending(tempId, true);

    const result = await saveGiroChecklistItem({ label, sortOrder: checklistItems.length + 1 });
    markPending(tempId, false);

    if (result.error) {
      setChecklistItems(prev => prev.filter(i => i.id !== tempId));
      toast.error(result.error);
      return;
    }
    if (result.id) {
      setChecklistItems(prev => prev.map(i => (i.id === tempId ? { ...i, id: result.id! } : i)));
    }
    toast.success('Item adicionado.');
  };

  const toggleChecklistActive = async (item: GiroChecklistItem) => {
    const previousActive = item.isActive;
    setChecklistItems(prev => prev.map(i => (i.id === item.id ? { ...i, isActive: !previousActive } : i)));
    markPending(item.id, true);

    const result = await saveGiroChecklistItem({ id: item.id, label: item.label, sortOrder: item.sortOrder, isActive: !previousActive });
    markPending(item.id, false);

    if (result.error) {
      setChecklistItems(prev => prev.map(i => (i.id === item.id ? { ...i, isActive: previousActive } : i)));
      toast.error(result.error);
      return;
    }
    toast.success(!previousActive ? 'Item reativado.' : 'Item desativado.');
  };

  const handleDeleteChecklistItem = async (item: GiroChecklistItem) => {
    setChecklistItems(prev => prev.filter(i => i.id !== item.id));
    setConfirmDeleteItem(null);
    const result = await deleteGiroChecklistItem(item.id);
    if (result.error) {
      setChecklistItems(prev => [...prev, item]);
      toast.error(result.error);
      return;
    }
    toast.success('Item excluído.');
  };

  // --------------------------------------------------- horários de almoço

  /**
   * Uma vaga é uma linha em giro_lunch_slots — "adicionar horário" e
   * "adicionar mais uma vaga num horário que já existe" são a MESMA ação
   * (soma 1 no `capacity` daquele horário na tela, insere mais uma linha no
   * servidor). Otimista como o resto da tela: some/aparece na hora, desfaz
   * só se o servidor recusar.
   */
  const handleAddLunchSlot = async (time: string) => {
    const trimmed = time.trim();
    if (!trimmed) return;
    const pendingKey = `lunch:${trimmed}`;
    const previous = lunchCapacity;
    setLunchCapacity(prev => {
      const exists = prev.some(c => c.time === trimmed);
      if (!exists) return [...prev, { time: trimmed, capacity: 1 }].sort((a, b) => a.time.localeCompare(b.time));
      return prev.map(c => (c.time === trimmed ? { ...c, capacity: c.capacity + 1 } : c));
    });
    markPending(pendingKey, true);

    const result = await addGiroLunchSlot(trimmed);
    markPending(pendingKey, false);

    if (result.error) {
      setLunchCapacity(previous);
      toast.error(result.error);
      return;
    }
    setNewLunchTime('');
  };

  /**
   * Tira UMA vaga do horário. Ao chegar a zero, o horário some da lista
   * sozinho — não existe um botão separado de "excluir horário".
   */
  const handleRemoveLunchSlot = async (time: string) => {
    const pendingKey = `lunch:${time}`;
    const previous = lunchCapacity;
    setLunchCapacity(prev =>
      prev.map(c => (c.time === time ? { ...c, capacity: c.capacity - 1 } : c)).filter(c => c.capacity > 0)
    );
    markPending(pendingKey, true);

    const result = await removeGiroLunchSlot(time);
    markPending(pendingKey, false);

    if (result.error) {
      setLunchCapacity(previous);
      toast.error(result.error);
    }
  };

  // ------------------------------------------------------------------ Meet

  const handleSaveMeetUrl = async () => {
    setMeetSaving(true);
    const result = await saveGiroMeetUrl(meetUrl.trim() || null);
    setMeetSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Link da reunião salvo.');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--text-tertiary)]">
        <Loader2 className="animate-spin mr-2" size={18} /> Carregando a configuração...
      </div>
    );
  }

  const totalCount = participants.length;

  const rowCallbacks = (p: GiroParticipant) => ({
    onSchedule: (next: string | null) => persist(p, { workSchedule: next }, 'Horário atualizado.'),
    onTypeChange: (type: 'free' | 'fixed') => persist(p, {
      positionType: type,
      fixedPosition: type === 'fixed' ? (p.fixedPosition ?? 1) : null
    }, 'Tipo de posição atualizado.'),
    onFixedPosition: (n: number) => persist(p, { fixedPosition: n }, 'Posição fixa atualizada.'),
    onAbsence: () => {
      setAbsenceTarget(p);
      setAbsenceUntil(toLocalInput(p.absentUntil));
      setAbsenceNote(p.absenceNote ?? '');
    },
    onToggleOOR: () => persist(p, { outOfRotation: !p.outOfRotation }, p.outOfRotation ? 'De volta ao rodízio.' : 'Fora do rodízio.'),
    onRemove: () => setConfirmRemove(p)
  });

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------ participantes */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight">Quem participa do Giro</h3>
            <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
              Só quem está nesta lista entra na geração automática
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-9 pr-4 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-page)] text-xs font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)] w-[180px]"
              />
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2.5 rounded-xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2"
            >
              <UserPlus size={14} /> Adicionar
            </button>
          </div>
        </div>

        {totalCount === 0 ? (
          <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic py-8 text-center">
            Nenhum participante cadastrado ainda — o Giro só é gerado depois que alguém entra nesta lista.
          </p>
        ) : (
          <div className="space-y-6">
            {/* ---- posições fixas */}
            {fixedList.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--accent-text)]">
                  Posições fixas · {fixedList.length}
                </p>
                <div className="space-y-1.5">
                  {filteredFixed.map(p => (
                    <ParticipantRow
                      key={p.userId}
                      p={p}
                      saving={pendingIds.has(p.userId)}
                      badge={<OrdinalBadge n={p.fixedPosition ?? 1} tone="fixed" />}
                      totalActive={totalActive}
                      fixedList={fixedList}
                      {...rowCallbacks(p)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ---- livres, ordem programada */}
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1.5">
                Ordem programada (livres) · {freeList.length}
                {!canDrag && <span className="normal-case font-medium italic opacity-70">— limpe a busca para reordenar</span>}
              </p>
              {filteredFree.length === 0 ? (
                <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic py-4">
                  {freeList.length === 0 ? 'Ninguém em posição livre.' : 'Nenhum participante corresponde à busca.'}
                </p>
              ) : canDrag ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleFreeDragEnd}>
                  <SortableContext items={freeList.map(p => p.userId)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-1.5">
                      {freeList.map((p, idx) => (
                        <SortableFreeRow
                          key={p.userId}
                          p={p}
                          ordinalN={idx + 1}
                          saving={pendingIds.has(p.userId)}
                          totalActive={totalActive}
                          fixedList={fixedList}
                          {...rowCallbacks(p)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="space-y-1.5">
                  {filteredFree.map(p => (
                    <ParticipantRow
                      key={p.userId}
                      p={p}
                      saving={pendingIds.has(p.userId)}
                      badge={<OrdinalBadge n={freeList.findIndex(x => x.userId === p.userId) + 1} tone="free" />}
                      totalActive={totalActive}
                      fixedList={fixedList}
                      {...rowCallbacks(p)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ---- fora do rodízio */}
            {oorList.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
                  Fora do rodízio · {oorList.length}
                </p>
                <div className="space-y-1.5">
                  {filteredOor.map(p => (
                    <ParticipantRow
                      key={p.userId}
                      p={p}
                      saving={pendingIds.has(p.userId)}
                      badge={<OrdinalBadge n={0} tone="oor" />}
                      totalActive={totalActive}
                      fixedList={fixedList}
                      {...rowCallbacks(p)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-5 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-2xl flex gap-3">
          <Info size={16} className="text-[var(--accent-text)] shrink-0 mt-0.5" />
          <p className="text-[11px] font-medium text-[var(--text-secondary)] leading-relaxed">
            Quem tem <strong>posição fixa</strong> escolhe o próprio número (1º, 2º...) e nunca roda. Os demais seguem a
            <strong> ordem programada</strong> — arraste a lista de livres pra definir quem vem depois de quem. A cada
            dia, o último dos livres assume o primeiro lugar e os outros descem uma posição (a ordem programada é só o
            ponto de partida — quem entra novo, ou volta de ausência, começa no fim dela e só passa a rodar no dia
            seguinte). Duas pessoas não podem ocupar o mesmo número — o sistema bloqueia ao salvar. Se o número escolhido
            for maior que a quantidade de gente do dia, essa posição vale como livre naquele dia.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------------- meet */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-5">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <Video className="text-[var(--accent-text)]" size={22} /> Sala de reunião
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Link fixo usado pelo botão &quot;Meet Suporte&quot; no atalho do Giro
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={meetUrl}
            onChange={e => setMeetUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveMeetUrl(); }}
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
            disabled={meetSaving}
            className="flex-1 px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
          />
          <button
            onClick={handleSaveMeetUrl}
            disabled={meetSaving}
            className="px-5 py-3 rounded-2xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
          >
            {meetSaving ? <Loader2 size={14} className="animate-spin" /> : null} Salvar
          </button>
        </div>

        <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
          É só um atalho — abre esse link em outra guia. Trocar aqui atualiza o botão pra toda a equipe na hora.
          Deixe em branco e salve para remover o botão.
        </p>
      </div>

      {/* ---------------------------------------------------------- checklist */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <ListChecks className="text-[var(--accent-text)]" size={22} /> Checklist do dia
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Itens que cada analista marca uma vez por dia
          </p>
        </div>

        <div className="flex gap-2">
          <input
            value={newItemLabel}
            onChange={e => setNewItemLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddChecklistItem(); }}
            placeholder="Novo item (ex: VPN)"
            className="flex-1 px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleAddChecklistItem}
            disabled={!newItemLabel.trim()}
            className="px-5 py-3 rounded-2xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={14} /> Adicionar
          </button>
        </div>

        <div className="space-y-2">
          {checklistItems.length === 0 ? (
            <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic">Nenhum item cadastrado.</p>
          ) : checklistItems.map(item => {
            const itemSaving = pendingIds.has(item.id);
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-default)]">
                <span className={cn(
                  'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest',
                  item.isActive
                    ? 'bg-[var(--accent)]/10 text-[var(--accent-text)]'
                    : 'bg-[var(--surface-pill)] text-[var(--text-tertiary)] line-through'
                )}>
                  {item.label}
                </span>

                <label className="ml-auto flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.isActive}
                    disabled={itemSaving}
                    onChange={() => toggleChecklistActive(item)}
                    className="accent-[var(--accent)]"
                  />
                  Ativo
                </label>

                <button
                  onClick={() => setConfirmDeleteItem(item)}
                  disabled={itemSaving}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all disabled:opacity-50"
                  title="Excluir item"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
          Desativar mantém o histórico e só tira o item das telas do dia a dia. Excluir remove o item de vez —
          as marcações já feitas em dias passados continuam gravadas, mas deixam de ser exibidas.
        </p>
      </div>

      {/* ---------------------------------------------------- horários de almoço */}
      <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-[2rem] p-8 shadow-sm space-y-6">
        <div>
          <h3 className="text-xl font-black text-[var(--text-primary)] uppercase tracking-tight flex items-center gap-2">
            <UtensilsCrossed className="text-[var(--accent-text)]" size={22} /> Horários de almoço
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
            Quantas vagas cada horário tem
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="time"
            value={newLunchTime}
            onChange={e => setNewLunchTime(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddLunchSlot(newLunchTime); }}
            className="px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => handleAddLunchSlot(newLunchTime)}
            disabled={!newLunchTime}
            className="px-5 py-3 rounded-2xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plus size={14} /> Adicionar vaga
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {lunchCapacity.length === 0 ? (
            <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic">
              Nenhum horário cadastrado — ninguém vai conseguir marcar almoço até adicionar um.
            </p>
          ) : lunchCapacity.map(slot => {
            const saving = pendingIds.has(`lunch:${slot.time}`);
            return (
              <div
                key={slot.time}
                className="flex items-center gap-2 pl-4 pr-2 py-2 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)]"
              >
                <span className="text-sm font-black text-[var(--text-primary)] tabular-nums">{slot.time}</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
                  {slot.capacity} {slot.capacity === 1 ? 'vaga' : 'vagas'}
                </span>
                <div className="flex items-center gap-0.5 ml-1">
                  <button
                    onClick={() => handleRemoveLunchSlot(slot.time)}
                    disabled={saving}
                    title="Remover uma vaga deste horário"
                    className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all disabled:opacity-50"
                  >
                    <Minus size={13} />
                  </button>
                  <button
                    onClick={() => handleAddLunchSlot(slot.time)}
                    disabled={saving}
                    title="Adicionar mais uma vaga neste horário"
                    className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--accent-text)] hover:bg-[var(--accent)]/10 transition-all disabled:opacity-50"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
          Cada horário tem seu próprio número de vagas — some &quot;+&quot; pra abrir mais uma vaga no mesmo horário
          (ex: 3 vagas às 12:00 e 1 vaga às 13:00) ou &quot;−&quot; pra tirar uma. Zerar as vagas de um horário o
          remove da lista sozinho, sem precisar de um botão de excluir à parte. Quem já tinha marcado um horário
          que perdeu vagas continua com a própria escolha — só passa a não caber mais gente nova ali.
        </p>
      </div>

      {/* ----------------------------------------------------- modal adicionar */}
      <AnimatePresence>
        {showAdd && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowAdd(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 16 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="px-7 py-5 border-b border-[var(--border-default)] flex items-center justify-between">
                <h3 className="text-base font-black uppercase tracking-tight text-[var(--text-primary)]">Adicionar ao Giro</h3>
                <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
                  Entra na hora — pode clicar em mais de uma pessoa, cada uma some da lista assim que confirmada.
                </p>
                <input
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  placeholder="Buscar pessoa..."
                  className="w-full px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                <div className="max-h-[320px] overflow-y-auto space-y-1.5">
                  {availableCandidates.length === 0 ? (
                    <p className="text-[11px] font-medium text-[var(--text-tertiary)] italic py-6 text-center">
                      Todo mundo do time já participa do Giro.
                    </p>
                  ) : availableCandidates.map(candidate => (
                    <button
                      key={candidate.id}
                      onClick={() => handleAddCandidate(candidate)}
                      disabled={pendingIds.has(candidate.id)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl border border-[var(--border-default)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all text-left disabled:opacity-50"
                    >
                      <UserAvatar name={candidate.name} thumbUrl={candidate.avatarThumbUrl} url={candidate.avatarUrl} size={28} />
                      <div className="min-w-0">
                        <p className="text-xs font-black text-[var(--text-primary)] truncate">{candidate.name}</p>
                        <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">{candidate.role}</p>
                      </div>
                      <Plus size={15} className="ml-auto text-[var(--accent-text)] shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------ modal ausência */}
      <AnimatePresence>
        {absenceTarget && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setAbsenceTarget(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 16 }}
              className="relative bg-[var(--surface-card)] w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="px-7 py-5 border-b border-[var(--border-default)] flex items-center justify-between">
                <h3 className="text-base font-black uppercase tracking-tight text-[var(--text-primary)]">
                  Ausência de {absenceTarget.name}
                </h3>
                <button onClick={() => setAbsenceTarget(null)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)]">
                  <X size={16} />
                </button>
              </div>
              <div className="p-7 space-y-5">
                <p className="text-[11px] font-medium text-[var(--text-tertiary)] leading-relaxed">
                  Marcar ausência exige informar quando a pessoa volta. Até lá ela fica fora das gerações;
                  passado o prazo, volta a entrar sozinha, sem ninguém precisar desmarcar nada.
                </p>

                <label className="block space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] flex items-center gap-1.5">
                    <Clock size={11} /> Volta em
                  </span>
                  <input
                    type="datetime-local"
                    value={absenceUntil}
                    onChange={e => setAbsenceUntil(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-bold text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">Motivo (opcional)</span>
                  <input
                    value={absenceNote}
                    onChange={e => setAbsenceNote(e.target.value)}
                    placeholder="Férias, atestado, treinamento..."
                    className="w-full px-4 py-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <div className="flex gap-3">
                  {absenceTarget.absentUntil && (
                    <button
                      onClick={async () => {
                        const target = absenceTarget;
                        const ok = await persist(target, { absentUntil: null, absenceNote: null }, 'Ausência removida.');
                        if (ok) setAbsenceTarget(null);
                      }}
                      className="flex-1 px-6 py-3.5 rounded-2xl border border-[var(--border-default)] text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                    >
                      Remover ausência
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!absenceUntil) { toast.error('Informe a data e a hora de retorno.'); return; }
                      const target = absenceTarget;
                      const ok = await persist(target, {
                        absentUntil: new Date(absenceUntil).toISOString(),
                        absenceNote: absenceNote.trim() || null
                      }, 'Ausência registrada.');
                      if (ok) setAbsenceTarget(null);
                    }}
                    className="flex-1 px-6 py-3.5 rounded-2xl bg-[var(--accent)] text-white text-[10px] font-black uppercase tracking-widest hover:bg-[var(--accent-hover)] transition-all"
                  >
                    Salvar ausência
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => { if (confirmRemove) handleRemoveParticipant(confirmRemove); }}
        title="Tirar do cadastro do Giro?"
        description={`${confirmRemove?.name ?? ''} deixa de entrar nas próximas gerações. Os dias já gerados não mudam — eles são histórico. Para uma saída temporária, prefira "fora do rodízio", que preserva horário e posição fixa.`}
        confirmLabel="Tirar do cadastro"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={!!confirmDeleteItem}
        onClose={() => setConfirmDeleteItem(null)}
        onConfirm={() => { if (confirmDeleteItem) handleDeleteChecklistItem(confirmDeleteItem); }}
        title="Excluir item do checklist?"
        description={`"${confirmDeleteItem?.label ?? ''}" deixa de aparecer nas telas do dia. As marcações já gravadas em dias passados continuam no banco, mas não são mais exibidas. Se a ideia é só tirar de circulação, desative em vez de excluir.`}
        confirmLabel="Excluir item"
        variant="danger"
      />
    </div>
  );
}

// ==========================================================================
// Linha de participante — compacta, uma linha só
// ==========================================================================

function OrdinalBadge({ n, tone }: { n: number; tone: 'fixed' | 'free' | 'oor' }) {
  if (tone === 'oor') {
    return (
      <span className="w-9 h-7 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] shrink-0">
        <CircleSlash size={13} />
      </span>
    );
  }
  return (
    <span className={cn(
      'w-9 h-7 rounded-lg flex items-center justify-center text-[10px] font-black tabular-nums shrink-0',
      tone === 'fixed'
        ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[var(--accent-text)]'
        : 'bg-[var(--surface-pill)] border border-[var(--border-default)] text-[var(--text-secondary)]'
    )}>
      {ordinal(n)}
    </span>
  );
}

interface ParticipantRowProps {
  p: GiroParticipant;
  badge: React.ReactNode;
  /** Só esta linha está com uma chamada em voo — não trava as demais. */
  saving: boolean;
  totalActive: number;
  /** Todo mundo com posição fixa hoje — usado só pra excluir do seletor os
   * números já ocupados por OUTRA pessoa (a própria posição atual continua
   * disponível, senão o <select> ficaria sem opção correspondente ao value). */
  fixedList: GiroParticipant[];
  onSchedule: (value: string | null) => void;
  onTypeChange: (type: 'free' | 'fixed') => void;
  onFixedPosition: (n: number) => void;
  onAbsence: () => void;
  onToggleOOR: () => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  isDragging?: boolean;
}

function ParticipantRow({
  p, badge, saving, totalActive, fixedList, onSchedule, onTypeChange, onFixedPosition,
  onAbsence, onToggleOOR, onRemove, dragHandle, setNodeRef, style, isDragging
}: ParticipantRowProps) {
  // Números que OUTRA pessoa já ocupa — bloqueados no seletor pra não dar
  // pra nem escolher um conflito (o servidor também recusa, isto é só a
  // versão que evita a ida e volta de rede pra descobrir o óbvio).
  const takenByOthers = new Set(
    fixedList.filter(x => x.userId !== p.userId && x.fixedPosition != null).map(x => x.fixedPosition)
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex flex-wrap sm:flex-nowrap items-center gap-2.5 px-3 py-2 rounded-xl border transition-all',
        p.outOfRotation
          ? 'border-[var(--border-default)] bg-[var(--surface-pill)]/40 opacity-70'
          : p.isAbsent
            ? 'border-[var(--text-warning-strong)]/40 bg-[var(--surface-warning)]/20'
            : 'border-[var(--border-default)] bg-[var(--surface-card)]',
        isDragging && 'opacity-60 shadow-lg'
      )}
    >
      {dragHandle}
      {badge}
      <UserAvatar name={p.name} thumbUrl={p.avatarThumbUrl} url={p.avatarUrl} size={26} />
      <div className="min-w-0 w-[150px] shrink-0">
        <p className="text-[11px] font-black text-[var(--text-primary)] truncate">{p.name}</p>
        <p className="text-[8px] font-black uppercase tracking-widest text-[var(--text-tertiary)] truncate">
          {p.outOfRotation ? 'Fora do rodízio' : p.isAbsent ? `Ausente até ${toBrDateTime(p.absentUntil)}` : 'Ativo'}
        </p>
      </div>

      <input
        defaultValue={p.workSchedule ?? ''}
        disabled={saving}
        onBlur={e => {
          const next = e.target.value.trim() || null;
          if (next !== (p.workSchedule ?? null)) onSchedule(next);
        }}
        placeholder="Horário (ex: 08:00 às 17:00)"
        className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] text-[11px] font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
      />

      <div className="w-[100px] shrink-0">
        <StyledSelect
          value={p.positionType}
          disabled={saving}
          onChange={e => onTypeChange(e.target.value as 'free' | 'fixed')}
          className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)]"
        >
          <option value="free">Livre</option>
          <option value="fixed">Fixa</option>
        </StyledSelect>
      </div>

      {p.positionType === 'fixed' && (
        <div className="w-[76px] shrink-0">
          <StyledSelect
            value={String(p.fixedPosition ?? 1)}
            disabled={saving}
            onChange={e => onFixedPosition(Number(e.target.value))}
            className="text-[10px] font-black tabular-nums text-[var(--text-secondary)]"
          >
            {Array.from({ length: Math.max(totalActive, p.fixedPosition ?? 1) }, (_, i) => i + 1)
              .filter(n => n === p.fixedPosition || !takenByOthers.has(n))
              .map(n => (
                <option key={n} value={n}>{ordinal(n)}</option>
              ))}
          </StyledSelect>
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <button
          onClick={onAbsence}
          disabled={saving}
          title="Marcar ausência com data e hora de retorno"
          className={cn(
            'p-1.5 rounded-lg transition-all disabled:opacity-50',
            p.isAbsent
              ? 'bg-[var(--surface-warning)] text-[var(--text-warning)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-warning)] hover:bg-[var(--surface-warning)]'
          )}
        >
          <CalendarClock size={13} />
        </button>
        <button
          onClick={onToggleOOR}
          disabled={saving}
          title={p.outOfRotation ? 'Trazer de volta ao rodízio' : 'Tirar do rodízio (continua cadastrado)'}
          className={cn(
            'p-1.5 rounded-lg transition-all disabled:opacity-50',
            p.outOfRotation
              ? 'bg-[var(--surface-pill)] text-[var(--text-secondary)] border border-[var(--border-default)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]'
          )}
        >
          <CircleSlash size={13} />
        </button>
        <button
          onClick={onRemove}
          disabled={saving}
          title="Tirar do cadastro do Giro"
          className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-danger)] hover:bg-[var(--surface-danger)] transition-all disabled:opacity-50"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** Wrapper com useSortable — só usado na lista de livres, quando não há busca ativa. */
function SortableFreeRow(props: Omit<ParticipantRowProps, 'badge' | 'dragHandle' | 'setNodeRef' | 'style' | 'isDragging'> & { ordinalN: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.p.userId });
  const { ordinalN, ...rest } = props;
  return (
    <ParticipantRow
      {...rest}
      badge={<OrdinalBadge n={ordinalN} tone="free" />}
      dragHandle={
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing shrink-0"
          title="Arrastar para reordenar"
        >
          <GripVertical size={14} />
        </button>
      }
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      isDragging={isDragging}
    />
  );
}
