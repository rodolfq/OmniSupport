import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod, buildMetricsFilter } from '@/lib/report-period';
import { anonymizeAnalystRows } from '@/lib/report-anonymize';
import { AnalystPerformanceRow } from '@/lib/types';
import { getPointsConfig } from '@/lib/services/analyst-points-service';
import { getTicketConfig } from '@/lib/services/ticket-points-service';
import { getTicketPerformance, getTicketBacklog } from '@/lib/services/ticket-metrics-service';
import { computeTicketPoints, TicketCounts } from '@/lib/ticket-points';
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

    if (action === 'tickets') {
      // Visão de CHAMADO do mesmo relatório: SLA, 1ª resposta (com interação do cliente), nasce resolvido,
      // reabertura e backlog. O chat continua na ação 'performance', sem mudança.
      const cfg = await getTicketConfig();
      const [perf, backlog] = await Promise.all([
        getTicketPerformance(filter, cfg.config.metas.primeiraRespostaMin),
        getTicketBacklog(cfg.config.regras.backlogHorasUteis),
      ]);
      const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
      const teamRow = perf.find(r => r.analystId === null) ?? null;
      const merged = perf.filter(r => r.analystId !== null).map(r => {
        const counts: TicketCounts = {
          slaOk: r.slaOk,
          slaMiss: r.slaMiss,
          frNoPrazo: r.frNoPrazo,
          frForaPrazo: r.frForaPrazo,
          nasceramResolvidos: r.nasceramResolvidos,
          backlog: backlog.porAnalista.get(r.analystId as string) ?? 0,
          reaberturas: r.reaberturas,
        };
        return {
          analystId: r.analystId as string,
          analystName: r.analystName,
          avatarUrl: r.avatarUrl,
          chamados: r.chamados,
          amostraInsuficiente: r.chamados < cfg.config.regras.amostraMinima,
          slaPct: r.slaOk + r.slaMiss >= cfg.config.regras.amostraMinima ? pct(r.slaOk, r.slaOk + r.slaMiss) : null,
          slaMiss: r.slaMiss,
          slaPendentes: r.slaPendentes,
          slaOk: r.slaOk,
          frNoPrazo: r.frNoPrazo,
          frForaPrazo: r.frForaPrazo,
          nasceram: r.nasceramResolvidos,
          comHistorico: r.comHistorico,
          fechados: r.fechados,
          reabertos: r.reabertos,
          frMedianaMin: r.frMedianaMin,
          frAmostra: r.frAmostra,
          nasceramPct: r.comHistorico >= cfg.config.regras.amostraMinima ? pct(r.nasceramResolvidos, r.comHistorico) : null,
          reaberturaPct: r.fechados >= cfg.config.regras.amostraMinima ? pct(r.reabertos, r.fechados) : null,
          backlog: counts.backlog,
          reaberturas: r.reaberturas,
          points: computeTicketPoints(counts, cfg.config.pontos),
        };
      });
      const rows = canSeeIndividual(actor) ? merged.map(r => ({ ...r, isSelf: r.analystId === actor.id })) : await anonymizeAnalystRows(actor.id, merged);

      const t = teamRow;
      const metas = cfg.config.metas;
      // Indicador sem amostra mínima não mostra valor: 2 casos de 1ª resposta não viram uma média.
      const minimo = cfg.config.regras.amostraMinima;
      const medidos = t ? t.slaOk + t.slaMiss : 0;
      const objetivos = [
        { id: 'prazo', objetivo: 'Atender no prazo', kpi: '% chamados no SLA', unidade: '%', sentido: '>=', meta: metas.slaPct,
          atual: medidos >= minimo ? pct(t!.slaOk, medidos) : null, amostra: medidos, dono: 'Gestor Suporte', freq: 'Diária' },
        { id: 'espera', objetivo: 'Reduzir espera', kpi: 'Mediana da 1ª resposta', unidade: 'min', sentido: '<=', meta: metas.primeiraRespostaMin,
          atual: t && t.frAmostra >= minimo ? t.frMedianaMin : null, amostra: t ? t.frAmostra : 0, dono: 'Coordenação', freq: 'Diária' },
        { id: 'resolver', objetivo: 'Resolver melhor', kpi: '% nasce resolvido', unidade: '%', sentido: '>=', meta: metas.resolucaoPrimeiroContatoPct,
          atual: t && t.comHistorico >= minimo ? pct(t.nasceramResolvidos, t.comHistorico) : null, amostra: t ? t.comHistorico : 0, dono: 'Gestor Suporte', freq: 'Semanal' },
        { id: 'backlog', objetivo: 'Evitar backlog', kpi: `Chamados > ${cfg.config.regras.backlogHorasUteis}h úteis`, unidade: 'chamados', sentido: '<=', meta: metas.backlogMax,
          atual: backlog.total, amostra: t ? t.chamados : 0, dono: 'Coordenação', freq: 'Diária' },
        { id: 'qualidade', objetivo: 'Melhorar qualidade', kpi: '% reabertura de chamados', unidade: '%', sentido: '<=', meta: metas.reaberturaPct,
          atual: t && t.fechados >= minimo ? pct(t.reabertos, t.fechados) : null, amostra: t ? t.fechados : 0, dono: 'Líderes', freq: 'Semanal' },
      ].map(o => ({
        ...o,
        gap: o.atual === null ? null : o.atual - o.meta,
        atingiu: o.atual === null ? null : (o.sentido === '>=' ? o.atual >= o.meta : o.atual <= o.meta),
      }));

      return NextResponse.json({
        rows,
        time: t ? {
          chamados: t.chamados,
          slaOk: t.slaOk,
          slaMiss: t.slaMiss,
          frNoPrazo: t.frNoPrazo,
          frForaPrazo: t.frForaPrazo,
          nasceram: t.nasceramResolvidos,
          comHistorico: t.comHistorico,
          fechados: t.fechados,
          reabertos: t.reabertos,
          frAmostra: t.frAmostra,
          semInteracaoCliente: t.chamados - t.frAmostra,
          slaSemHistorico: t.slaSemHistorico,
          slaPendentes: t.slaPendentes,
          backlog: backlog.total,
        } : null,
        objetivos,
        configIsDefault: cfg.isDefault,
        configUpdatedAt: cfg.updatedAt,
        config: cfg.config,
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
