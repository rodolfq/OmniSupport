import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { CLOSED_TICKET_STATUSES } from '@/lib/ticket-status';
import { verifyJWT } from '@/lib/jwt';
import { handleTicketCreated, handleTicketUpdated, handleTicketMessageCreated } from '@/lib/services/automation-service';

async function getTicketActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;

  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;

  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.role = p.role
     WHERE p.id = $1`,
    [decoded.id]
  );

  return result.rows[0] || null;
}

function canDeleteTickets(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('tickets:delete');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const action = searchParams.get('action');
  const includeClosed = searchParams.get('includeClosed') === 'true';

  try {
    if (action === 'messages') {
      const ticketId = searchParams.get('ticketId');
      if (!ticketId) return NextResponse.json({ error: 'ticketId é obrigatório' }, { status: 400 });

      const res = await query(
        'SELECT * FROM public.ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
        [ticketId]
      );
      return NextResponse.json(res.rows.map(m => ({
        id: m.id,
        ticketId: m.ticket_id,
        senderId: m.author_id,
        text: m.content,
        timestamp: m.created_at,
        isVisibleToCustomer: m.is_visible_to_customer,
        type: m.type,
        attachments: m.attachments_data || []
      })));
    }

    if (action === 'internal-links') {
      const res = await query('SELECT ticket_id FROM public.ticket_internal_links');
      return NextResponse.json(res.rows);
    }
    
    if (action === 'teams') {
      const res = await query('SELECT id, name, member_ids FROM public.internal_teams');
      return NextResponse.json(res.rows.map(t => ({
        id: t.id,
        name: t.name,
        member_ids: t.member_ids || []
      })));
    }

    if (id) {
      const res = await query(
        'SELECT * FROM public.tickets WHERE id = $1',
        [id]
      );
      if (res.rowCount === 0) {
        return NextResponse.json({ error: 'Chamado não encontrado' }, { status: 404 });
      }
      const data = res.rows[0];
      return NextResponse.json({
        ...data,
        ticketId: data.number,
        ticketNumber: data.public_ticket_number,
        companyId: data.company_id,
        customerId: data.customer_id,
        employeeIds: data.employee_ids || [],
        attachments: data.attachments_data || [],
        createdAt: data.created_at,
        updatedAt: data.updated_at
      });
    } else {
      // Obter todos os tickets que não estão concluídos/fechados
      const closedStatusPlaceholders = CLOSED_TICKET_STATUSES.map((_, i) => `$${i + 1}`).join(',');
      const ticketsRes = includeClosed
        ? await query('SELECT * FROM public.tickets ORDER BY created_at DESC')
        : await query(
            `SELECT * FROM public.tickets WHERE status NOT IN (${closedStatusPlaceholders}) ORDER BY created_at DESC`,
            [...CLOSED_TICKET_STATUSES]
          );
      
      const customerIds = [...new Set(ticketsRes.rows.map(t => t.customer_id).filter(Boolean))];
      const customerMap = new Map<string, string>();
      
      if (customerIds.length > 0) {
        const placeHolders = customerIds.map((_, i) => `$${i + 1}`).join(',');
        const customersRes = await query(
          `SELECT id, name FROM public.profiles WHERE id IN (${placeHolders})`,
          customerIds
        );
        customersRes.rows.forEach(c => customerMap.set(c.id, c.name));
      }

      const tickets = ticketsRes.rows.map(t => ({
        ...t,
        ticketId: t.number,
        ticketNumber: t.public_ticket_number,
        companyId: t.company_id,
        customerId: t.customer_id,
        customerName: customerMap.get(t.customer_id),
        employeeIds: t.employee_ids || [],
        attachments: t.attachments_data || [],
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }));

      return NextResponse.json(tickets);
    }
  } catch (error: any) {
    console.error('Error in tickets GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'create') {
      const { ticket, userId } = body;

      if (!userId) {
        return NextResponse.json({ error: 'Sessão expirada. Faça login novamente.' }, { status: 401 });
      }

      // Validar empresa
      const companyId = ticket.companyId || '11111111-1111-4111-8111-111111111111';

      // Certificar que o perfil existe no Postgres próprio
      const profileCheck = await query('SELECT role FROM public.profiles WHERE id = $1', [userId]);
      let userRole = 'Cliente';
      if (profileCheck.rowCount === 0) {
        await query(
          `INSERT INTO public.profiles (id, email, name, role, company_id, password)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            'auto-created@ticket.com',
            'Usuário Auto-criado',
            'Cliente',
            companyId,
            'auto-created-default-123'
          ]
        );
      } else {
        userRole = profileCheck.rows[0].role;
      }

      const res = await query(
        `INSERT INTO public.tickets (title, description, status, priority, category, company_id, customer_id, created_by, attachments_data, employee_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          ticket.title,
          ticket.description,
          ticket.status || 'Novo',
          ticket.priority || 'Baixa',
          ticket.category || 'Geral',
          companyId,
          userId,
          userId,
          JSON.stringify(ticket.attachments || []),
          ticket.employeeIds || []
        ]
      );

      const newTicket = res.rows[0];
      handleTicketCreated(newTicket);

      // Se o usuário for "Time Interno", criar ticket interno automaticamente
      if (userRole === 'Time Interno') {
        await query(
          `INSERT INTO public.internal_tickets (title, description, team_id, creator_id, priority)
           VALUES ($1, $2, $3, $4, 1)
           RETURNING id`,
          [
            ticket.title || 'Ticket Interno',
            ticket.description || '',
            ticket.category || 'Desenvolvimento',
            userId
          ]
        );
      }

      return NextResponse.json({ success: true, ticket: newTicket });
    }

    if (action === 'create-message') {
      const { message } = body;
      
      const res = await query(
        `INSERT INTO public.ticket_messages (id, ticket_id, author_id, content, created_at, is_visible_to_customer, type, attachments_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          message.id || crypto.randomUUID(),
          message.ticketId,
          message.senderId || null,
          message.text,
          message.timestamp || new Date().toISOString(),
          message.isVisibleToCustomer !== false,
          message.type || 'text',
          JSON.stringify(message.attachments || [])
        ]
      );
      
      await query(
        'UPDATE public.tickets SET updated_at = NOW() WHERE id = $1',
        [message.ticketId]
      );

      const newMessage = res.rows[0];
      if (newMessage.is_visible_to_customer && newMessage.type !== 'internal') {
        query('SELECT * FROM public.tickets WHERE id = $1', [message.ticketId])
          .then(ticketRes => handleTicketMessageCreated(newMessage, ticketRes.rows[0]))
          .catch(err => console.error('[automation] Falha ao buscar chamado para create-message:', err));
      }

      return NextResponse.json(res.rows[0]);
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in tickets POST:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do chamado é obrigatório' }, { status: 400 });
  }

  try {
    const ticket = await request.json();

    const oldRes = await query('SELECT * FROM public.tickets WHERE id = $1', [id]);
    const oldTicket = oldRes.rows[0];

    const updateRes = await query(
      `UPDATE public.tickets
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           company_id = COALESCE($5, company_id),
           customer_id = COALESCE($6, customer_id),
           assignee_id = $7,
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        ticket.title || null,
        ticket.description || null,
        ticket.status || null,
        ticket.priority || null,
        ticket.companyId === '' ? null : (ticket.companyId || null),
        ticket.customerId === '' ? null : (ticket.customerId || null),
        ticket.assigneeId === '' ? null : (ticket.assigneeId || null),
        id
      ]
    );

    handleTicketUpdated(oldTicket, updateRes.rows[0]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in tickets PUT:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { ids, updates } = await request.json();
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'IDs dos chamados são obrigatórios.' }, { status: 400 });
    }
    
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    
    if (updates.assigneeId !== undefined) {
      setClauses.push(`assignee_id = $${paramIndex}`);
      params.push(updates.assigneeId || null);
      paramIndex++;
    }
    
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      params.push(updates.status);
      paramIndex++;
    }
    
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      params.push(updates.title);
      paramIndex++;
    }
    
    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex}`);
      params.push(updates.priority);
      paramIndex++;
    }
    
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${paramIndex}`);
      params.push(updates.tags);
      paramIndex++;
    }
    
    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'Nenhuma alteração informada.' }, { status: 400 });
    }

    setClauses.push(`updated_at = NOW()`);

    const idParamsStart = paramIndex;
    const idPlaceholders = ids.map((_, i) => `$${idParamsStart + i}`).join(',');
    params.push(...ids);

    const selectIdPlaceholders = ids.map((_: any, i: number) => `$${i + 1}`).join(',');
    const oldRes = await query(`SELECT * FROM public.tickets WHERE id IN (${selectIdPlaceholders})`, ids);
    const oldById = new Map(oldRes.rows.map((r: any) => [r.id, r]));

    const sql = `
      UPDATE public.tickets
      SET ${setClauses.join(', ')}
      WHERE id IN (${idPlaceholders})
      RETURNING *
    `;

    const updateRes = await query(sql, params);
    for (const newTicket of updateRes.rows) {
      handleTicketUpdated(oldById.get(newTicket.id), newTicket);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in tickets PATCH:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID do chamado é obrigatório.' }, { status: 400 });
  }

  try {
    const actor = await getTicketActor(request);
    if (!actor) {
      return NextResponse.json({ error: 'Sessão inválida ou expirada.' }, { status: 401 });
    }

    if (!canDeleteTickets(actor)) {
      return NextResponse.json({ error: 'Você não tem permissão para excluir chamados.' }, { status: 403 });
    }

    const result = await query(
      'DELETE FROM public.tickets WHERE id = $1 RETURNING id, public_ticket_number',
      [id]
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Chamado não encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ticket: result.rows[0] });
  } catch (error: any) {
    console.error('Error in tickets DELETE:', error);
    return NextResponse.json({ error: error.message || 'Erro ao excluir chamado.' }, { status: 500 });
  }
}
