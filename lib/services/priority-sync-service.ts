import { query } from '../db';
import { logAudit } from '../audit-log';

/**
 * Sincronização de prioridade (estrelas) entre chamado (`tickets.priority`,
 * TEXTO — Baixa/Média/Alta/Urgente) e ticket interno (`internal_tickets.priority`,
 * INTEIRO 1-4, já é a contagem de estrelas direto) — pedido do usuário,
 * 2026-10-20: "Chamados e tickets internos vinculados devem ter a mesma
 * quantidade de estrelas."
 *
 * O mapeamento Baixa/Média/Alta/Urgente -> 1-4 já existia, hardcoded, só no
 * client (components/ticket-detail-modal.tsx, estrelas de prioridade do
 * chamado) — centralizado aqui pra servidor e cliente usarem o mesmo.
 */
const PRIORITY_LABELS = ['Baixa', 'Média', 'Alta', 'Urgente'];

export function ticketPriorityToStars(label: string | null | undefined): number {
  const idx = PRIORITY_LABELS.indexOf(label || '');
  return idx >= 0 ? idx + 1 : 1;
}

export function starsToTicketPriorityLabel(stars: number | null | undefined): string {
  const clamped = Math.min(Math.max(Math.round(Number(stars)) || 1, 1), PRIORITY_LABELS.length);
  return PRIORITY_LABELS[clamped - 1];
}

export interface SyncActor {
  id: string | null;
  name: string;
}

/**
 * Chamado teve a prioridade alterada — reflete em TODO ticket interno já
 * vinculado (ticket_internal_links) que estiver com estrela diferente.
 * Seguro de chamar sempre que `priority` aparecer no payload de update do
 * chamado, mesmo sem ter mudado de verdade: a condição `IS DISTINCT FROM`
 * no JOIN já filtra pra só tocar quem realmente está fora de sincronia.
 */
export async function cascadePriorityFromTicket(ticketId: string, newPriorityLabel: string, actor: SyncActor): Promise<void> {
  const stars = ticketPriorityToStars(newPriorityLabel);
  const linked = await query(
    `SELECT it.id, it.priority, it.internal_ticket_number FROM public.ticket_internal_links l
       JOIN public.internal_tickets it ON it.id = l.internal_ticket_id
      WHERE l.ticket_id = $1 AND it.priority IS DISTINCT FROM $2`,
    [ticketId, stars]
  );
  for (const row of linked.rows) {
    await query('UPDATE public.internal_tickets SET priority = $1, updated_at = now() WHERE id = $2', [stars, row.id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'internal_ticket', entityId: row.id,
      entityLabel: `int-${String(row.internal_ticket_number).padStart(4, '0')}`,
      changes: { field: 'priority', from: row.priority, to: stars, reason: 'sync_linked_priority', sourceTicketId: ticketId }
    });
  }
}

/** Mesma ideia, na direção ticket interno -> chamado(s) vinculado(s). */
export async function cascadePriorityFromInternalTicket(internalTicketId: string, newStars: number, actor: SyncActor): Promise<void> {
  const label = starsToTicketPriorityLabel(newStars);
  const linked = await query(
    `SELECT t.id, t.priority, t.public_ticket_number FROM public.ticket_internal_links l
       JOIN public.tickets t ON t.id = l.ticket_id
      WHERE l.internal_ticket_id = $1 AND t.priority IS DISTINCT FROM $2`,
    [internalTicketId, label]
  );
  for (const row of linked.rows) {
    await query('UPDATE public.tickets SET priority = $1, updated_at = now() WHERE id = $2', [label, row.id]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'ticket', entityId: row.id,
      entityLabel: `#${row.public_ticket_number}`,
      changes: { field: 'priority', from: row.priority, to: label, reason: 'sync_linked_priority', sourceInternalTicketId: internalTicketId }
    });
  }
}

export interface PrioritySyncResult {
  synced: boolean;
  winner?: 'ticket' | 'internal';
  starsBefore?: number;
  starsAfter?: number;
}

/**
 * Chamada no momento de LINKAR um chamado já existente a um ticket interno
 * já existente (os dois já tinham vida própria — só agora que estão sendo
 * ligados é que um conflito de prioridade pode aparecer). Resolve sempre a
 * favor de quem foi aberto PRIMEIRO (created_at mais antigo). Devolve um
 * resumo pro client avisar o usuário — nunca sincroniza em silêncio quando
 * havia divergência real.
 */
export async function reconcilePriorityOnLink(ticketId: string, internalTicketId: string, actor: SyncActor): Promise<PrioritySyncResult> {
  const res = await query(
    `SELECT t.priority AS t_priority, t.created_at AS t_created_at, t.public_ticket_number,
            it.priority AS it_priority, it.created_at AS it_created_at, it.internal_ticket_number
       FROM public.tickets t, public.internal_tickets it
      WHERE t.id = $1 AND it.id = $2`,
    [ticketId, internalTicketId]
  );
  if (res.rowCount === 0) return { synced: false };
  const row = res.rows[0];
  const ticketStars = ticketPriorityToStars(row.t_priority);
  const internalStars = Number(row.it_priority);
  if (ticketStars === internalStars) return { synced: false };

  const ticketIsOlder = new Date(row.t_created_at).getTime() <= new Date(row.it_created_at).getTime();
  if (ticketIsOlder) {
    await query('UPDATE public.internal_tickets SET priority = $1, updated_at = now() WHERE id = $2', [ticketStars, internalTicketId]);
    logAudit({
      actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'internal_ticket', entityId: internalTicketId,
      entityLabel: `int-${String(row.internal_ticket_number).padStart(4, '0')}`,
      changes: { field: 'priority', from: internalStars, to: ticketStars, reason: 'sync_on_link', winner: 'ticket', linkedTicketId: ticketId }
    });
    return { synced: true, winner: 'ticket', starsBefore: internalStars, starsAfter: ticketStars };
  }

  const newLabel = starsToTicketPriorityLabel(internalStars);
  await query('UPDATE public.tickets SET priority = $1, updated_at = now() WHERE id = $2', [newLabel, ticketId]);
  logAudit({
    actorId: actor.id, actorName: actor.name, action: 'update', entityType: 'ticket', entityId: ticketId,
    entityLabel: `#${row.public_ticket_number}`,
    changes: { field: 'priority', from: row.t_priority, to: newLabel, reason: 'sync_on_link', winner: 'internal', linkedInternalTicketId: internalTicketId }
  });
  return { synced: true, winner: 'internal', starsBefore: ticketStars, starsAfter: internalStars };
}
