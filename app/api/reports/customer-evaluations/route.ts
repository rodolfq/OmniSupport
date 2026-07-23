import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';

// Sem essa checagem, qualquer um (inclusive o próprio cliente, sem estar
// logado) conseguia chamar essa rota direto e ver a avaliação interna das
// empresas — a página /reports só escondia o botão no cliente, não travava
// a API. Mesmo padrão de autenticação usado em app/api/tickets/route.ts.
async function getReportActor(request: NextRequest) {
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

function canReadReports(actor: any) {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getReportActor(request);
    if (!canReadReports(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const res = await query(
      `SELECT
         e.id, e.created_at, e.knowledge_score, e.autonomy_score, e.learning_score,
         e.engagement_score, e.organization_score, e.communication_score, e.profile_tag,
         e.origin, c.name AS company_name, a.name AS analyst_name, ct.name AS contact_name
       FROM public.customer_evaluations e
       LEFT JOIN public.companies c ON c.id = e.company_id
       LEFT JOIN public.profiles a ON a.id = e.analyst_id
       LEFT JOIN public.profiles ct ON ct.id = e.contact_id
       ORDER BY e.created_at DESC`
    );

    const evaluations = res.rows.map(r => ({
      id: r.id,
      companyName: r.company_name || 'Empresa removida',
      analystName: r.analyst_name || 'Analista removido',
      contactName: r.contact_name as string | null,
      origin: r.origin as 'chat_close' | 'manual',
      createdAt: r.created_at,
      knowledgeScore: r.knowledge_score as number | null,
      autonomyScore: r.autonomy_score as number | null,
      learningScore: r.learning_score as number | null,
      engagementScore: r.engagement_score as number | null,
      organizationScore: r.organization_score as number | null,
      communicationScore: r.communication_score as number | null,
      profileTag: r.profile_tag as 'technical' | 'beginner' | 'challenging' | null
    }));

    const count = evaluations.length;
    const countByOrigin = {
      chatClose: evaluations.filter(e => e.origin === 'chat_close').length,
      manual: evaluations.filter(e => e.origin === 'manual').length
    };
    // Critério em branco (null) numa avaliação não entra na média dele —
    // por isso soma e conta só as linhas que de fato avaliaram esse
    // critério, em vez de dividir pelo total de avaliações.
    const criteriaKeys = ['knowledgeScore', 'autonomyScore', 'learningScore', 'engagementScore', 'organizationScore', 'communicationScore'] as const;
    const averages: Record<(typeof criteriaKeys)[number], number | null> = {} as any;
    for (const key of criteriaKeys) {
      let sum = 0;
      let n = 0;
      for (const e of evaluations) {
        const v = e[key];
        if (v !== null) {
          sum += v;
          n++;
        }
      }
      averages[key] = n > 0 ? sum / n : null;
    }
    const ratedAverages = Object.values(averages).filter((v): v is number => v !== null);
    const overallAverage = ratedAverages.length > 0
      ? ratedAverages.reduce((a, b) => a + b, 0) / ratedAverages.length
      : 0;

    const tagDistribution = {
      technical: evaluations.filter(e => e.profileTag === 'technical').length,
      beginner: evaluations.filter(e => e.profileTag === 'beginner').length,
      challenging: evaluations.filter(e => e.profileTag === 'challenging').length
    };

    return NextResponse.json({ count, averages, overallAverage, tagDistribution, countByOrigin, evaluations });
  } catch (error: any) {
    console.error('Error fetching customer evaluations report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
