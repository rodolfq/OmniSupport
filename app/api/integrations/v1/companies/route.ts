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
// /api/integrations/v1/employees. Também expõe o perfil interno de
// relacionamento (radarSync + resumo das avaliações do analista) para a
// integração com o Radar. PUT faz atualização parcial de name/industry/
// phone/radarSync — as notas de avaliação em si permanecem editáveis só pelo
// portal, nunca pela integração.
const EVALUATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS count,
      AVG(knowledge_score) AS knowledge_avg,
      AVG(autonomy_score) AS autonomy_avg,
      AVG(learning_score) AS learning_avg,
      AVG(engagement_score) AS engagement_avg,
      AVG(organization_score) AS organization_avg,
      AVG(communication_score) AS communication_avg,
      COUNT(*) FILTER (WHERE origin = 'chat_close')::int AS chat_close_count,
      COUNT(*) FILTER (WHERE origin = 'manual')::int AS manual_count
    FROM public.customer_evaluations e
    WHERE e.company_id = c.id
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT profile_tag
    FROM public.customer_evaluations e2
    WHERE e2.company_id = c.id
    ORDER BY e2.created_at DESC
    LIMIT 1
  ) lt ON true
`;

const COMPANY_SELECT = `
  SELECT
    c.id, c.name, c.industry, c.phone, c.radar_sync,
    COALESCE(ev.count, 0) AS eval_count,
    ev.knowledge_avg, ev.autonomy_avg, ev.learning_avg, ev.engagement_avg, ev.organization_avg, ev.communication_avg,
    COALESCE(ev.chat_close_count, 0) AS chat_close_count,
    COALESCE(ev.manual_count, 0) AS manual_count,
    lt.profile_tag AS latest_tag
  FROM public.companies c
  ${EVALUATION_JOIN}
`;

function toNumOrNull(v: any) {
  return v === null || v === undefined ? null : Number(v);
}

function serializeCompany(row: any) {
  const averages = {
    knowledgeScore: toNumOrNull(row.knowledge_avg),
    autonomyScore: toNumOrNull(row.autonomy_avg),
    learningScore: toNumOrNull(row.learning_avg),
    engagementScore: toNumOrNull(row.engagement_avg),
    organizationScore: toNumOrNull(row.organization_avg),
    communicationScore: toNumOrNull(row.communication_avg),
  };
  const ratedAverages = Object.values(averages).filter((v): v is number => v !== null);
  const overallAverage = ratedAverages.length > 0
    ? ratedAverages.reduce((sum, v) => sum + v, 0) / ratedAverages.length
    : 0;

  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    phone: row.phone,
    radarSync: row.radar_sync === true,
    evaluation: {
      count: Number(row.eval_count) || 0,
      overallAverage,
      averages,
      latestTag: row.latest_tag || null,
      countByOrigin: {
        chatClose: Number(row.chat_close_count) || 0,
        manual: Number(row.manual_count) || 0,
      },
    },
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
      const res = await query(`${COMPANY_SELECT} WHERE c.id = $1`, [id]);
      if (res.rowCount === 0) {
        return integrationError(auth, 'NOT_FOUND', 'Empresa não encontrada.', 404);
      }
      return integrationJson(auth, { data: serializeCompany(res.rows[0]) });
    }

    const res = await query(`${COMPANY_SELECT} ORDER BY c.name ASC`);
    return integrationJson(auth, { data: res.rows.map(serializeCompany), meta: { total: res.rowCount } });
  } catch (error: any) {
    console.error('[integrations/v1/companies] Erro no GET:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao listar empresas.', 500);
  }
}

export async function PUT(request: Request) {
  const auth = await authenticateApiKey(request);
  if (isAuthError(auth)) return authErrorResponse(auth);
  const scopeError = requireScope(auth, 'companies:write');
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

  if (body.radarSync !== undefined && typeof body.radarSync !== 'boolean') {
    return integrationError(auth, 'VALIDATION_ERROR', 'radarSync deve ser um boolean.', 400);
  }
  const hasUpdate = body.name !== undefined || body.industry !== undefined || body.phone !== undefined || body.radarSync !== undefined;
  if (!hasUpdate) {
    return integrationError(auth, 'VALIDATION_ERROR', 'Informe ao menos um campo para atualizar: name, industry, phone, radarSync.', 400);
  }

  try {
    const existing = await query('SELECT id FROM public.companies WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      return integrationError(auth, 'NOT_FOUND', 'Empresa não encontrada.', 404);
    }

    // radarSync é boolean: precisa distinguir "não veio no corpo" (mantém o
    // valor atual) de "veio como false" (troca pra false) — por isso não dá
    // pra usar `|| null` como nos campos de texto abaixo.
    await query(
      `UPDATE public.companies
       SET name = COALESCE($1, name),
           industry = COALESCE($2, industry),
           phone = COALESCE($3, phone),
           radar_sync = COALESCE($4, radar_sync)
       WHERE id = $5`,
      [body.name || null, body.industry || null, body.phone || null, body.radarSync === undefined ? null : body.radarSync, id]
    );

    const updated = await query(`${COMPANY_SELECT} WHERE c.id = $1`, [id]);
    return integrationJson(auth, { data: serializeCompany(updated.rows[0]) });
  } catch (error: any) {
    console.error('[integrations/v1/companies] Erro no PUT:', error);
    return integrationError(auth, 'INTERNAL_ERROR', 'Erro ao atualizar empresa.', 500);
  }
}
