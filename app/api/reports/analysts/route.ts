import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { anonymizeAnalystRows } from '@/lib/report-anonymize';
import { AnalystPerformanceRow } from '@/lib/types';
import {
  getDesempenhoPorAnalista,
  getSimultaneidadePorAnalista,
  getHorasOnlinePorAnalista,
  getTempoAusentePorMotivo,
  computeTeamMedians
} from '@/lib/services/metrics-service';

// Relatório "Desempenho por Analista" (R2) — mesmo padrão estrutural do R1.
// Acesso: reports:read pro agregado; reports:individual pra ver nomes reais
// (senão anonimizado "Analista N", exceto a própria linha do ator logado).

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

function canSeeIndividual(actor: any): boolean {
  return actor?.role === 'Administrador' || (actor?.permissions || []).includes('reports:individual');
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

    if (action === 'performance') {
      const [rows, concurrency, hoursOnline] = await Promise.all([
        getDesempenhoPorAnalista(filter),
        getSimultaneidadePorAnalista(filter),
        getHorasOnlinePorAnalista(filter)
      ]);

      const merged: AnalystPerformanceRow[] = rows.map(r => {
        const conc = concurrency.get(r.analystId);
        const horasOnline = hoursOnline.get(r.analystId) ?? null;
        return {
          ...r,
          simultaneidadeMedia: conc?.media ?? null,
          simultaneidadePico: conc?.pico ?? null,
          horasOnline,
          chatsPorHoraOnline: horasOnline && horasOnline > 0 ? r.chatsAtendidos / horasOnline : null
        };
      });

      const teamMedians = computeTeamMedians(merged);

      const finalRows = canSeeIndividual(actor) ? merged.map(r => ({ ...r, isSelf: r.analystId === actor.id })) : await anonymizeAnalystRows(actor.id, merged);

      return NextResponse.json({ rows: finalRows, teamMedians });
    }

    if (action === 'absences') {
      const rows = await getTempoAusentePorMotivo(filter);
      const finalRows = canSeeIndividual(actor) ? rows.map(r => ({ ...r, isSelf: r.analystId === actor.id })) : await anonymizeAnalystRows(actor.id, rows);
      return NextResponse.json({ rows: finalRows });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[reports/analysts] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
