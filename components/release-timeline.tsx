'use client';

import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Lock, CheckCircle2, AlertTriangle, AlertOctagon, Clock, Circle, Flag, Rocket, GripVertical, CalendarRange } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReleaseCycle, ReleaseCycleStage, ReleaseItem, ReleaseStageStatus } from '@/lib/types';
import {
  computeStagesWithStatus, diffIsoDays, addDaysToIsoDate, todayIsoDate,
  isStageMilestone, STAGE_STATUS_META, RELEASE_ITEM_TYPE_META, formatIsoDatePtBr
} from '@/lib/release-stage-logic';

const DAY_WIDTH_ALL = 30;
const DAY_WIDTH_SINGLE = 40;
const LANE_LABEL_WIDTH = 240;
const WEEKDAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const STATUS_ICON: Record<ReleaseStageStatus, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  pendente: Circle,
  em_andamento: Clock,
  concluida: CheckCircle2,
  atrasada: AlertTriangle,
  em_risco: AlertOctagon,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface ReleaseTimelineProps {
  cycles: ReleaseCycle[];
  visibleCycleIds: string[];
  mode: 'all' | 'single';
  singleCycleId?: string | null;
  canEdit: boolean;
  onOpenStage: (cycle: ReleaseCycle, stage: ReleaseCycleStage) => void;
  onOpenItem: (cycle: ReleaseCycle, item: ReleaseItem) => void;
  onFocusCycle: (cycleId: string) => void;
  /** Etapa foi arrastada/redimensionada — pai decide otimismo + undo + commit. */
  onStageDatesDragged: (stageId: string, newStart: string, newEnd: string) => void;
}

function useDragHandlers(opts: {
  canEdit: boolean;
  dayWidth: number;
  stage: ReleaseCycleStage;
  onPreview: (start: string, end: string) => void;
  onCommit: (start: string, end: string) => void;
  onClickNoMove: () => void;
}) {
  const { canEdit, dayWidth, stage, onPreview, onCommit, onClickNoMove } = opts;
  const dragRef = useRef<{ mode: 'move' | 'resize-start' | 'resize-end'; startX: number; origStart: string; origEnd: string; moved: boolean } | null>(null);

  const begin = useCallback((mode: 'move' | 'resize-start' | 'resize-end') => (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, origStart: stage.startDate, origEnd: stage.endDate, moved: false };
  }, [canEdit, stage.startDate, stage.endDate]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaPx = e.clientX - drag.startX;
    const deltaDays = Math.round(deltaPx / dayWidth);
    if (deltaDays === 0 && !drag.moved) return;
    if (Math.abs(deltaPx) > 3) drag.moved = true;

    let nextStart = drag.origStart;
    let nextEnd = drag.origEnd;
    if (drag.mode === 'move') {
      nextStart = addDaysToIsoDate(drag.origStart, deltaDays);
      nextEnd = addDaysToIsoDate(drag.origEnd, deltaDays);
    } else if (drag.mode === 'resize-start') {
      nextStart = addDaysToIsoDate(drag.origStart, deltaDays);
      if (nextStart > drag.origEnd) nextStart = drag.origEnd;
    } else {
      nextEnd = addDaysToIsoDate(drag.origEnd, deltaDays);
      if (nextEnd < drag.origStart) nextEnd = drag.origStart;
    }
    onPreview(nextStart, nextEnd);
  }, [dayWidth, onPreview]);

  const onUp = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) { onClickNoMove(); return; }

    const deltaPx = e.clientX - drag.startX;
    const deltaDays = Math.round(deltaPx / dayWidth);
    let nextStart = drag.origStart;
    let nextEnd = drag.origEnd;
    if (drag.mode === 'move') {
      nextStart = addDaysToIsoDate(drag.origStart, deltaDays);
      nextEnd = addDaysToIsoDate(drag.origEnd, deltaDays);
    } else if (drag.mode === 'resize-start') {
      nextStart = addDaysToIsoDate(drag.origStart, deltaDays);
      if (nextStart > drag.origEnd) nextStart = drag.origEnd;
    } else {
      nextEnd = addDaysToIsoDate(drag.origEnd, deltaDays);
      if (nextEnd < drag.origStart) nextEnd = drag.origStart;
    }
    if (nextStart === drag.origStart && nextEnd === drag.origEnd) { onPreview(drag.origStart, drag.origEnd); return; }
    onCommit(nextStart, nextEnd);
  }, [dayWidth, onCommit, onPreview, onClickNoMove]);

  return { begin, onMove, onUp };
}

function StageBar({
  stage, dayWidth, originDate, laneHeight, canEdit, isSingle, itemCount, onOpenStage, onStageDatesDragged,
}: {
  stage: ReleaseCycleStage & { status: ReleaseStageStatus }; dayWidth: number; originDate: string;
  laneHeight: number; canEdit: boolean; isSingle: boolean; itemCount: number;
  onOpenStage: () => void;
  onStageDatesDragged: (stageId: string, newStart: string, newEnd: string) => void;
}) {
  const [preview, setPreview] = useState<{ start: string; end: string } | null>(null);
  const [hovered, setHovered] = useState(false);
  const start = preview?.start ?? stage.startDate;
  const end = preview?.end ?? stage.endDate;
  const milestone = isStageMilestone({ startDate: start, endDate: end });
  const status = stage.status;
  const meta = STAGE_STATUS_META[status];
  const StatusIcon = STATUS_ICON[status];

  const { begin, onMove, onUp } = useDragHandlers({
    canEdit, dayWidth, stage,
    onPreview: (s, e) => setPreview({ start: s, end: e }),
    onCommit: (s, e) => { setPreview(null); onStageDatesDragged(stage.id, s, e); },
    onClickNoMove: () => { setPreview(null); onOpenStage(); },
  });

  const left = diffIsoDays(originDate, start) * dayWidth;
  const widthDays = diffIsoDays(start, end) + 1;
  const width = Math.max(widthDays * dayWidth, milestone ? dayWidth * 0.72 : dayWidth);
  const showLabel = isSingle || width >= 56;

  const plannedChanged = stage.plannedStartDate !== stage.startDate || stage.plannedEndDate !== stage.endDate;
  const plannedLeft = diffIsoDays(originDate, stage.plannedStartDate) * dayWidth;
  const plannedWidth = Math.max((diffIsoDays(stage.plannedStartDate, stage.plannedEndDate) + 1) * dayWidth, dayWidth * 0.9);

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 select-none"
      style={{ left, width: milestone ? width : undefined, minWidth: milestone ? undefined : width, height: laneHeight }}
      title={`${stage.name} — ${formatIsoDatePtBr(start)}${start !== end ? ` a ${formatIsoDatePtBr(end)}` : ''} — ${meta.label}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {plannedChanged && (
        <div
          className="absolute top-0 h-1.5 rounded-full border border-dashed opacity-50 pointer-events-none"
          style={{ left: plannedLeft - left, width: plannedWidth, borderColor: 'var(--text-tertiary)' }}
        />
      )}
      <div
        onPointerDown={begin('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className={cn(
          'relative h-full rounded-xl flex items-center gap-1.5 overflow-hidden border transition-shadow',
          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          milestone ? 'rounded-full justify-center px-0' : 'px-2',
          hovered && 'shadow-md'
        )}
        style={{
          backgroundColor: meta.surfaceVar,
          borderColor: meta.textVar,
          borderWidth: status === 'atrasada' || status === 'em_risco' ? 1.5 : 1,
          borderStyle: status === 'em_risco' ? 'dashed' : 'solid',
          marginTop: plannedChanged ? 3 : 0,
        }}
      >
        {/* pontinho = identidade própria da etapa (cor escolhida no modelo/criação),
            separado do status (fundo+ícone) — ver legenda. */}
        {!milestone && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />}
        {milestone ? (
          <Flag size={isSingle ? 13 : 11} style={{ color: meta.textVar }} className="shrink-0" />
        ) : (
          <StatusIcon size={isSingle ? 13 : 11} style={{ color: meta.textVar }} className="shrink-0" />
        )}
        {showLabel && !milestone && (
          <span className="text-[11px] font-bold truncate" style={{ color: meta.textVar }}>{stage.name}</span>
        )}

        {canEdit && !milestone && (
          <>
            <div onPointerDown={begin('resize-start')} onPointerMove={onMove} onPointerUp={onUp} className="absolute left-0 top-0 h-full w-2.5 cursor-ew-resize" />
            <div onPointerDown={begin('resize-end')} onPointerMove={onMove} onPointerUp={onUp} className="absolute right-0 top-0 h-full w-2.5 cursor-ew-resize" />
            {hovered && showLabel && (
              <GripVertical size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none" style={{ color: meta.textVar }} />
            )}
          </>
        )}

        {!isSingle && itemCount > 0 && (
          <span className="absolute -left-1 -bottom-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--text-primary)] text-white text-[8px] font-black flex items-center justify-center leading-none ring-2 ring-[var(--surface-card)]">
            {itemCount}
          </span>
        )}
      </div>

      {/* Marco (data única): o círculo não cabe o nome — label ao lado, sem recorte. */}
      {milestone && isSingle && (
        <span
          className="absolute left-full ml-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold whitespace-nowrap pointer-events-none"
          style={{ color: meta.textVar }}
        >
          {stage.name}
        </span>
      )}
    </div>
  );
}

function ItemMarker({ item, onClick }: { item: ReleaseItem; onClick: () => void }) {
  const meta = RELEASE_ITEM_TYPE_META[item.itemType];
  return (
    <button
      onClick={onClick}
      title={`${meta.label}: ${item.name}${item.completedAt ? ' — concluído' : ''}`}
      className="relative w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 border-2 border-[var(--surface-card)] shadow-sm hover:scale-110 transition-transform"
      style={{ backgroundColor: meta.color, opacity: item.completedAt ? 0.5 : 1 }}
    >
      {meta.short.slice(0, 1)}
      {item.completedAt && <CheckCircle2 size={10} className="absolute -right-1 -bottom-1 text-white bg-[var(--text-success)] rounded-full" />}
    </button>
  );
}

export function ReleaseTimeline({
  cycles, visibleCycleIds, mode, singleCycleId, canEdit, onOpenStage, onOpenItem, onFocusCycle, onStageDatesDragged,
}: ReleaseTimelineProps) {
  const today = todayIsoDate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const base = mode === 'single' && singleCycleId
      ? cycles.filter(c => c.id === singleCycleId)
      : cycles.filter(c => visibleCycleIds.includes(c.id));
    return base.filter(c => c.stages.length > 0);
  }, [cycles, visibleCycleIds, mode, singleCycleId]);

  const dayWidth = mode === 'single' ? DAY_WIDTH_SINGLE : DAY_WIDTH_ALL;
  const laneHeight = mode === 'single' ? 44 : 30;
  const laneExtra = mode === 'single' ? 52 : 14; // espaço extra pra marcadores de item, em 2 linhas (só no modo "Uma só")

  const { originDate, totalDays } = useMemo(() => {
    const allDates: string[] = [today];
    for (const c of visible) for (const s of c.stages) { allDates.push(s.startDate, s.endDate, s.plannedStartDate, s.plannedEndDate); }
    const sorted = allDates.sort();
    const min = addDaysToIsoDate(sorted[0], -2);
    const max = addDaysToIsoDate(sorted[sorted.length - 1], 3);
    return { originDate: min, totalDays: Math.max(diffIsoDays(min, max), 7) };
  }, [visible, today]);

  const days = useMemo(() => Array.from({ length: totalDays + 1 }, (_, i) => addDaysToIsoDate(originDate, i)), [originDate, totalDays]);
  const todayLeft = diffIsoDays(originDate, today) * dayWidth;

  // Abre a timeline já centrada em "hoje" — sem isso, um ciclo longo nasce
  // rolado pro início (a data-âncora), e "hoje" fica escondido fora da tela
  // até o usuário descobrir que precisa arrastar pra direita.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      if (el.scrollWidth <= el.clientWidth) return;
      const target = LANE_LABEL_WIDTH + todayLeft - el.clientWidth / 2 + dayWidth / 2;
      el.scrollLeft = Math.max(0, target);
    });
    return () => cancelAnimationFrame(raf);
  }, [originDate, totalDays, dayWidth, mode, singleCycleId, todayLeft]);

  const monthSegments = useMemo(() => {
    const segments: { label: string; span: number }[] = [];
    for (const d of days) {
      const label = capitalize(new Date(`${d}T00:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
      const last = segments[segments.length - 1];
      if (last && last.label === label) last.span++;
      else segments.push({ label, span: 1 });
    }
    return segments;
  }, [days]);

  if (visible.length === 0) {
    return (
      <div className="rounded-[2rem] border-2 border-dashed border-[var(--border-default)] p-10 text-center">
        <Rocket className="mx-auto text-[var(--text-tertiary)] mb-2" size={28} />
        <p className="text-sm font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
          {mode === 'single' ? 'Selecione um ciclo com etapas' : 'Nenhum ciclo selecionado'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[2rem] border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm overflow-hidden">
      {/* Legenda no TOPO — antes só aparecia depois de rolar a timeline toda
          pra direita; o canal de cor mais importante (status) precisa ser
          visto ANTES de olhar as barras, não depois. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 border-b border-[var(--border-default)] bg-[var(--surface-pill)]/40">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-tertiary)]">
          <CalendarRange size={13} /> {formatIsoDatePtBr(days[0])}–{formatIsoDatePtBr(days[days.length - 1])}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(['pendente', 'em_andamento', 'em_risco', 'atrasada', 'concluida'] as const).map(s => {
            const Icon = STATUS_ICON[s];
            return (
              <span key={s} className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: STAGE_STATUS_META[s].textVar }}>
                <Icon size={12} />
                {STAGE_STATUS_META[s].label}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-l border-[var(--border-default)] pl-4">
          {(['hotfix', 'emergencial', 'prevista'] as const).map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-tertiary)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RELEASE_ITEM_TYPE_META[t].color }} />
              {RELEASE_ITEM_TYPE_META[t].label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--text-tertiary)] border-l border-[var(--border-default)] pl-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-tertiary)]" /> cor própria da etapa
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div style={{ width: LANE_LABEL_WIDTH + (totalDays + 1) * dayWidth, minWidth: '100%' }}>
          {/* Cabeçalho: mês(es) + dia da semana + número do dia, sempre visível */}
          <div className="sticky top-0 z-10 bg-[var(--surface-card)] border-b border-[var(--border-default)]">
            <div className="flex border-b border-[var(--border-default)]/60">
              <div style={{ width: LANE_LABEL_WIDTH }} className="shrink-0 border-r border-[var(--border-default)]" />
              <div className="flex" style={{ width: (totalDays + 1) * dayWidth }}>
                {monthSegments.map((seg, i) => (
                  <div
                    key={i}
                    style={{ width: seg.span * dayWidth }}
                    className="shrink-0 text-center py-1.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] bg-[var(--surface-pill)]/50 border-r border-[var(--border-default)]/60 truncate"
                  >
                    {seg.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex">
              <div style={{ width: LANE_LABEL_WIDTH }} className="shrink-0 border-r border-[var(--border-default)]" />
              <div className="relative flex" style={{ width: (totalDays + 1) * dayWidth }}>
                {days.map(d => {
                  const date = new Date(`${d}T00:00:00`);
                  const dow = date.getDay();
                  const weekend = dow === 0 || dow === 6;
                  const isToday = d === today;
                  return (
                    <div
                      key={d}
                      style={{ width: dayWidth }}
                      className={cn(
                        'shrink-0 text-center py-1.5 border-r border-[var(--border-default)]/40',
                        isToday ? 'bg-[var(--accent)]/15' : weekend ? 'bg-[var(--surface-pill)]/60' : ''
                      )}
                    >
                      <p className={cn(
                        'text-[8px] font-black uppercase leading-none mb-0.5',
                        isToday ? 'text-white bg-[var(--accent)] rounded-full mx-auto px-1' : 'text-[var(--text-tertiary)]/70'
                      )}>
                        {isToday ? 'hoje' : WEEKDAY_LETTERS[dow]}
                      </p>
                      <p className={cn('text-[11px] font-bold tabular-nums leading-none', isToday ? 'text-[var(--accent-text)]' : weekend ? 'text-[var(--text-tertiary)]/80' : 'text-[var(--text-secondary)]')}>
                        {date.getDate()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Raias */}
          <div className="relative">
            <div className="absolute top-0 bottom-0 w-px bg-[var(--accent)]/50" style={{ left: LANE_LABEL_WIDTH + todayLeft + dayWidth / 2 }} />
            {visible.map((cycle, cycleIdx) => {
              const stagesWithStatus = computeStagesWithStatus(cycle.stages, today);
              const itemsByStage = new Map<string, ReleaseItem[]>();
              for (const it of cycle.items) {
                if (!it.currentStageId) continue;
                const list = itemsByStage.get(it.currentStageId) || [];
                list.push(it);
                itemsByStage.set(it.currentStageId, list);
              }
              const unpositioned = cycle.items.filter(it => !it.currentStageId);
              const openItems = cycle.items.filter(it => !it.completedAt).length;
              return (
                <div key={cycle.id} className={cn('border-b border-[var(--border-default)]/60 last:border-b-0', mode === 'all' && cycleIdx % 2 === 1 && 'bg-[var(--surface-pill)]/15')}>
                  <div className="flex hover:bg-[var(--surface-pill)]/40 transition-colors">
                    <div style={{ width: LANE_LABEL_WIDTH }} className="shrink-0 border-r border-[var(--border-default)] px-3 py-2 flex items-center gap-2.5 min-w-0">
                      <div className={cn(
                        'w-7 h-7 rounded-xl flex items-center justify-center shrink-0',
                        cycle.publishedAt ? 'bg-[var(--surface-pill)] text-[var(--text-tertiary)]' : 'bg-[var(--accent)]/12 text-[var(--accent-text)]'
                      )}>
                        {cycle.publishedAt ? <Lock size={13} /> : <Rocket size={13} />}
                      </div>
                      <button onClick={() => onFocusCycle(cycle.id)} className="min-w-0 text-left group" title="Ver só este ciclo">
                        <p className="text-xs font-black text-[var(--text-primary)] truncate group-hover:text-[var(--accent-text)] group-hover:underline">{cycle.name}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">
                          {cycle.items.length === 0 ? 'Sem itens' : `${openItems}/${cycle.items.length} item(ns) em aberto`}
                        </p>
                      </button>
                    </div>
                    <div className="relative" style={{ width: (totalDays + 1) * dayWidth, height: laneHeight + laneExtra }}>
                      {stagesWithStatus.map(stage => (
                        <StageBar
                          key={stage.id}
                          stage={stage}
                          dayWidth={dayWidth}
                          originDate={originDate}
                          laneHeight={laneHeight}
                          canEdit={canEdit && !cycle.publishedAt}
                          isSingle={mode === 'single'}
                          itemCount={(itemsByStage.get(stage.id) || []).length}
                          onOpenStage={() => onOpenStage(cycle, stage)}
                          onStageDatesDragged={onStageDatesDragged}
                        />
                      ))}
                      {mode === 'single' && stagesWithStatus.map(stage => {
                        const stageItems = itemsByStage.get(stage.id) || [];
                        if (stageItems.length === 0) return null;
                        const left = diffIsoDays(originDate, stage.startDate) * dayWidth;
                        return (
                          <div key={`items-${stage.id}`} className="absolute flex items-center gap-1 flex-wrap max-w-[220px]" style={{ left, top: laneHeight + 8 }}>
                            {stageItems.map(it => (
                              <ItemMarker key={it.id} item={it} onClick={() => onOpenItem(cycle, it)} />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {mode === 'single' && unpositioned.length > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border-default)]/40 bg-[var(--surface-pill)]/20">
                      <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-tertiary)] shrink-0">Sem etapa:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {unpositioned.map(it => <ItemMarker key={it.id} item={it} onClick={() => onOpenItem(cycle, it)} />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
