'use client';

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Lock, CheckCircle2, AlertTriangle, Flag, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReleaseCycle, ReleaseCycleStage, ReleaseItem } from '@/lib/types';
import {
  computeStagesWithStatus, diffIsoDays, addDaysToIsoDate, todayIsoDate,
  isStageMilestone, STAGE_STATUS_META, RELEASE_ITEM_TYPE_META, formatIsoDatePtBr
} from '@/lib/release-stage-logic';

const DAY_WIDTH_ALL = 26;
const DAY_WIDTH_SINGLE = 34;
const LANE_LABEL_WIDTH = 220;

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
  stage: ReleaseCycleStage & { status: string }; dayWidth: number; originDate: string;
  laneHeight: number; canEdit: boolean; isSingle: boolean; itemCount: number;
  onOpenStage: () => void;
  onStageDatesDragged: (stageId: string, newStart: string, newEnd: string) => void;
}) {
  const [preview, setPreview] = useState<{ start: string; end: string } | null>(null);
  const start = preview?.start ?? stage.startDate;
  const end = preview?.end ?? stage.endDate;
  const milestone = isStageMilestone({ startDate: start, endDate: end });
  const status: string = (stage as any).status;
  const meta = STAGE_STATUS_META[status as keyof typeof STAGE_STATUS_META];

  const { begin, onMove, onUp } = useDragHandlers({
    canEdit, dayWidth, stage,
    onPreview: (s, e) => setPreview({ start: s, end: e }),
    onCommit: (s, e) => { setPreview(null); onStageDatesDragged(stage.id, s, e); },
    onClickNoMove: () => { setPreview(null); onOpenStage(); },
  });

  const left = diffIsoDays(originDate, start) * dayWidth;
  const widthDays = diffIsoDays(start, end) + 1;
  const width = Math.max(widthDays * dayWidth, milestone ? dayWidth * 0.9 : dayWidth);

  const plannedChanged = stage.plannedStartDate !== stage.startDate || stage.plannedEndDate !== stage.endDate;
  const plannedLeft = diffIsoDays(originDate, stage.plannedStartDate) * dayWidth;
  const plannedWidth = Math.max((diffIsoDays(stage.plannedStartDate, stage.plannedEndDate) + 1) * dayWidth, dayWidth * 0.9);

  const ringStyle: React.CSSProperties = status === 'atrasada'
    ? { boxShadow: `0 0 0 2px var(--text-danger)` }
    : status === 'em_risco'
      ? { boxShadow: `0 0 0 2px var(--text-warning-strong)`, borderStyle: 'dashed' }
      : status === 'concluida'
        ? { boxShadow: `0 0 0 2px var(--text-success)` }
        : {};

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 select-none"
      style={{ left, width, height: laneHeight }}
      title={`${stage.name} — ${formatIsoDatePtBr(start)}${start !== end ? ` a ${formatIsoDatePtBr(end)}` : ''} — ${meta?.label || status}`}
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
          'relative h-full rounded-xl flex items-center overflow-hidden border',
          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          milestone && 'rounded-full justify-center'
        )}
        style={{
          backgroundColor: stage.color,
          opacity: status === 'pendente' ? 0.55 : 1,
          borderColor: 'rgba(255,255,255,0.35)',
          marginTop: plannedChanged ? 3 : 0,
          ...ringStyle,
        }}
      >
        {milestone ? (
          <Flag size={isSingle ? 14 : 11} className="text-white shrink-0" />
        ) : (
          <>
            {canEdit && (
              <div onPointerDown={begin('resize-start')} onPointerMove={onMove} onPointerUp={onUp} className="absolute left-0 top-0 h-full w-2 cursor-ew-resize" />
            )}
            {isSingle && <span className="px-2.5 text-[11px] font-bold text-white truncate drop-shadow-sm">{stage.name}</span>}
            {canEdit && (
              <div onPointerDown={begin('resize-end')} onPointerMove={onMove} onPointerUp={onUp} className="absolute right-0 top-0 h-full w-2 cursor-ew-resize" />
            )}
          </>
        )}
        {status === 'concluida' && <CheckCircle2 size={12} className="absolute -right-1 -top-1 text-white bg-[var(--text-success)] rounded-full" />}
        {status === 'atrasada' && <AlertTriangle size={11} className="absolute -right-1 -top-1 text-white bg-[var(--text-danger)] rounded-full p-[1px]" />}
        {!isSingle && itemCount > 0 && (
          <span className="absolute -left-1 -bottom-1 min-w-[14px] h-[14px] px-1 rounded-full bg-[var(--text-primary)] text-white text-[8px] font-black flex items-center justify-center leading-none">
            {itemCount}
          </span>
        )}
      </div>
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
  const visible = useMemo(() => {
    const base = mode === 'single' && singleCycleId
      ? cycles.filter(c => c.id === singleCycleId)
      : cycles.filter(c => visibleCycleIds.includes(c.id));
    return base.filter(c => c.stages.length > 0);
  }, [cycles, visibleCycleIds, mode, singleCycleId]);

  const dayWidth = mode === 'single' ? DAY_WIDTH_SINGLE : DAY_WIDTH_ALL;
  const laneHeight = mode === 'single' ? 40 : 26;
  const laneExtra = mode === 'single' ? 34 : 12; // espaço extra pra marcadores de item (só no modo "Uma só")

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
      <div className="overflow-x-auto">
        <div style={{ width: LANE_LABEL_WIDTH + (totalDays + 1) * dayWidth, minWidth: '100%' }}>
          {/* Cabeçalho: mês(es) + número de cada dia, sempre visível */}
          <div className="sticky top-0 z-10 bg-[var(--surface-card)] border-b border-[var(--border-default)]">
            <div className="flex border-b border-[var(--border-default)]/60">
              <div style={{ width: LANE_LABEL_WIDTH }} className="shrink-0 border-r border-[var(--border-default)]" />
              <div className="flex" style={{ width: (totalDays + 1) * dayWidth }}>
                {monthSegments.map((seg, i) => (
                  <div
                    key={i}
                    style={{ width: seg.span * dayWidth }}
                    className="shrink-0 text-center py-1.5 text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] bg-[var(--surface-pill)]/50 border-r border-[var(--border-default)]/60 truncate"
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
                        'shrink-0 text-center py-2 text-[10px] font-bold tabular-nums border-r border-[var(--border-default)]/40',
                        isToday ? 'text-white bg-[var(--text-danger)]' : weekend ? 'text-[var(--text-tertiary)]/70 bg-[var(--surface-pill)]/40' : 'text-[var(--text-tertiary)]'
                      )}
                    >
                      {date.getDate()}
                    </div>
                  );
                })}
                <div
                  className="absolute -top-1 text-[8px] font-black uppercase text-white bg-[var(--text-danger)] rounded px-1 py-0.5 pointer-events-none"
                  style={{ left: Math.max(0, todayLeft + dayWidth / 2 - 10) }}
                >
                  Hoje
                </div>
              </div>
            </div>
          </div>

          {/* Raias */}
          <div className="relative">
            <div className="absolute top-0 bottom-0 w-px bg-[var(--text-danger)]/40" style={{ left: LANE_LABEL_WIDTH + todayLeft + dayWidth / 2 }} />
            {visible.map(cycle => {
              const stagesWithStatus = computeStagesWithStatus(cycle.stages, today);
              const itemsByStage = new Map<string, ReleaseItem[]>();
              for (const it of cycle.items) {
                if (!it.currentStageId) continue;
                const list = itemsByStage.get(it.currentStageId) || [];
                list.push(it);
                itemsByStage.set(it.currentStageId, list);
              }
              const unpositioned = cycle.items.filter(it => !it.currentStageId);
              return (
                <div key={cycle.id} className="border-b border-[var(--border-default)]/60 last:border-b-0">
                  <div className="flex hover:bg-[var(--surface-pill)]/30 transition-colors">
                    <div style={{ width: LANE_LABEL_WIDTH }} className="shrink-0 border-r border-[var(--border-default)] px-4 py-2 flex items-center gap-2 min-w-0">
                      {cycle.publishedAt && <Lock size={12} className="text-[var(--text-tertiary)] shrink-0" />}
                      <button onClick={() => onFocusCycle(cycle.id)} className="min-w-0 text-left group" title="Ver só este ciclo">
                        <p className="text-xs font-black text-[var(--text-primary)] truncate group-hover:text-[var(--accent-text)] group-hover:underline">{cycle.name}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{cycle.items.length} item(ns)</p>
                      </button>
                    </div>
                    <div className="relative" style={{ width: (totalDays + 1) * dayWidth, height: laneHeight + laneExtra }}>
                      {stagesWithStatus.map(stage => (
                        <StageBar
                          key={stage.id}
                          stage={stage as any}
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
                          <div key={`items-${stage.id}`} className="absolute flex items-center gap-1" style={{ left, top: laneHeight + 8 }}>
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

      {/* Legenda de status — separada da cor do item (identidade por tipo),
          nunca a mesma coisa (ver dataviz: status é canal reservado). */}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-[var(--border-default)] bg-[var(--surface-pill)]/30">
        <div className="flex flex-wrap items-center gap-3">
          {(['pendente', 'em_andamento', 'em_risco', 'atrasada', 'concluida'] as const).map(s => (
            <span key={s} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: STAGE_STATUS_META[s].textVar }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STAGE_STATUS_META[s].textVar }} />
              {STAGE_STATUS_META[s].label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-l border-[var(--border-default)] pl-4">
          {(['hotfix', 'emergencial', 'prevista'] as const).map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RELEASE_ITEM_TYPE_META[t].color }} />
              {RELEASE_ITEM_TYPE_META[t].label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
