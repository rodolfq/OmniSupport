import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { CapacityRawBucket, CapacityHourSummary, KpiStatus } from '@/lib/types';
import { getCargaCapacidadePorFaixaBruta } from '@/lib/services/metrics-service';

// Relatório "Carga e Capacidade" (R3) — mesmo padrão estrutural do R1.
// Acesso: reports:read. Sem filtro por analista (pergunta é de cobertura de
// equipe, não individual).

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

// Cópia local do mesmo formato de app/api/dashboard/management/route.ts —
// cada rota de relatório lê a própria linha de config_metric_thresholds,
// não existe um helper compartilhado ainda (mesmo estado dos outros
// arquivos de relatório).
async function getCriticalRatio(): Promise<{ good: number; warning: number }> {
  const res = await query('SELECT capacity_ratio_good, capacity_ratio_warning FROM public.config_metric_thresholds WHERE id = 1');
  const row = res.rows[0] || {};
  return {
    good: Number(row.capacity_ratio_good ?? 2),
    warning: Number(row.capacity_ratio_warning ?? 4)
  };
}

function classify(value: number | null, goodBound: number, warningBound: number): KpiStatus {
  if (value === null) return 'warning';
  if (value <= goodBound) return 'good';
  if (value <= warningBound) return 'warning';
  return 'danger';
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rollupByHour(raw: CapacityRawBucket[], thresholds: { good: number; warning: number }): CapacityHourSummary[] {
  const result: CapacityHourSummary[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const rows = raw.filter(r => r.hour === hour);
    const dias = new Set(rows.map(r => r.dateSp));
    const diasCriticos = new Set(rows.filter(r => r.critico).map(r => r.dateSp));
    const cargaPorAnalistaMediana = median(rows.map(r => r.cargaPorAnalista).filter((v): v is number => v !== null));
    result.push({
      hour,
      cargaSimultaneaMediana: median(rows.map(r => r.cargaSimultanea)),
      analistasOnlineMediana: median(rows.map(r => r.analistasOnline)),
      picoIndividualMediana: median(rows.map(r => r.picoIndividual)),
      cargaPorAnalistaMediana,
      diasCriticos: diasCriticos.size,
      diasAmostrados: dias.size,
      status: classify(cargaPorAnalistaMediana, thresholds.good, thresholds.warning)
    });
  }
  return result;
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
    const thresholds = await getCriticalRatio();

    if (action === 'by-hour') {
      const raw = await getCargaCapacidadePorFaixaBruta(filter, thresholds.warning);
      const hours = rollupByHour(raw, thresholds);
      return NextResponse.json({ hours });
    }

    if (action === 'raw') {
      const hourParam = searchParams.get('hour');
      const hour = hourParam !== null ? Number(hourParam) : NaN;
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return NextResponse.json({ error: 'hour inválida — use um inteiro de 0 a 23.' }, { status: 400 });
      }
      const raw = await getCargaCapacidadePorFaixaBruta(filter, thresholds.warning);
      const rows = raw.filter(r => r.hour === hour).sort((a, b) => a.dateSp.localeCompare(b.dateSp));
      return NextResponse.json({ rows });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[reports/capacity] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
