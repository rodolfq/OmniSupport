import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { resolvePeriod } from '@/lib/report-period';
import {
  getInternalTicketComplexity,
  complexityBand,
  COMPLEXITY_WEIGHTS,
  COMPLEXITY_CAPS
} from '@/lib/services/complexity-service';

// Relatório "Carga e Complexidade" (R7) — sobre TICKETS INTERNOS, ou seja, o
// trabalho do time de desenvolvimento. Mesmo padrão estrutural dos R1-R6.
//
// Responde três perguntas que a contagem de tickets por pessoa não responde:
//   1. quem está carregando mais TRABALHO (não mais linhas na tabela)
//   2. quais tickets foram realmente difíceis
//   3. quanto do que o time faz é defeito de produto
//
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

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (!isAuthorized(actor)) return NextResponse.json({ error: 'Sem permissão para ver relatórios.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';
  if (action !== 'overview') {
    return NextResponse.json({ error: `Action não suportada: ${action}` }, { status: 400 });
  }

  try {
    const { startDate, endDate } = await resolvePeriod(searchParams);
    // queueId/instanceId/companyId do MetricsFilterBar não se aplicam: ticket
    // interno não tem fila, canal nem empresa — ele nasce do time, não do
    // cliente. Só o período é lido.
    const rows = await getInternalTicketComplexity(startDate, endDate);

    // Peso de fallback para ticket sem classificação de esforço: a MEDIANA
    // dos pesos cadastrados. Sem fallback, a carga ponderada ficaria zerada
    // enquanto o time ainda não pegou o hábito de classificar — e indicador
    // que nasce zerado ninguém adota. A cobertura da classificação vai junto
    // no payload, pra ninguém ler a carga sem saber o quanto dela é estimada.
    const weightsRes = await query('SELECT weight FROM public.config_effort_levels');
    const fallbackWeight = median(weightsRes.rows.map((r: any) => Number(r.weight))) ?? 1;

    const effectiveWeight = (r: typeof rows[number]) => r.effortWeight ?? fallbackWeight;

    // -------------------------------------------------------- Por pessoa
    const byAssignee = new Map<string, any>();
    for (const r of rows) {
      const key = r.assigneeId || '__none__';
      const entry = byAssignee.get(key) || {
        assigneeId: r.assigneeId,
        assigneeName: r.assigneeName || 'Sem responsável',
        teamName: r.teamName,
        total: 0,
        open: 0,
        closed: 0,
        weightedOpenLoad: 0,
        complexityScores: [] as number[],
        highComplexity: 0,
        classified: 0,
        defects: 0,
        slaBreached: 0
      };
      entry.total += 1;
      if (r.isClosed) entry.closed += 1;
      else {
        entry.open += 1;
        // Carga ponderada olha só o que está EM ABERTO: é a pergunta "quem
        // está sobrecarregado agora". Somar o que já concluiu responderia
        // "quem produziu", que é a coluna `closed`.
        entry.weightedOpenLoad += effectiveWeight(r);
      }
      entry.complexityScores.push(r.score);
      if (complexityBand(r.score) === 'alta') entry.highComplexity += 1;
      if (r.effortLabel || r.outcomeLabel) entry.classified += 1;
      if (r.countsAsDefect) entry.defects += 1;
      if (r.slaBreached) entry.slaBreached += 1;
      byAssignee.set(key, entry);
    }

    const assignees = Array.from(byAssignee.values())
      .map(a => ({
        assigneeId: a.assigneeId,
        assigneeName: a.assigneeName,
        teamName: a.teamName,
        total: a.total,
        open: a.open,
        closed: a.closed,
        weightedOpenLoad: Number(a.weightedOpenLoad.toFixed(1)),
        avgComplexity: avg(a.complexityScores),
        highComplexity: a.highComplexity,
        classificationRate: a.total ? a.classified / a.total : 0,
        defects: a.defects,
        slaBreached: a.slaBreached
      }))
      .sort((x, y) => y.weightedOpenLoad - x.weightedOpenLoad);

    // Mediana do time — mesma postura do relatório de Analistas: comparar
    // cada pessoa contra o time, não contra uma meta absoluta inventada.
    const teamMedianLoad = median(assignees.filter(a => a.assigneeId).map(a => a.weightedOpenLoad));
    const teamMedianComplexity = median(
      assignees.filter(a => a.assigneeId && a.avgComplexity !== null).map(a => a.avgComplexity as number)
    );

    // ------------------------------------------------ Distribuições
    const effortDistribution = new Map<string, number>();
    const outcomeDistribution = new Map<string, number>();
    for (const r of rows) {
      if (r.effortLabel) effortDistribution.set(r.effortLabel, (effortDistribution.get(r.effortLabel) || 0) + 1);
      if (r.outcomeLabel) outcomeDistribution.set(r.outcomeLabel, (outcomeDistribution.get(r.outcomeLabel) || 0) + 1);
    }

    const classifiedCount = rows.filter(r => r.effortLabel || r.outcomeLabel).length;
    const withOutcome = rows.filter(r => r.outcomeLabel).length;

    const kpis = {
      total: rows.length,
      open: rows.filter(r => !r.isClosed).length,
      closed: rows.filter(r => r.isClosed).length,
      avgComplexity: avg(rows.map(r => r.score)),
      highComplexity: rows.filter(r => complexityBand(r.score) === 'alta').length,
      slaBreached: rows.filter(r => r.slaBreached).length,
      classificationRate: rows.length ? classifiedCount / rows.length : 0,
      // Taxa de defeito só sobre o que TEM desfecho preenchido — dividir pelo
      // total faria a taxa cair sozinha só porque ninguém classificou.
      defectRate: withOutcome ? rows.filter(r => r.countsAsDefect).length / withOutcome : null,
      linkedTicketCount: rows.reduce((sum, r) => sum + r.linkedTicketCount, 0),
      teamMedianLoad,
      teamMedianComplexity,
      fallbackWeight
    };

    // Os 20 mais complexos — a lista que interessa pra conversa de calibração
    // ("esse aqui o sistema achou difícil; bate com a sua percepção?").
    const topComplex = [...rows]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(r => ({
        id: r.id,
        internalTicketNumber: r.internalTicketNumber,
        title: r.title,
        status: r.status,
        isClosed: r.isClosed,
        assigneeName: r.assigneeName,
        teamName: r.teamName,
        hotfixName: r.hotfixName,
        score: r.score,
        band: complexityBand(r.score),
        messageCount: r.messageCount,
        participantCount: r.participantCount,
        linkedTicketCount: r.linkedTicketCount,
        durationDays: Number(r.durationDays.toFixed(1)),
        slaBreached: r.slaBreached,
        effortLabel: r.effortLabel,
        outcomeLabel: r.outcomeLabel
      }));

    return NextResponse.json({
      kpis,
      assignees,
      topComplex,
      effortDistribution: Array.from(effortDistribution, ([label, count]) => ({ label, count })),
      outcomeDistribution: Array.from(outcomeDistribution, ([label, count]) => ({ label, count })),
      // A fórmula viaja junto para a tela poder explicar o número sem
      // duplicar as constantes no client.
      formula: { weights: COMPLEXITY_WEIGHTS, caps: COMPLEXITY_CAPS },
      period: { startDate, endDate }
    });
  } catch (error: any) {
    console.error('[reports/workload]', error);
    return NextResponse.json({ error: error.message || 'Falha ao gerar o relatório.' }, { status: 500 });
  }
}
