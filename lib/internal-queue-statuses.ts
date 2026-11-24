import type { StatusConfig } from '@/lib/types';

/**
 * Status por fila de ticket interno (2026-11-24) — regra compartilhada por
 * cliente e servidor (sem import de pg/Next).
 *
 * O cadastro de status é único; a fila só escolhe quais usa
 * (`InternalTicketQueue.statusIds`, ordenado). Lista vazia = a fila usa todos.
 * Sub-status é escolhido um a um e só vale se o pai também estiver na fila.
 */

export interface QueueWithStatuses {
  id: string;
  statusIds?: string[];
}

export function queueHasStatusConfig(queue: QueueWithStatuses | null | undefined): boolean {
  return !!queue && Array.isArray(queue.statusIds) && queue.statusIds.length > 0;
}

/**
 * Status (de topo e sub-status) que valem para a fila, já na ordem da fila.
 * Sem fila ou fila sem configuração: devolve o cadastro inteiro, como sempre.
 */
export function statusesForQueue<T extends StatusConfig>(all: T[], queue: QueueWithStatuses | null | undefined): T[] {
  if (!queueHasStatusConfig(queue)) return all;
  const order = new Map(queue!.statusIds!.map((id, i) => [id, i]));
  const byId = new Map(all.map(s => [s.id, s]));
  return all
    .filter(s => {
      if (!order.has(s.id)) return false;
      if (!s.parentStatusId) return true;
      // Sub-status sem o pai na fila não aparece (o pai é quem vira coluna/opção).
      return order.has(s.parentStatusId) && byId.has(s.parentStatusId);
    })
    .map(s => ({ ...s, sortOrder: order.get(s.id)! }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

/** Status de topo + sub-status permitidos, por rótulo — para validar uma escolha. */
export function isStatusAllowedInQueue(
  all: StatusConfig[],
  queue: QueueWithStatuses | null | undefined,
  status: string | null | undefined,
  subStatus?: string | null
): boolean {
  if (!queueHasStatusConfig(queue)) return true;
  const allowed = statusesForQueue(all, queue);
  const top = allowed.find(s => !s.parentStatusId && s.label === (status || 'Novo'));
  if (!top) return false;
  if (!subStatus) return true;
  return allowed.some(s => s.parentStatusId === top.id && s.label === subStatus);
}

/** Primeiro status aberto da fila — usado quando o ticket nasce numa fila sem "Novo". */
export function initialStatusForQueue(all: StatusConfig[], queue: QueueWithStatuses | null | undefined): string {
  if (!queueHasStatusConfig(queue)) return 'Novo';
  const tops = statusesForQueue(all, queue).filter(s => !s.parentStatusId);
  if (tops.some(s => s.label === 'Novo')) return 'Novo';
  return (tops.find(s => !s.isClosed) || tops[0])?.label || 'Novo';
}
