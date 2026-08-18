import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';
import { logAudit } from '@/lib/audit-log';
import { handleTicketCreated, handleTicketUpdated } from '@/lib/services/automation-service';

// Leitura, criação e atualização de chamados para a plataforma externa. Ao
// pedir um chamado específico (?id=), inclui também as mensagens visíveis ao
// cliente — mensagens internas (is_visible_to_customer = false / type =
// 'internal', anotações entre atendentes) não são expostas por essa API.
//
// Boa prática de consulta: NUNCA `SELECT *` aqui. `tickets.attachments_data`
// guarda os anexos legados em base64 (a mesma armadilha documentada em
// app/api/users/route.ts para avatar_url — ver CLAUDE.md seção 15) e
// `search_vector` é uma coluna gerada só para full-text interno; nenhum dos
// dois é usado por serializeTicket, então nenhum dos dois entra no SELECT.
const TICKET_COLUMNS = `
  id, public_ticket_number, title, description, status, sub_status, priority,
  category, category_id, request_type_id, product_id, tags,
  company_id, customer_id, assignee_id, employee_ids, created_at, updated_at
`;

const VALID_PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'];

function serializeTicket(row: any) {
  return {
    id: row.id,
    ticketNumber: row.public_ticket_number,
    title: row.title,
    description: row.description,
    status: row.status,
    subStatus: row.sub_status,
    priority: row.priority,
    // Legado: mantido só para não quebrar integração que já dependia dele —
    // código novo (aqui e no resto do sistema) usa categoryId/requestTypeId/
    // productId. Ver CLAUDE.md seção 15.
    category: row.category,
    categoryId: row.category_id,
    requestTypeId: row.request_type_id,
    productId: row.product_id,
    tags: row.tags || [],
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

/** 23503 = violação de FK do Postgres — id referenciado (categoria, produto...) não existe. */
function isForeignKeyViolation(error: any): boolean {
  return error?.code === '23503';
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
      const ticketRes = await query(`SELECT ${TICKET_COLUMNS} FROM public.tickets WHERE id = $1`, [id]);
      if (ticketRes.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Chamado não encontrado.', 404);
      }
      const messagesRes = await query(
        `SELECT id, ticket_id, author_id, content, type, attachments_data, created_at
           FROM public.ticket_messages
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
    // Sincronização incremental: "me dê tudo que mudou desde a última vez
    // que eu sincronizei" — sem isso, o único jeito de detectar mudança era
    // reler a página inteira e comparar na mão a cada chamada.
    const updatedSince = searchParams.get('updatedSince');
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
    if (updatedSince) {
      const parsed = new Date(updatedSince);
      if (Number.isNaN(parsed.getTime())) {
        return integrationError(auth, 'VALIDATION_ERROR', 'updatedSince precisa ser uma data ISO 8601 válida.', 400);
      }
      params.push(parsed.toISOString());
      conditions.push(`updated_at >= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM public.tickets ${whereClause}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT ${TICKET_COLUMNS} FROM public.tickets
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

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'tickets:write');
  if (scopeError) return scopeError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const { title, description, companyId } = body;
  if (!title || !description || !companyId) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Campos obrigatórios: title, description, companyId.', 400);
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return integrationError(auth, 'VALIDATION_ERROR', `priority deve ser um de: ${VALID_PRIORITIES.join(', ')}.`, 400);
  }

  try {
    const companyCheck = await query('SELECT id FROM public.companies WHERE id = $1', [companyId]);
    if (companyCheck.rowCount === 0) {
      return integrationError(auth, 'VALIDATION_ERROR', 'companyId informado não existe.', 400);
    }
    if (body.customerId) {
      const customerCheck = await query('SELECT id FROM public.profiles WHERE id = $1', [body.customerId]);
      if (customerCheck.rowCount === 0) {
        return integrationError(auth, 'VALIDATION_ERROR', 'customerId informado não existe.', 400);
      }
    }

    const res = await query(
      `INSERT INTO public.tickets
         (title, description, status, priority, category_id, request_type_id, product_id, tags, company_id, customer_id)
       VALUES ($1, $2, 'Novo', $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${TICKET_COLUMNS}`,
      [
        title,
        description,
        body.priority || 'Baixa',
        body.categoryId || null,
        body.requestTypeId || null,
        body.productId || null,
        Array.isArray(body.tags) ? body.tags : [],
        companyId,
        body.customerId || null,
      ]
    );

    const newTicket = res.rows[0];
    // Mesmo evento ("novo_chamado") disparado quando o chamado nasce pelo
    // portal — mensagens automáticas configuradas em Configurações valem
    // igual, seja o chamado criado por um analista ou por esta API.
    handleTicketCreated(newTicket);

    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'create',
      entityType: 'ticket',
      entityId: newTicket.id,
      entityLabel: title,
      changes: { title, companyId, priority: body.priority }
    });

    return integrationJson(auth, { data: serializeTicket(newTicket) }, 201);
  } catch (error: any) {
    if (isForeignKeyViolation(error)) {
      return integrationError(auth, 'VALIDATION_ERROR', 'categoryId, requestTypeId ou productId informado não existe.', 400);
    }
    console.error('[integrations/v1/tickets] Erro no POST:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar chamado.', 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'tickets:write');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Parâmetro id é obrigatório (?id=).', 400);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const hasUpdate = ['status', 'priority', 'categoryId', 'requestTypeId', 'productId', 'tags', 'assigneeId']
    .some(field => body[field] !== undefined);
  if (!hasUpdate) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Informe ao menos um campo: status, priority, categoryId, requestTypeId, productId, tags, assigneeId.', 400);
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    return integrationError(auth, 'VALIDATION_ERROR', `priority deve ser um de: ${VALID_PRIORITIES.join(', ')}.`, 400);
  }

  try {
    const existing = await query(`SELECT ${TICKET_COLUMNS} FROM public.tickets WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Chamado não encontrado.', 404);
    }
    const oldTicket = existing.rows[0];

    // status é livre (config_statuses é editável em Configurações), mas
    // precisa ser um dos rótulos cadastrados — senão o chamado fica com um
    // status que nenhuma tela reconhece.
    if (body.status !== undefined) {
      const statusCheck = await query(
        `SELECT 1 FROM public.config_statuses WHERE scope = 'ticket' AND label = $1`,
        [body.status]
      );
      if (statusCheck.rowCount === 0) {
        return integrationError(auth, 'VALIDATION_ERROR', `status "${body.status}" não está cadastrado em Configurações.`, 400);
      }
    }

    const res = await query(
      `UPDATE public.tickets
          SET status = COALESCE($1, status),
              priority = COALESCE($2, priority),
              category_id = CASE WHEN $3::boolean THEN $4::uuid ELSE category_id END,
              request_type_id = CASE WHEN $5::boolean THEN $6::uuid ELSE request_type_id END,
              product_id = CASE WHEN $7::boolean THEN $8::uuid ELSE product_id END,
              tags = COALESCE($9, tags),
              assignee_id = CASE WHEN $10::boolean THEN $11::uuid ELSE assignee_id END,
              updated_at = NOW()
        WHERE id = $12
        RETURNING ${TICKET_COLUMNS}`,
      [
        body.status || null,
        body.priority || null,
        body.categoryId !== undefined, body.categoryId || null,
        body.requestTypeId !== undefined, body.requestTypeId || null,
        body.productId !== undefined, body.productId || null,
        Array.isArray(body.tags) ? body.tags : null,
        body.assigneeId !== undefined, body.assigneeId || null,
        id,
      ]
    );

    const newTicket = res.rows[0];
    handleTicketUpdated(oldTicket, newTicket);

    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'update',
      entityType: 'ticket',
      entityId: id,
      entityLabel: newTicket.title,
      changes: { status: body.status, priority: body.priority, assigneeId: body.assigneeId }
    });

    return integrationJson(auth, { data: serializeTicket(newTicket) });
  } catch (error: any) {
    if (isForeignKeyViolation(error)) {
      return integrationError(auth, 'VALIDATION_ERROR', 'categoryId, requestTypeId, productId ou assigneeId informado não existe.', 400);
    }
    console.error('[integrations/v1/tickets] Erro no PATCH:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao atualizar chamado.', 500);
  }
}
