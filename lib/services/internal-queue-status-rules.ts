import { query } from '@/lib/db';

/**
 * Status por fila de ticket interno (2026-11-24) — checagem no servidor.
 * Espelha lib/internal-queue-statuses.ts (cliente), mas lê direto do banco
 * por rótulo, que é como o ticket guarda o status.
 *
 * Fila sem configuração (nenhuma linha em internal_ticket_queue_statuses) ou
 * banco ainda sem a tabela = sem restrição, como antes.
 */

export interface QueueStatusRule {
  queueName: string;
  /** Rótulos de topo, na ordem da fila. */
  tops: { label: string; isClosed: boolean }[];
  /** Sub-status permitidos por rótulo do pai. */
  subsByParent: Map<string, Set<string>>;
}

export async function loadQueueStatusRule(queueId: string | null | undefined): Promise<QueueStatusRule | null> {
  if (!queueId) return null;
  try {
    const res = await query(
      `SELECT cs.label, cs.is_closed, p.label AS parent_label, q.name AS queue_name, qs.status_id, cs.parent_status_id,
              EXISTS (SELECT 1 FROM public.internal_ticket_queue_statuses x
                       WHERE x.queue_id = qs.queue_id AND x.status_id = cs.parent_status_id) AS parent_in_queue
         FROM public.internal_ticket_queue_statuses qs
         JOIN public.config_statuses cs ON cs.id = qs.status_id
         JOIN public.internal_ticket_queues q ON q.id = qs.queue_id
         LEFT JOIN public.config_statuses p ON p.id = cs.parent_status_id
        WHERE qs.queue_id = $1::uuid
        ORDER BY qs.sort_order`,
      [queueId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    const rule: QueueStatusRule = { queueName: res.rows[0].queue_name, tops: [], subsByParent: new Map() };
    for (const r of res.rows) {
      if (!r.parent_status_id) {
        rule.tops.push({ label: r.label, isClosed: !!r.is_closed });
      } else if (r.parent_in_queue) {
        if (!rule.subsByParent.has(r.parent_label)) rule.subsByParent.set(r.parent_label, new Set());
        rule.subsByParent.get(r.parent_label)!.add(r.label);
      }
    }
    return rule;
  } catch (err: any) {
    if (err?.code === '42P01') return null; // migration ainda não aplicada
    throw err;
  }
}

/** Mensagem de erro, ou null quando a combinação vale para a fila. */
export function statusErrorForRule(rule: QueueStatusRule | null, status: string | null | undefined, subStatus: string | null | undefined): string | null {
  if (!rule) return null;
  const label = status || 'Novo';
  if (!rule.tops.some(t => t.label === label)) {
    return `O status "${label}" não é usado na fila "${rule.queueName}". Escolha um status desta fila.`;
  }
  if (subStatus && !rule.subsByParent.get(label)?.has(subStatus)) {
    return `O sub-status "${subStatus}" não é usado na fila "${rule.queueName}".`;
  }
  return null;
}

/** Status com que um ticket novo nasce na fila: "Novo" se a fila usa, senão o 1º aberto. */
export function initialStatusForRule(rule: QueueStatusRule | null): string {
  if (!rule || rule.tops.some(t => t.label === 'Novo')) return 'Novo';
  return (rule.tops.find(t => !t.isClosed) || rule.tops[0])?.label || 'Novo';
}

/** Primeiro status fechado da fila (ou null = sem restrição: use o do cadastro). */
export function closedStatusForRule(rule: QueueStatusRule | null): string | null {
  if (!rule) return null;
  return rule.tops.find(t => t.isClosed)?.label || null;
}
