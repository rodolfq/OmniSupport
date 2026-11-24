'use client';

import React from 'react';
import { ChevronsLeftRight, ChevronsRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Recolher/expandir coluna de Kanban (2026-11-24, "como no Odoo"). Usado pelos
 * 6 Kanbans junto com hooks/use-collapsed-kanban-columns.ts.
 */

/** Botão no cabeçalho da coluna aberta. */
export function KanbanCollapseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      title="Recolher coluna"
      aria-label={`Recolher a coluna ${label}`}
      className="p-1 -mr-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-pill)] shrink-0"
    >
      <ChevronsRightLeft size={14} />
    </button>
  );
}

/**
 * Coluna recolhida: faixa vertical com nome e contagem. Recebe a ref de soltar
 * (useDroppable) da própria coluna — dá para arrastar um card para ela mesmo
 * recolhida. Clicar em qualquer ponto expande.
 */
export const KanbanCollapsedColumn = React.forwardRef<HTMLDivElement, {
  label: string;
  count: number;
  accent?: string;
  dotClass?: string;
  isOver?: boolean;
  onExpand: () => void;
}>(function KanbanCollapsedColumn({ label, count, accent, dotClass, isOver, onExpand }, ref) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand(); } }}
      title={`Expandir ${label}`}
      aria-label={`Expandir a coluna ${label} (${count})`}
      className={cn(
        'shrink-0 w-11 min-h-[240px] snap-start rounded-2xl border-t-4 flex flex-col items-center gap-3 py-3 transition-all',
        isOver ? 'bg-[var(--surface-pill)] ring-2 ring-[var(--accent)]/30' : 'bg-[var(--surface-card)] hover:bg-[var(--surface-pill)]'
      )}
      style={accent ? { borderTopColor: accent } : undefined}
    >
      <ChevronsLeftRight size={14} className="text-[var(--text-tertiary)] shrink-0" />
      <span className="text-[10px] font-bold text-[var(--text-tertiary)] bg-[var(--surface-pill)] px-1.5 py-0.5 rounded-full">{count}</span>
      {dotClass && <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />}
      <span className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)] [writing-mode:vertical-rl] whitespace-nowrap">
        {label}
      </span>
    </div>
  );
});
