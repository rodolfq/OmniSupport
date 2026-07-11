import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { isClosedTicketStatus } from '@/lib/ticket-status';

function isCompanyUser(role?: string | null) {
  return role === 'Cliente' || role === 'Funcionário';
}

function isTeamUser(role?: string | null) {
  return role === 'Administrador' || role === 'Equipe' || role === 'Time Interno';
}

function ticketNumberLabel(ticketNumber?: number | string | null, id?: string) {
  return ticketNumber ? `#${String(ticketNumber).padStart(4, '0')}` : `#${String(id || '').slice(0, 8)}`;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;

    if (!token) {
      return NextResponse.json({ notifications: [] }, { status: 401 });
    }

    const decoded = await verifyJWT(token);
    if (!decoded?.id) {
      return NextResponse.json({ notifications: [] }, { status: 401 });
    }

    const sinceParam = request.nextUrl.searchParams.get('since');
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam))
      ? new Date(sinceParam).toISOString()
      : new Date(Date.now() - 30_000).toISOString();

    const userResult = await query(
      'SELECT id, name, role, company_id, phone, view_all_company_tickets FROM public.profiles WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rowCount === 0) {
      return NextResponse.json({ notifications: [] }, { status: 401 });
    }

    const user = userResult.rows[0];
    const events: any[] = [];

    const chatWhere = isTeamUser(user.role)
      ? `(m.sender_id IS NULL OR m.sender_id <> $2::uuid)`
      : `(s.customer_id = $2::uuid OR (s.customer_phone IS NOT NULL AND $3::text IS NOT NULL AND regexp_replace(s.customer_phone, '\\D', '', 'g') = regexp_replace($3::text, '\\D', '', 'g'))) AND (m.sender_id IS NULL OR m.sender_id <> $2::uuid)`;

    const chatParams = isTeamUser(user.role) ? [since, user.id] : [since, user.id, user.phone || null];
    const chatMessages = await query(
      `SELECT m.id, m.session_id, m.sender_name, m.text, m.created_at, s.customer_name
       FROM public.chat_messages m
       JOIN public.chat_sessions s ON s.id = m.session_id
       WHERE m.created_at > $1
         AND ${chatWhere}
       ORDER BY m.created_at ASC
       LIMIT 50`,
      chatParams
    );

    chatMessages.rows.forEach((message) => {
      const senderName = message.sender_name || (isCompanyUser(user.role) ? 'Suporte' : message.customer_name || 'Cliente');
      events.push({
        sourceId: `chat_message:${message.id}`,
        title: `Nova mensagem de ${senderName}`,
        message: message.text || 'Anexo enviado',
        type: 'chat_message',
        targetId: message.session_id,
        createdAt: message.created_at
      });
    });

    const relevantTicketClause = isCompanyUser(user.role)
      ? user.view_all_company_tickets
        ? `($3::boolean IS NOT NULL AND (t.company_id = $4::uuid OR t.customer_id = $2::uuid OR $2::uuid = ANY(COALESCE(t.employee_ids, '{}'::uuid[]))))`
        : `($3::boolean IS NOT NULL AND (t.customer_id = $2::uuid OR $2::uuid = ANY(COALESCE(t.employee_ids, '{}'::uuid[]))))`
      : `($3::boolean = true OR t.assignee_id = $2::uuid OR t.created_by = $2::uuid)`;
    const relevantTicketParams = isCompanyUser(user.role) && user.view_all_company_tickets
      ? [since, user.id, true, user.company_id || null]
      : [since, user.id, user.role === 'Administrador' || user.role === 'Equipe' || isCompanyUser(user.role)];

    const ticketMessages = await query(
      `SELECT m.id, m.ticket_id, m.content, m.created_at, t.title, t.public_ticket_number
       FROM public.ticket_messages m
       JOIN public.tickets t ON t.id = m.ticket_id
       WHERE m.created_at > $1
         AND (m.author_id IS NULL OR m.author_id <> $2::uuid)
         AND (${isCompanyUser(user.role) ? 'm.is_visible_to_customer = true' : 'true'})
         AND ${relevantTicketClause}
       ORDER BY m.created_at ASC
       LIMIT 50`,
      relevantTicketParams
    );

    ticketMessages.rows.forEach((message) => {
      events.push({
        sourceId: `ticket_message:${message.id}`,
        title: `Atualização no chamado ${ticketNumberLabel(message.public_ticket_number, message.ticket_id)}`,
        message: message.content || message.title,
        type: 'ticket_update',
        targetId: message.ticket_id,
        createdAt: message.created_at
      });
    });

    const changedTickets = await query(
      `SELECT t.id, t.public_ticket_number, t.title, t.status, t.created_at, t.updated_at, t.assignee_id
       FROM public.tickets t
       WHERE t.updated_at > $1
         AND t.updated_at > t.created_at
         AND ${relevantTicketClause}
       ORDER BY t.updated_at ASC
       LIMIT 50`,
      relevantTicketParams
    );

    changedTickets.rows.forEach((ticket) => {
      const closed = isClosedTicketStatus(ticket.status);
      const assignedToUser = ticket.assignee_id === user.id;
      const type = closed ? 'ticket_closed' : assignedToUser && !isCompanyUser(user.role) ? 'ticket_assigned' : 'ticket_update';
      const title = closed
        ? `Chamado encerrado ${ticketNumberLabel(ticket.public_ticket_number, ticket.id)}`
        : type === 'ticket_assigned'
          ? `Chamado atribuído ${ticketNumberLabel(ticket.public_ticket_number, ticket.id)}`
          : `Chamado atualizado ${ticketNumberLabel(ticket.public_ticket_number, ticket.id)}`;

      events.push({
        sourceId: `${type}:${ticket.id}:${new Date(ticket.updated_at).getTime()}`,
        title,
        message: ticket.title,
        type,
        targetId: ticket.id,
        createdAt: ticket.updated_at
      });
    });

    if (isTeamUser(user.role)) {
      const newTickets = await query(
        `SELECT id, public_ticket_number, title, created_at
         FROM public.tickets
         WHERE created_at > $1
         ORDER BY created_at ASC
         LIMIT 50`,
        [since]
      );

      newTickets.rows.forEach((ticket) => {
        events.push({
          sourceId: `ticket_new:${ticket.id}`,
          title: `Novo chamado ${ticketNumberLabel(ticket.public_ticket_number, ticket.id)}`,
          message: ticket.title,
          type: 'ticket_new',
          targetId: ticket.id,
          createdAt: ticket.created_at
        });
      });
    }

    events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return NextResponse.json({ notifications: events.slice(-100) });
  } catch (error) {
    console.error('Erro ao verificar notificações:', error);
    return NextResponse.json({ error: 'Erro ao verificar notificações.' }, { status: 500 });
  }
}
