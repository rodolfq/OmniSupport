import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// API pública de integração para listar/cadastrar/atualizar funcionários.
// Autenticada por API key (ver lib/integration-auth.ts), independente do
// login por cookie usado pelo frontend interno. Nunca expõe password/
// must_change_password e nunca permite criar/promover para papéis de
// atendimento (Administrador, Equipe, Time Interno) — só Funcionário/Cliente.
const ALLOWED_ROLES = ['Funcionário', 'Cliente'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serializeEmployee(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    companyId: row.company_id,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'employees:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const res = await query(
        `SELECT id, name, email, role, company_id, phone, created_at FROM public.profiles
         WHERE id = $1 AND role IN ('Funcionário', 'Cliente')`,
        [id]
      );
      if (res.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Funcionário não encontrado.', 404);
      }
      return integrationJson(auth, { data: serializeEmployee(res.rows[0]) });
    }

    const companyId = searchParams.get('companyId');
    const email = searchParams.get('email');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const conditions: string[] = [`role IN ('Funcionário', 'Cliente')`];
    const params: any[] = [];
    if (companyId) {
      params.push(companyId);
      conditions.push(`company_id = $${params.length}`);
    }
    if (email) {
      params.push(email);
      conditions.push(`email = $${params.length}`);
    }
    const whereClause = conditions.join(' AND ');

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM public.profiles WHERE ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total ?? 0;

    const listParams = [...params, limit, offset];
    const res = await query(
      `SELECT id, name, email, role, company_id, phone, created_at FROM public.profiles
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    return integrationJson(auth, {
      data: res.rows.map(serializeEmployee),
      meta: { limit, offset, total, hasMore: offset + res.rows.length < total },
    });
  } catch (error: any) {
    console.error('[integrations/v1/employees] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar funcionários.', 500);
  }
}

export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'employees:write');
  if (scopeError) return scopeError;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return integrationError(auth, 'VALIDATION_ERROR', 'JSON inválido.', 400);
  }

  const { name, email, phone, companyId } = body;

  if (!name || !email) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Campos obrigatórios: name, email.', 400);
  }
  if (!EMAIL_REGEX.test(email)) {
    return integrationError(auth, 'VALIDATION_ERROR', 'E-mail inválido.', 400);
  }
  if (body.role && !ALLOWED_ROLES.includes(body.role)) {
    return integrationError(auth, 'VALIDATION_ERROR', `role deve ser um de: ${ALLOWED_ROLES.join(', ')}.`, 400);
  }
  const role = body.role && ALLOWED_ROLES.includes(body.role) ? body.role : 'Funcionário';

  if (companyId) {
    const companyCheck = await query('SELECT id FROM public.companies WHERE id = $1', [companyId]);
    if (companyCheck.rowCount === 0) {
      return integrationError(auth, 'VALIDATION_ERROR', 'companyId informado não existe.', 400);
    }
  }

  try {
    // password = NULL: registro fica sem acesso de login ao portal (decisão
    // confirmada com o usuário) — verifyPassword() em lib/auth-utils.ts
    // retorna false imediatamente para hash nulo.
    const res = await query(
      `INSERT INTO public.profiles (name, email, role, company_id, phone, password, must_change_password, is_admin)
       VALUES ($1, $2, $3, $4, $5, NULL, false, false)
       RETURNING id, name, email, role, company_id, phone, created_at`,
      [name, email, role, companyId || null, phone || null]
    );
    return integrationJson(auth, { data: serializeEmployee(res.rows[0]) }, 201);
  } catch (error: any) {
    if (error.code === '23505') {
      return integrationError(auth, 'CONFLICT', 'Já existe um funcionário com esse e-mail.', 409);
    }
    console.error('[integrations/v1/employees] Erro no POST:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao criar funcionário.', 500);
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'employees:write');
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

  if (body.role && !ALLOWED_ROLES.includes(body.role)) {
    return integrationError(auth, 'VALIDATION_ERROR', `role deve ser um de: ${ALLOWED_ROLES.join(', ')}.`, 400);
  }
  if (body.companyId) {
    const companyCheck = await query('SELECT id FROM public.companies WHERE id = $1', [body.companyId]);
    if (companyCheck.rowCount === 0) {
      return integrationError(auth, 'VALIDATION_ERROR', 'companyId informado não existe.', 400);
    }
  }

  try {
    const existing = await query(
      `SELECT id FROM public.profiles WHERE id = $1 AND role IN ('Funcionário', 'Cliente')`,
      [id]
    );
    if (existing.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Funcionário não encontrado.', 404);
    }

    const res = await query(
      `UPDATE public.profiles
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           company_id = COALESCE($3, company_id),
           role = COALESCE($4, role)
       WHERE id = $5
       RETURNING id, name, email, role, company_id, phone, created_at`,
      [body.name || null, body.phone || null, body.companyId || null, body.role || null, id]
    );
    return integrationJson(auth, { data: serializeEmployee(res.rows[0]) });
  } catch (error: any) {
    console.error('[integrations/v1/employees] Erro no PUT:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao atualizar funcionário.', 500);
  }
}
