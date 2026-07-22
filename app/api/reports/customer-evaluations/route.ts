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
         c.name AS company_name, a.name AS analyst_name
       FROM public.customer_evaluations e
       LEFT JOIN public.companies c ON c.id = e.company_id
       LEFT JOIN public.profiles a ON a.id = e.analyst_id
       ORDER BY e.created_at DESC`
    );

    const evaluations = res.rows.map(r => ({
      id: r.id,
      companyName: r.company_name || 'Empresa removida',
      analystName: r.analyst_name || 'Analista removido',
      createdAt: r.created_at,
      knowledgeScore: r.knowledge_score,
      autonomyScore: r.autonomy_score,
      learningScore: r.learning_score,
      engagementScore: r.engagement_score,
      organizationScore: r.organization_score,
      communicationScore: r.communication_score,
      profileTag: r.profile_tag as 'technical' | 'beginner' | 'challenging' | null
    }));

    const count = evaluations.length;
    const sum = (key: keyof typeof evaluations[number]) =>
      evaluations.reduce((acc, e) => acc + (e[key] as number), 0);

    const averages = {
      knowledgeScore: count ? sum('knowledgeScore') / count : 0,
      autonomyScore: count ? sum('autonomyScore') / count : 0,
      learningScore: count ? sum('learningScore') / count : 0,
      engagementScore: count ? sum('engagementScore') / count : 0,
      organizationScore: count ? sum('organizationScore') / count : 0,
      communicationScore: count ? sum('communicationScore') / count : 0
    };
    const overallAverage = count
      ? Object.values(averages).reduce((a, b) => a + b, 0) / Object.values(averages).length
      : 0;

    const tagDistribution = {
      technical: evaluations.filter(e => e.profileTag === 'technical').length,
      beginner: evaluations.filter(e => e.profileTag === 'beginner').length,
      challenging: evaluations.filter(e => e.profileTag === 'challenging').length
    };

    return NextResponse.json({ count, averages, overallAverage, tagDistribution, evaluations });
  } catch (error: any) {
    console.error('Error fetching customer evaluations report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
