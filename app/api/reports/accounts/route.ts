import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter, getPreviousPeriod } from '@/lib/report-period';
import { AccountSummaryRow } from '@/lib/types';
import { getContasResumo, getContaTopContatos, getContaEvolucaoMensal } from '@/lib/services/metrics-service';

// Relatório "Conta/Cliente" (R5) — mesmo padrão estrutural do R1. Único dos
// cinco que responde pergunta comercial (diretoria/CS), não operacional.
// Acesso: reports:read.

async function getActor(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  if (!token) return null;
  const decoded = await verifyJWT(token);
  if (!decoded?.id) return null;
  const result = await query(
    `SELECT p.id, p.role, COALESCE(rp.permissions, '{}'::text[]) AS permissions
     FROM public.profiles p
     LEFT JOIN public.role_permissions rp ON rp.id = p.access_profile_id
     WHERE p.id = $1`,
    [decoded.id]
  );
  return result.rows[0] || null;
}

function isAuthorized(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:read');
}

// Cópia local, mesmo padrão das outras rotas de relatório.
async function getRiskThresholds(): Promise<{ dropPoints: number; recurrenceWarning: number }> {
  const res = await query('SELECT risk_satisfaction_drop_points, risk_recurrence_rate_warning FROM public.config_metric_thresholds WHERE id = 1');
  const row = res.rows[0] || {};
  return {
    dropPoints: Number(row.risk_satisfaction_drop_points ?? 15),
    recurrenceWarning: Number(row.risk_recurrence_rate_warning ?? 20)
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!isAuthorized(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const { startDate, endDate } = await resolvePeriod(searchParams);
    const filter = buildMetricsFilter(searchParams, startDate, endDate);

    if (action === 'summary') {
      const thresholds = await getRiskThresholds();
      const previousPeriod = getPreviousPeriod(startDate, endDate);
      const previousFilter = { ...filter, ...previousPeriod };

      const [current, previous] = await Promise.all([
        getContasResumo(filter),
        getContasResumo(previousFilter)
      ]);
      const previousByCompany = new Map(previous.map(r => [r.companyId, r]));

      const rows: AccountSummaryRow[] = current.map(r => {
        const prev = previousByCompany.get(r.companyId);
        const satisfactionDropped = prev?.positiveRate !== null && prev?.positiveRate !== undefined
          && r.positiveRate !== null
          && (prev.positiveRate - r.positiveRate) > thresholds.dropPoints;
        const highRecurrence = r.recorrenciaRate !== null && r.recorrenciaRate > thresholds.recurrenceWarning;
        return { ...r, sinalRisco: !!(satisfactionDropped && highRecurrence) };
      });

      return NextResponse.json({ rows });
    }

    if (action === 'detail') {
      const companyId = searchParams.get('companyId');
      if (!companyId) {
        return NextResponse.json({ error: 'companyId é obrigatório.' }, { status: 400 });
      }
      const [topContacts, monthly] = await Promise.all([
        getContaTopContatos(filter, companyId),
        getContaEvolucaoMensal(filter, companyId)
      ]);
      return NextResponse.json({ topContacts, monthly });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[reports/accounts] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
