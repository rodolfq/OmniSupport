import { query } from '@/lib/db';
import {
  authenticateApiKey,
  isAuthError,
  authErrorResponse,
  requireScope,
  integrationJson,
  integrationError,
} from '@/lib/integration-auth';

// Leitura de empresas, usada pela plataforma externa para resolver o
// companyId antes de cadastrar/atualizar um funcionário via
// /api/integrations/v1/employees.
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'employees:read');
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      const res = await query('SELECT id, name, industry, phone FROM public.companies WHERE id = $1', [id]);
      if (res.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Empresa não encontrada.', 404);
      }
      return integrationJson(auth, { data: res.rows[0] });
    }

    const res = await query('SELECT id, name, industry, phone FROM public.companies ORDER BY name ASC');
    return integrationJson(auth, { data: res.rows, meta: { total: res.rowCount } });
  } catch (error: any) {
    console.error('[integrations/v1/companies] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar empresas.', 500);
  }
}
