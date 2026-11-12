import { query } from '../db';
import { EmailService } from './email-service';
import { wrapEmailHtml, ticketRefBlock } from '../email-templates';

// Linha crua de public.internal_tickets (snake_case), como vem de
// INSERT/UPDATE ... RETURNING * na rota compat (ver app/api/compat/supabase/route.ts).
export interface InternalTicketRow {
  id: string;
  internal_ticket_number: number;
  title: string;
  internal_team_id: string | null;
  assignee_id: string | null;
  status: string;
}

// Tickets internos não têm nenhuma automação hoje (nem WhatsApp, nem
// e-mail) — diferente de public.tickets, o destinatário aqui é a EQUIPE
// (profiles.internal_team_ids), não um cliente. Texto fixo no código, mesmo
// padrão simples do notifyAssigneeByEmail em automation-service.ts, em vez
// de tentar encaixar num sistema de Mensagens Automáticas pensado pra
// chamado-cliente.
async function notifyInternalTeamByEmail(ticket: InternalTicketRow, reason: 'created' | 'assigned'): Promise<void> {
  if (!ticket.internal_team_id) return;

  const teamRes = await query('SELECT name FROM public.internal_teams WHERE id = $1', [ticket.internal_team_id]);
  const teamName = teamRes.rows[0]?.name || 'sua equipe';

  const membersRes = await query('SELECT email, name FROM public.profiles WHERE $1 = ANY(internal_team_ids)', [ticket.internal_team_id]);
  const members = membersRes.rows.filter((m: any) => m.email);
  if (members.length === 0) return;

  const ticketLabel = `#${String(ticket.internal_ticket_number ?? '').padStart(4, '0')}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  // Número simples (mesmo padrão de /tickets/4940 pro chamado de cliente),
  // não o id interno (UUID) — pedido do usuário, 2026-10-21. A rota aceita
  // os dois (ver app/api/internal-tickets/route.ts, action=detail).
  const link = baseUrl ? `${baseUrl}/internal-tickets/${ticket.internal_ticket_number}` : null;

  const subject = reason === 'created'
    ? `Novo ticket interno ${ticketLabel} para ${teamName} — SSX Desk`
    : `Ticket interno ${ticketLabel} atribuído — SSX Desk`;

  const intro = reason === 'created'
    ? `Um novo ticket interno foi aberto para o time <strong>${teamName}</strong>.`
    : `Um ticket interno do time <strong>${teamName}</strong> teve um responsável atribuído.`;

  // Mesmo template/layout dos e-mails de chamado ao cliente (wrapEmailHtml +
  // ticketRefBlock) — cabeçalho com a marca, número/título do ticket sempre
  // em linha própria e destacada, e botão de CTA de verdade (não só um link
  // cru) pro operador abrir o ticket rapidamente.
  const bodyHtml = `
    <p style="margin:0 0 10px;">${intro}</p>
    ${ticketRefBlock(ticketLabel, ticket.title)}
  `.trim();
  const html = wrapEmailHtml({ bodyHtml, ctaUrl: link, ctaLabel: 'Abrir ticket interno' });

  for (const member of members) {
    try {
      await EmailService.send(member.email, subject, html);
    } catch (err) {
      console.error(`[email] Falha ao notificar ${member.email} sobre ticket interno ${ticket.id}:`, err);
    }
  }
}

/** Chamar sem await (fire-and-forget) na criação de um ticket interno. */
export function handleInternalTicketCreated(ticket: InternalTicketRow): void {
  notifyInternalTeamByEmail(ticket, 'created').catch(err => console.error('[email] handleInternalTicketCreated:', err));
}

/** Chamar sem await (fire-and-forget) na atualização de um ticket interno. */
export function handleInternalTicketUpdated(oldTicket: InternalTicketRow | null | undefined, newTicket: InternalTicketRow | null | undefined): void {
  if (!oldTicket || !newTicket) return;
  (async () => {
    if (oldTicket.internal_team_id !== newTicket.internal_team_id && newTicket.internal_team_id) {
      await notifyInternalTeamByEmail(newTicket, 'created');
      return;
    }
    if (oldTicket.assignee_id !== newTicket.assignee_id && newTicket.assignee_id) {
      await notifyInternalTeamByEmail(newTicket, 'assigned');
    }
  })().catch(err => console.error('[email] handleInternalTicketUpdated:', err));
}

// ---------------------------------------------------------------------------
// Toda mudança em ticket interno avisa por e-mail o CRIADOR e o RESPONSÁVEL
// do momento (2026-11-12, pedido do usuário) — nota nova, alteração de campo,
// descrição, edição em massa, criação com responsável. Quem fez a mudança não
// recebe. O aviso dentro da plataforma (sininho/toast) sai do polling de
// app/api/notifications/check, que lê as mesmas mensagens gravadas.
//
// Chamado pela rota (app/api/internal-tickets/route.ts) logo depois de gravar
// — fire-and-forget: SMTP desligado/fora do ar nunca atrapalha a gravação.

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Texto da mensagem sem HTML (nota vem do editor rico), em parágrafos.
function textToEmailHtml(text: string): string {
  const plain = text
    .replace(/<img[^>]*>/gi, ' [imagem] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim()
    .slice(0, 1500);
  return plain.split(/\n+/).map(l => l.trim()).filter(Boolean)
    .map(l => `<p style="margin:0 0 6px;">${escapeHtml(l)}</p>`).join('');
}

export type InternalTicketChangeKind = 'note' | 'change' | 'created';

export async function notifyInternalTicketChange(params: {
  internalTicketId: string;
  actorId: string | null;
  actorName?: string | null;
  kind: InternalTicketChangeKind;
  text?: string;
}): Promise<void> {
  const { internalTicketId, actorId, kind } = params;
  const tRes = await query(
    `SELECT it.id, it.internal_ticket_number, it.title, it.creator_id, it.assignee_id
       FROM public.internal_tickets it WHERE it.id = $1`,
    [internalTicketId]
  );
  const t = tRes.rows[0];
  if (!t) return;

  const recipientIds = [...new Set([t.creator_id, t.assignee_id].filter(Boolean) as string[])]
    .filter(id => id !== actorId);
  if (recipientIds.length === 0) return;
  const peopleRes = await query(`SELECT id, name, email FROM public.profiles WHERE id = ANY($1) AND email IS NOT NULL`, [recipientIds]);
  if (peopleRes.rows.length === 0) return;

  let actorName = params.actorName || null;
  if (!actorName && actorId) {
    actorName = (await query('SELECT name FROM public.profiles WHERE id = $1', [actorId])).rows[0]?.name || null;
  }
  const quem = escapeHtml(actorName || 'Alguém');
  const label = `int-${String(t.internal_ticket_number ?? '').padStart(4, '0')}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const link = baseUrl ? `${baseUrl}/internal-tickets/${t.internal_ticket_number}` : null;

  const subject = kind === 'note'
    ? `Nova nota no ticket interno ${label} — SSX Desk`
    : kind === 'created'
      ? `Ticket interno ${label} atribuído a você — SSX Desk`
      : `Ticket interno ${label} atualizado — SSX Desk`;
  const intro = kind === 'note'
    ? `<strong>${quem}</strong> adicionou uma nota ao ticket interno:`
    : kind === 'created'
      ? `<strong>${quem}</strong> abriu um ticket interno com você como responsável:`
      : `<strong>${quem}</strong> alterou o ticket interno:`;
  const detalhe = params.text ? textToEmailHtml(params.text) : '';
  const bodyHtml = `
    <p style="margin:0 0 10px;">${intro}</p>
    ${ticketRefBlock(label, t.title)}
    ${detalhe ? `<div style="margin:12px 0 0;padding:12px;border-radius:8px;background:#f5f5f5;">${detalhe}</div>` : ''}
  `.trim();
  const html = wrapEmailHtml({ bodyHtml, ctaUrl: link, ctaLabel: 'Abrir ticket interno' });

  for (const person of peopleRes.rows) {
    try {
      await EmailService.send(person.email, subject, html);
    } catch (err: any) {
      // SMTP desligado é o caso comum em dev — uma linha só, sem stack.
      console.error(`[email] Ticket interno ${label}: aviso a ${person.email} não enviado — ${err?.message || err}`);
    }
  }
}

/** Fire-and-forget: nunca lança, nunca atrasa quem chamou. */
export function queueInternalTicketChangeEmail(params: Parameters<typeof notifyInternalTicketChange>[0]): void {
  notifyInternalTicketChange(params).catch(err => console.error('[email] notifyInternalTicketChange:', err));
}
