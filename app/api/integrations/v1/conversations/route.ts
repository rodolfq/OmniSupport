import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// Leitura de conversas (sessões de chat, incluindo WhatsApp) para a
// plataforma externa. Filtro por companyId faz join com profiles pois
// chat_sessions só guarda customer_id diretamente.
function serializeSession(row: any) {
  return {
    id: row.id,
    type: row.type,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    assigneeId: row.assignee_id,
    status: row.status,
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

function serializeMessage(row: any) {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    type: row.type,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'conversations:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const sessionRes = await query('SELECT * FROM public.chat_sessions WHERE id = $1', [id]);
      if (sessionRes.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Conversa não encontrada.', 404);
      }
      const messagesRes = await query(
        'SELECT * FROM public.chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
        [id]
      );
      return integrationJson(auth, {
        data: {
          ...serializeSession(sessionRes.rows[0]),
          messages: messagesRes.rows.map(serializeMessage),
        },
      });
    }

    const companyId = searchParams.get('companyId');
    const customerId = searchParams.get('customerId');
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    let joinCompany = '';
    if (companyId) {
      joinCompany = 'LEFT JOIN public.profiles p ON p.id = cs.customer_id';
      params.push(companyId);
      conditions.push(`p.company_id = $${params.length}`);
    }
    if (customerId) {
      params.push(customerId);
      conditions.push(`cs.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`cs.status = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM public.chat_sessions cs ${joinCompany} ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT cs.* FROM public.chat_sessions cs
       ${joinCompany}
       ${whereClause}
       ORDER BY cs.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return integrationJson(auth, {
      data: res.rows.map(serializeSession),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/conversations] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar conversas.', 500);
  }
}
