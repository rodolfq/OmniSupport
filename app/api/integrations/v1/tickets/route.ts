import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// Leitura de chamados para a plataforma externa. Ao pedir um chamado
// específico (?id=), inclui também as mensagens visíveis ao cliente —
// mensagens internas (is_visible_to_customer = false / type = 'internal',
// anotações entre atendentes) não são expostas por essa API.
function serializeTicket(row: any) {
  return {
    id: row.id,
    ticketNumber: row.public_ticket_number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    companyId: row.company_id,
    customerId: row.customer_id,
    assigneeId: row.assignee_id,
    employeeIds: row.employee_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeMessage(row: any) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorId: row.author_id,
    content: row.content,
    type: row.type,
    attachments: row.attachments_data || [],
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'tickets:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const ticketRes = await query('SELECT * FROM public.tickets WHERE id = $1', [id]);
      if (ticketRes.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Chamado não encontrado.', 404);
      }
      const messagesRes = await query(
        `SELECT * FROM public.ticket_messages
         WHERE ticket_id = $1 AND is_visible_to_customer = true AND type != 'internal'
         ORDER BY created_at ASC`,
        [id]
      );
      return integrationJson(auth, {
        data: {
          ...serializeTicket(ticketRes.rows[0]),
          messages: messagesRes.rows.map(serializeMessage),
        },
      });
    }

    const companyId = searchParams.get('companyId');
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    if (companyId) {
      params.push(companyId);
      conditions.push(`company_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM public.tickets ${whereClause}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT * FROM public.tickets
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return integrationJson(auth, {
      data: res.rows.map(serializeTicket),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/tickets] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar chamados.', 500);
  }
}
