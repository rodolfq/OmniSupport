import { query } from '../db';
import { EmailService } from './email-service';

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
  const link = baseUrl ? `${baseUrl}/internal-tickets/${ticket.id}` : null;

  const subject = reason === 'created'
    ? `Novo ticket interno ${ticketLabel} para ${teamName} — SSX Desk`
    : `Ticket interno ${ticketLabel} atribuído — SSX Desk`;

  const intro = reason === 'created'
    ? `Um novo ticket interno foi aberto para o time <strong>${teamName}</strong>.`
    : `Um ticket interno do time <strong>${teamName}</strong> teve um responsável atribuído.`;

  const html = `
    <p>${intro}</p>
    <p><strong>${ticketLabel} — ${ticket.title || ''}</strong></p>
    ${link ? `<p><a href="${link}">Abrir ticket interno</a></p>` : ''}
  `.trim();

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
