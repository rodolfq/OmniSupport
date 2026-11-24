import React from 'react';
import { Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

// "Prioridade máxima na fila" do ticket interno (2026-11-23,
// migrations/internal_ticket_queue_top_priority.sql). Uma marcação acima das
// estrelas: o ticket fica no topo e destacado na sua fila em Todos os
// Chamados > Tickets Internos, Meus Chamados e Dashboard. Vários podem estar
// marcados na mesma fila; entre eles vale a ordem normal da tela.

type WithTopPriority = { queueTopPriority?: boolean | null; queue_top_priority?: boolean | null };

export function isQueueTopPriority(t: WithTopPriority | null | undefined): boolean {
  return !!(t && (t.queueTopPriority ?? t.queue_top_priority));
}

// Ordenação ESTÁVEL: marcados primeiro, o resto mantém a ordem que já tinha.
// Aplicar em cima da lista já ordenada pela tela (cada coluna do Kanban é
// filtrada desta lista e herda a ordem).
export function sortQueueTopPriorityFirst<T extends WithTopPriority>(list: T[]): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (Number(isQueueTopPriority(b.item)) - Number(isQueueTopPriority(a.item))) || (a.index - b.index))
    .map(x => x.item);
}

// Moldura do card/linha marcado. Cor de alerta (vermelho) de propósito: é a
// marcação mais forte que um ticket interno pode ter.
export const QUEUE_TOP_PRIORITY_CARD_CLASS = 'ring-2 ring-[var(--text-danger)]/60 border-[var(--text-danger)]/40 bg-[var(--surface-danger)]/40';
export const QUEUE_TOP_PRIORITY_ROW_CLASS = 'bg-[var(--surface-danger)]/50';

export function QueueTopPriorityBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      title="Prioridade máxima na fila: acima de todos os outros tickets abertos da fila"
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-[var(--text-danger)] text-white font-black uppercase tracking-widest shrink-0',
        compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
        className
      )}
    >
      <Flame size={compact ? 9 : 10} aria-hidden="true" />
      {compact ? 'Máxima' : 'Prioridade máxima'}
    </span>
  );
}
