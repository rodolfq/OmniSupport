import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  requireAnyScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';
import { logAudit } from '@/lib/audit-log';
import { externalizeInlineImages } from '@/lib/services/attachment-storage';
import { computeInternalTicketSla } from '@/lib/sla';
import { queueInternalTicketChangeEmail } from '@/lib/services/internal-ticket-notifications';
import { loadQueueStatusRule, statusErrorForRule, initialStatusForRule } from '@/lib/services/internal-queue-status-rules';
import { unaccentCol, likeTerm } from '@/lib/sql-unaccent';

// Leitura, criação e atualização de tickets internos (dev/infra/QA/produto)
// para sistemas externos. Ao contrário de app/api/integrations/v1/tickets
// (chamado de CLIENTE), aqui não existe conceito de "visível ao cliente" —
// ticket interno é uso exclusivo da própria equipe SSX Desk, então TODAS as
// notas (internal_ticket_messages) entram na resposta de detalhe/listagem de
// notas, sem filtro de visibilidade.
//
// Por isso mesmo, esta API é mais sensível que as demais (não é dado da
// empresa-cliente, é a operação interna do próprio SSX Desk) — reforçar isso
// na documentação/no momento de gerar a key: só conceder a quem realmente
// precisa integrar com o backlog interno, não distribuir como as outras.
//
// Campos de workflow de QA (qaRejected/environmentRejected/lateDelivery/
// resolvedAt) são só-leitura aqui de propósito: têm permissão própria
// (internal:qa_override) e fluxo de revisão dentro do portal; não expor
// escrita evita que uma integração externa pise nesse processo.
const INTERNAL_TICKET_COLUMNS = `
  id, internal_ticket_number, title, description, status, sub_status, priority,
  tags, internal_queue_id, internal_team_id, assignee_id, creator_id,
  sla_limit, expected_publish_date, hotfix_id, release_item_id, effort_id, outcome_id,
  resolved_at, qa_rejected, late_delivery, environment_rejected, created_at, updated_at
`;

const VALID_PRIORITIES = [1, 2, 3, 4];

function serializeInternalTicket(row: any) {
  return {
    id: row.id,
    ticketNumber: row.internal_ticket_number,
    title: row.title,
    description: row.description,
    status: row.status,
    subStatus: row.sub_status,
    priority: row.priority,
    tags: row.tags || [],
    queueId: row.internal_queue_id,
    internalTeamId: row.internal_team_id,
    assigneeId: row.assignee_id,
    creatorId: row.creator_id,
    slaLimit: row.sla_limit,
    expectedPublishDate: row.expected_publish_date,
    hotfixId: row.hotfix_id,
    releaseItemId: row.release_item_id,
    effortId: row.effort_id,
    outcomeId: row.outcome_id,
    resolvedAt: row.resolved_at,
    qaRejected: row.qa_rejected,
    lateDelivery: row.late_delivery,
    environmentRejected: row.environment_rejected,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeInternalMessage(row: any) {
  return {
    id: row.id,
    internalTicketId: row.internal_ticket_id,
    authorId: row.author_id,
    content: row.content,
    type: row.type,
    attachments: row.attachments_data || [],
    createdAt: row.created_at,
  };
}

/** 23503 = violação de FK do Postgres — id referenciado não existe. */
function isForeignKeyViolation(error: any): boolean {
  return error?.code === '23503';
}

/** Mesma regra da tela/rota de sessão: fila precisa existir e estar ativa. */
async function queueValidationError(queueId: unknown): Promise<string | null> {
  if (typeof queueId !== 'string' || !/^[0-9a-f-]{36}$/i.test(queueId)) {
    return 'queueId é obrigatório e deve ser o UUID de uma fila de ticket interno.';
  }
  const res = await query('SELECT is_active FROM public.internal_ticket_queues WHERE id = $1::uuid', [queueId]);
  if (res.rowCount === 0) return 'queueId informado não existe.';
  if (!res.rows[0].is_active) return 'Esta fila está desativada. Escolha outra fila ativa.';
  return null;
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireAnyScope(auth, ['internal-tickets:read', 'internal-tickets:write']);
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const ticketRes = await query(`SELECT ${INTERNAL_TICKET_COLUMNS} FROM public.internal_tickets WHERE id = $1`, [id]);
      if (ticketRes.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Ticket interno não encontrado.', 404);
      }
      // Sem filtro de visibilidade: ticket interno não tem conceito de
      // "nota visível ao cliente" — toda nota é interna por definição.
      const messagesRes = await query(
        `SELECT id, internal_ticket_id, author_id, content, type, attachments_data, created_at
           FROM public.internal_ticket_messages
          WHERE internal_ticket_id = $1
          ORDER BY created_at ASC`,
        [id]
      );
      return integrationJson(auth, {
        data: {
          ...serializeInternalTicket(ticketRes.rows[0]),
          messages: messagesRes.rows.map(serializeInternalMessage),
        },
      });
    }

    const queueId = searchParams.get('queueId');
    const status = searchParams.get('status');
    const subStatus = searchParams.get('subStatus');
    const priority = searchParams.get('priority');
    const assigneeId = searchParams.get('assigneeId');
    const creatorId = searchParams.get('creatorId');
    const internalTeamId = searchParams.get('internalTeamId');
    const hotfixId = searchParams.get('hotfixId');
    const releaseItemId = searchParams.get('releaseItemId');
    const tags = searchParams.get('tags');
    const search = searchParams.get('search')?.trim() || null;
    const contentSearch = searchParams.get('contentSearch')?.trim() || null;
    const createdFrom = searchParams.get('createdFrom');
    const createdTo = searchParams.get('createdTo');
    const updatedSince = searchParams.get('updatedSince');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [];
    const params: any[] = [];
    if (queueId) {
      params.push(queueId);
      conditions.push(`internal_queue_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (subStatus) {
      params.push(subStatus);
      conditions.push(`sub_status = $${params.length}`);
    }
    if (priority) {
      const parsedPriority = parseInt(priority, 10);
      if (!VALID_PRIORITIES.includes(parsedPriority)) {
        return integrationError(auth, 'VALIDATION_ERROR', `priority deve ser um de: ${VALID_PRIORITIES.join(', ')}.`, 400);
      }
      params.push(parsedPriority);
      conditions.push(`priority = $${params.length}`);
    }
    if (assigneeId) {
      params.push(assigneeId);
      conditions.push(`assignee_id = $${params.length}`);
    }
    if (creatorId) {
      params.push(creatorId);
      conditions.push(`creator_id = $${params.length}`);
    }
    if (internalTeamId) {
      params.push(internalTeamId);
      conditions.push(`internal_team_id = $${params.length}`);
    }
    if (hotfixId) {
      params.push(hotfixId);
      conditions.push(`hotfix_id = $${params.length}`);
    }
    if (releaseItemId) {
      params.push(releaseItemId);
      conditions.push(`release_item_id = $${params.length}`);
    }
    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length) {
        params.push(tagList);
        conditions.push(`tags && $${params.length}::text[]`);
      }
    }
    if (search) {
      params.push(likeTerm(search));
      conditions.push(`${unaccentCol('title')} ILIKE $${params.length}`);
    }
    if (contentSearch) {
      params.push(likeTerm(contentSearch));
      conditions.push(`${unaccentCol('description')} ILIKE $${params.length}`);
    }
    if (createdFrom) {
      const parsed = new Date(createdFrom);
      if (Number.isNaN(parsed.getTime())) {
        return integrationError(auth, 'VALIDATION_ERROR', 'createdFrom precisa ser uma data ISO 8601 válida.', 400);
      }
      params.push(parsed.toISOString());
      conditions.push(`created_at >= $${params.length}`);
    }
    if (createdTo) {
      const parsed = new Date(createdTo);
      if (Number.isNaN(parsed.getTime())) {
        return integrationError(auth, 'VALIDATION_ERROR', 'createdTo precisa ser uma data ISO 8601 válida.', 400);
      }
      params.push(parsed.toISOString());
      conditions.push(`created_at <= $${params.length}`);
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

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM public.internal_tickets ${whereClause}`, params);
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT ${INTERNAL_TICKET_COLUMNS} FROM public.internal_tickets
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return integrationJson(auth, {
      data: res.rows.map(serializeInternalTicket),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/internal-tickets] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar tickets internos.', 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'internal-tickets:write');
  if (scopeError) return scopeError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const { title, description, queueId } = body;
  if (!title || !description) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Campos obrigatórios: title, description, queueId.', 400);
  }
  const queueErr = await queueValidationError(queueId);
  if (queueErr) return integrationError(auth, 'VALIDATION_ERROR', queueErr, 400);

  const priority = body.priority !== undefined ? parseInt(body.priority, 10) : 1;
  if (!VALID_PRIORITIES.includes(priority)) {
    return integrationError(auth, 'VALIDATION_ERROR', `priority deve ser um de: ${VALID_PRIORITIES.join(', ')}.`, 400);
  }

  const creationRequestId = typeof body.creationRequestId === 'string' && body.creationRequestId.trim()
    ? body.creationRequestId.trim()
    : null;

  try {
    const priorityRes = await query('SELECT label, sla_hours FROM public.config_priorities');
    const createdAt = new Date().toISOString();
    const slaLimit = computeInternalTicketSla(priority, createdAt, priorityRes.rows);
    const description2 = await externalizeInlineImages(description);

    // Mesmo padrão de app/api/internal-tickets/route.ts: número calculado
    // DENTRO do INSERT (MAX+1) e idempotência via creation_request_id — ver
    // comentário lá para o porquê de cada detalhe.
    const insertSql = `INSERT INTO public.internal_tickets
         (title, description, internal_queue_id, assignee_id, creator_id, priority, tags,
          sla_limit, expected_publish_date, internal_ticket_number, creation_request_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               (SELECT COALESCE(MAX(internal_ticket_number), 0) + 1 FROM public.internal_tickets), $10, $11)
       ON CONFLICT (creation_request_id) WHERE creation_request_id IS NOT NULL DO NOTHING
       RETURNING ${INTERNAL_TICKET_COLUMNS}`;
    const insertParams = [
      title,
      description2,
      queueId,
      body.assigneeId || null,
      body.creatorId || null,
      priority,
      Array.isArray(body.tags) ? body.tags : [],
      slaLimit,
      body.expectedPublishDate || null,
      creationRequestId,
      // Fila que não usa "Novo" faz o ticket nascer no 1º status aberto dela.
      initialStatusForRule(await loadQueueStatusRule(queueId)),
    ];

    let res;
    try {
      res = await query(insertSql, insertParams);
    } catch (insertError: any) {
      if (insertError?.code === '23505' && creationRequestId) {
        const existing = await query(`SELECT ${INTERNAL_TICKET_COLUMNS} FROM public.internal_tickets WHERE creation_request_id = $1`, [creationRequestId]);
        if ((existing.rowCount ?? 0) > 0) {
          return integrationJson(auth, { data: serializeInternalTicket(existing.rows[0]) }, 200);
        }
      }
      throw insertError;
    }

    if (res.rowCount === 0) {
      if (!creationRequestId) {
        return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar ticket interno.', 500);
      }
      const existing = await query(`SELECT ${INTERNAL_TICKET_COLUMNS} FROM public.internal_tickets WHERE creation_request_id = $1`, [creationRequestId]);
      return integrationJson(auth, { data: serializeInternalTicket(existing.rows[0]) }, 200);
    }

    const newTicket = res.rows[0];

    if (newTicket.assignee_id) {
      queueInternalTicketChangeEmail({
        internalTicketId: newTicket.id,
        actorId: null,
        actorName: `Integração: ${auth.name}`,
        kind: 'created',
      });
    }

    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'create',
      entityType: 'internal_ticket',
      entityId: newTicket.id,
      entityLabel: title,
      changes: { title, queueId, priority },
    });

    return integrationJson(auth, { data: serializeInternalTicket(newTicket) }, 201);
  } catch (error: any) {
    if (isForeignKeyViolation(error)) {
      return integrationError(auth, 'VALIDATION_ERROR', 'assigneeId, creatorId ou queueId informado não existe.', 400);
    }
    console.error('[integrations/v1/internal-tickets] Erro no POST:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar ticket interno.', 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'internal-tickets:write');
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

  const updatableFields = ['title', 'description', 'status', 'subStatus', 'priority', 'tags', 'assigneeId', 'queueId', 'expectedPublishDate'];
  const hasUpdate = updatableFields.some(field => body[field] !== undefined);
  if (!hasUpdate) {
    return integrationError(auth, 'VALIDATION_ERROR', `Informe ao menos um campo: ${updatableFields.join(', ')}.`, 400);
  }
  if (body.priority !== undefined && !VALID_PRIORITIES.includes(parseInt(body.priority, 10))) {
    return integrationError(auth, 'VALIDATION_ERROR', `priority deve ser um de: ${VALID_PRIORITIES.join(', ')}.`, 400);
  }
  // Fila não pode ser removida, só reatribuída — mesma regra do portal
  // (app/api/internal-tickets/route.ts): quem já tem fila não pode voltar a
  // "Sem fila".
  if (body.queueId !== undefined) {
    const queueErr = await queueValidationError(body.queueId);
    if (queueErr) return integrationError(auth, 'VALIDATION_ERROR', queueErr, 400);
  }

  try {
    const existing = await query(`SELECT ${INTERNAL_TICKET_COLUMNS} FROM public.internal_tickets WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Ticket interno não encontrado.', 404);
    }
    const oldTicket = existing.rows[0];

    // status/subStatus seguem a mesma regra do config_statuses (scope
    // internal_ticket): rótulo de sub-status resolve pro pai automaticamente.
    let resolvedStatus: string | null = null;
    let resolvedSubStatus: string | null = null;
    let touchStatus = false;
    if (body.status !== undefined) {
      touchStatus = true;
      const statusCheck = await query(
        `SELECT label, parent_status_id FROM public.config_statuses WHERE scope = 'internal_ticket' AND label = $1`,
        [body.status]
      );
      const statusRow = statusCheck.rows[0];
      if (!statusRow) {
        return integrationError(auth, 'VALIDATION_ERROR', `status "${body.status}" não está cadastrado em Configurações.`, 400);
      }
      if (statusRow.parent_status_id) {
        const parentRes = await query(`SELECT label FROM public.config_statuses WHERE id = $1`, [statusRow.parent_status_id]);
        resolvedStatus = parentRes.rows[0]?.label || body.status;
        resolvedSubStatus = body.status;
      } else {
        resolvedStatus = body.status;
        resolvedSubStatus = null;
      }
    } else if (body.subStatus !== undefined) {
      // subStatus sozinho (sem trocar status): valida que é filho do status ATUAL.
      const subCheck = await query(
        `SELECT cs.label FROM public.config_statuses cs
           JOIN public.config_statuses parent ON parent.id = cs.parent_status_id
          WHERE cs.scope = 'internal_ticket' AND cs.label = $1 AND parent.label = $2`,
        [body.subStatus, oldTicket.status]
      );
      if (subCheck.rowCount === 0) {
        return integrationError(auth, 'VALIDATION_ERROR', `subStatus "${body.subStatus}" não é um sub-status válido de "${oldTicket.status}".`, 400);
      }
      touchStatus = true;
      resolvedStatus = oldTicket.status;
      resolvedSubStatus = body.subStatus;
    }

    // Status por fila (2026-11-24): mesma regra do portal — só confere quando
    // fila, status ou sub-status mudam de verdade.
    const effectiveQueue = body.queueId || oldTicket.internal_queue_id;
    const effectiveStatus = touchStatus ? resolvedStatus : (oldTicket.status || 'Novo');
    const effectiveSub = touchStatus ? resolvedSubStatus : oldTicket.sub_status;
    const queueChanged = !!body.queueId && body.queueId !== oldTicket.internal_queue_id;
    const statusChanged = touchStatus && (effectiveStatus !== (oldTicket.status || 'Novo') || (effectiveSub || null) !== (oldTicket.sub_status || null));
    if (effectiveQueue && (queueChanged || statusChanged)) {
      const statusErr = statusErrorForRule(await loadQueueStatusRule(effectiveQueue), effectiveStatus, effectiveSub);
      if (statusErr) {
        return integrationError(auth, 'VALIDATION_ERROR', queueChanged && !touchStatus
          ? `${statusErr} Envie também "status" ao trocar de fila.`
          : statusErr, 400);
      }
    }

    // Prioridade muda o prazo (SLA) — recalcula ancorado na CRIAÇÃO do
    // ticket, nunca em "agora" (mesma regra do portal), senão editar outro
    // campo sem tocar na prioridade reescreveria o prazo à toa.
    let newSlaLimit: string | null | undefined = undefined;
    if (body.priority !== undefined) {
      const priorityRes = await query('SELECT label, sla_hours FROM public.config_priorities');
      newSlaLimit = computeInternalTicketSla(parseInt(body.priority, 10), oldTicket.created_at, priorityRes.rows);
    }

    const description = body.description !== undefined ? await externalizeInlineImages(body.description) : undefined;

    const res = await query(
      `UPDATE public.internal_tickets
          SET title = COALESCE($1, title),
              description = CASE WHEN $2::boolean THEN $3 ELSE description END,
              status = CASE WHEN $4::boolean THEN $5 ELSE status END,
              sub_status = CASE WHEN $4::boolean THEN $6 ELSE sub_status END,
              priority = COALESCE($7, priority),
              sla_limit = CASE WHEN $7 IS NOT NULL THEN $8 ELSE sla_limit END,
              tags = COALESCE($9, tags),
              assignee_id = CASE WHEN $10::boolean THEN $11::uuid ELSE assignee_id END,
              internal_queue_id = CASE WHEN $12::boolean THEN $13::uuid ELSE internal_queue_id END,
              expected_publish_date = CASE WHEN $14::boolean THEN $15 ELSE expected_publish_date END,
              updated_at = NOW()
        WHERE id = $16
        RETURNING ${INTERNAL_TICKET_COLUMNS}`,
      [
        body.title || null,
        description !== undefined, description ?? null,
        touchStatus, resolvedStatus, resolvedSubStatus,
        body.priority !== undefined ? parseInt(body.priority, 10) : null,
        newSlaLimit ?? null,
        Array.isArray(body.tags) ? body.tags : null,
        body.assigneeId !== undefined, body.assigneeId || null,
        body.queueId !== undefined, body.queueId || null,
        body.expectedPublishDate !== undefined, body.expectedPublishDate || null,
        id,
      ]
    );

    const newTicket = res.rows[0];

    queueInternalTicketChangeEmail({
      internalTicketId: id,
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      kind: 'change',
    });

    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'update',
      entityType: 'internal_ticket',
      entityId: id,
      entityLabel: newTicket.title,
      changes: { status: body.status, priority: body.priority, assigneeId: body.assigneeId, queueId: body.queueId },
    });

    return integrationJson(auth, { data: serializeInternalTicket(newTicket) });
  } catch (error: any) {
    if (isForeignKeyViolation(error)) {
      return integrationError(auth, 'VALIDATION_ERROR', 'assigneeId ou queueId informado não existe.', 400);
    }
    console.error('[integrations/v1/internal-tickets] Erro no PATCH:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao atualizar ticket interno.', 500);
  }
}
