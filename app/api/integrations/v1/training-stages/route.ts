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

// Etapas de treinamento por empresa (pedido do usuário, 2026-10-28). Um
// sistema externo cadastra os itens da trilha (nome + status) e depois
// atualiza o status de cada um conforme o treinamento avança — dentro do
// SSX Desk, o analista só visualiza, como uma lista fixa, dentro do
// cadastro da empresa. Independente de companies.is_in_training: a trilha
// pode existir e ser consultada mesmo que o indicador mude depois (não há
// validação cruzada entre as duas coisas).
const VALID_STATUSES = ['Em andamento', 'Concluído', 'Não concluído'] as const;

function serializeStage(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireAnyScope(auth, ['training-stages:read', 'training-stages:write']);
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const res = await query('SELECT * FROM public.training_stages WHERE id = $1', [id]);
      if (res.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Etapa de treinamento não encontrada.', 404);
      }
      return integrationJson(auth, { data: serializeStage(res.rows[0]) });
    }

    const companyId = searchParams.get('companyId');
    if (!companyId) {
      return integrationError(auth, 'VALIDATION_ERROR', 'Parâmetro companyId é obrigatório (?companyId=) quando "id" não é informado.', 400);
    }
    const res = await query(
      'SELECT * FROM public.training_stages WHERE company_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [companyId]
    );
    return integrationJson(auth, { data: res.rows.map(serializeStage), meta: { total: res.rowCount } });
  } catch (error: any) {
    console.error('[integrations/v1/training-stages] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar etapas de treinamento.', 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'training-stages:write');
  if (scopeError) return scopeError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const { companyId, name } = body;
  if (!companyId || !name?.trim()) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Campos obrigatórios: companyId, name.', 400);
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return integrationError(auth, 'VALIDATION_ERROR', `status deve ser um de: ${VALID_STATUSES.join(', ')}.`, 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) {
    return integrationError(auth, 'VALIDATION_ERROR', 'sortOrder deve ser um número inteiro.', 400);
  }

  try {
    const companyCheck = await query('SELECT id, name FROM public.companies WHERE id = $1', [companyId]);
    if (companyCheck.rowCount === 0) {
      return integrationError(auth, 'VALIDATION_ERROR', 'companyId informado não existe.', 400);
    }

    const res = await query(
      `INSERT INTO public.training_stages (company_id, name, status, sort_order, notes)
       VALUES ($1, $2, COALESCE($3, 'Não concluído'), COALESCE($4, 0), $5)
       RETURNING *`,
      [companyId, name.trim(), body.status || null, body.sortOrder ?? null, body.notes || null]
    );
    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'create',
      entityType: 'training_stage',
      entityId: res.rows[0].id,
      entityLabel: `${name} (${companyCheck.rows[0].name})`,
      changes: { companyId, name, status: body.status }
    });
    return integrationJson(auth, { data: serializeStage(res.rows[0]) }, 201);
  } catch (error: any) {
    console.error('[integrations/v1/training-stages] Erro no POST:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar etapa de treinamento.', 500);
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'training-stages:write');
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

  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return integrationError(auth, 'VALIDATION_ERROR', `status deve ser um de: ${VALID_STATUSES.join(', ')}.`, 400);
  }
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) {
    return integrationError(auth, 'VALIDATION_ERROR', 'sortOrder deve ser um número inteiro.', 400);
  }
  const hasUpdate = body.name !== undefined || body.status !== undefined || body.sortOrder !== undefined || body.notes !== undefined;
  if (!hasUpdate) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Informe ao menos um campo para atualizar: name, status, sortOrder, notes.', 400);
  }

  try {
    const existing = await query('SELECT id, name FROM public.training_stages WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Etapa de treinamento não encontrada.', 404);
    }

    const res = await query(
      `UPDATE public.training_stages
       SET name = COALESCE($1, name),
           status = COALESCE($2, status),
           sort_order = COALESCE($3, sort_order),
           notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [body.name?.trim() || null, body.status || null, body.sortOrder ?? null, body.notes !== undefined, body.notes ?? null, id]
    );
    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'update',
      entityType: 'training_stage',
      entityId: id,
      entityLabel: res.rows[0]?.name || existing.rows[0]?.name || null,
      changes: { name: body.name, status: body.status, sortOrder: body.sortOrder }
    });
    return integrationJson(auth, { data: serializeStage(res.rows[0]) });
  } catch (error: any) {
    console.error('[integrations/v1/training-stages] Erro no PUT:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao atualizar etapa de treinamento.', 500);
  }
}

/**
 * Exclusão de verdade (não há soft-delete aqui): um item cadastrado por
 * engano não precisa deixar rastro — ao contrário de employees/tickets,
 * nada no sistema referencia training_stages.id por fora desta tabela.
 */
export async function DELETE(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'training-stages:write');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Parâmetro id é obrigatório (?id=).', 400);
  }

  try {
    const res = await query('DELETE FROM public.training_stages WHERE id = $1 RETURNING id, name', [id]);
    if (res.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Etapa de treinamento não encontrada.', 404);
    }
    logAudit({
      actorId: null,
      actorName: `Integração: ${auth.name}`,
      action: 'delete',
      entityType: 'training_stage',
      entityId: id,
      entityLabel: res.rows[0].name,
    });
    return integrationJson(auth, { data: { id } });
  } catch (error: any) {
    console.error('[integrations/v1/training-stages] Erro no DELETE:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao excluir etapa de treinamento.', 500);
  }
}
