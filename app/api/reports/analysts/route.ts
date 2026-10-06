import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { anonymizeAnalystRows } from '@/lib/report-anonymize';
import { AnalystPerformanceRow } from '@/lib/types';
import { getPointsConfig } from '@/lib/services/analyst-points-service';
import { aggregatePoints, dataQuality } from '@/lib/analyst-points';
import {
  getDesempenhoPorAnalista,
  getIntervaloRespostaPorAnalista,
  getSimultaneidadePorAnalista,
  getHorasOnlinePorAnalista,
  getTempoAusentePorMotivo,
  getPresenceTimeline,
  getPontosSessoes,
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
      const [rows, concurrency, hoursOnline, pointsSessions, pointsConfig, intervalo] = await Promise.all([
        getDesempenhoPorAnalista(filter),
        getSimultaneidadePorAnalista(filter),
        getHorasOnlinePorAnalista(filter),
        getPontosSessoes(filter),
        getPointsConfig(),
        getIntervaloRespostaPorAnalista(filter)
      ]);
      // Conta por conversa, com os pesos vigentes (volume por tag, bad, good, faixas).
      const countsByAnalyst = aggregatePoints(pointsSessions, pointsConfig.weights);
      const quality = dataQuality(pointsSessions);

      const merged: AnalystPerformanceRow[] = rows.map(r => {
        const conc = concurrency.get(r.analystId);
        const horasOnline = hoursOnline.get(r.analystId) ?? null;
        const c = countsByAnalyst.get(r.analystId);
        return {
          ...r,
          points: { volume: c?.volume ?? 0, volumePoints: c?.volumePoints ?? 0, good: c?.good ?? 0, bad: c?.bad ?? 0, lt1: c?.lt1 ?? 0, lt3: c?.lt3 ?? 0, gt3: c?.gt3 ?? 0 },
          simultaneidadeMedia: conc?.media ?? null,
          simultaneidadePico: conc?.pico ?? null,
          intervaloRespostaMedianSeconds: intervalo.get(r.analystId)?.median ?? null,
          intervaloRespostaTurnos: intervalo.get(r.analystId)?.turnos ?? 0,
          horasOnline,
          chatsPorHoraOnline: horasOnline && horasOnline > 0 ? r.chatsAtendidos / horasOnline : null
        };
      });

      const teamMedians = computeTeamMedians(merged);

      const finalRows = canSeeIndividual(actor) ? merged.map(r => ({ ...r, isSelf: r.analystId === actor.id })) : await anonymizeAnalystRows(actor.id, merged);

      return NextResponse.json({
        rows: finalRows,
        teamMedians,
        pointsWeights: pointsConfig.weights,
        pointsDataQuality: quality,
        pointsConfigUpdatedAt: pointsConfig.updatedAt,
        pointsConfigIsDefault: pointsConfig.isDefault,
      });
    }

    if (action === 'absences') {
      const rows = await getTempoAusentePorMotivo(filter);
      const finalRows = canSeeIndividual(actor) ? rows.map(r => ({ ...r, isSelf: r.analystId === actor.id })) : await anonymizeAnalystRows(actor.id, rows);
      return NextResponse.json({ rows: finalRows });
    }

    if (action === 'presence-timeline') {
      // Detalhe de um analista: cada trecho de status com início, fim e motivo.
      // Sem reports:individual, o ator só vê a própria linha do tempo.
      const analystId = searchParams.get('analystId');
      if (!analystId) {
        return NextResponse.json({ error: 'analystId é obrigatório.' }, { status: 400 });
      }
      if (!canSeeIndividual(actor) && analystId !== actor.id) {
        return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
      }
      const segments = await getPresenceTimeline(analystId, filter);
      return NextResponse.json({ segments, period: { startDate, endDate } });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[reports/analysts] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
