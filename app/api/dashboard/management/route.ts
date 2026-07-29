import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyJWT } from '@/lib/jwt';
import { canViewManagementDashboard } from '@/lib/report-access';
import { getTodaySP, toDateOnly, addDaysUTC, resolvePeriod, buildMetricsFilter, scopeFromSearchParams } from '@/lib/report-period';
import { MetricsFilter, MetricThresholds, KpiStatus, ManagementAlert } from '@/lib/types';
import {
  getVolumeChats,
  getTempoPrimeiraResposta,
  getPctRespondidoAte2min,
  getDuracaoChat,
  getMsgsPorChat,
  getSatisfacao,
  getTaxaAbandono,
  getCargaSimultanea,
  getAnalistasOnline,
  getPicoIndividual,
  getChatsEmEsperaAgora,
  getCargaAtualPorAnalista,
  getPeriodBounds
} from '@/lib/services/metrics-service';

// Dashboard Gerencial (Etapa 3 do roadmap "Time x Gerencial"). Regra de
// ouro combinada com o usuário: a permissão dashboard:management precisa
// ser checada aqui, não só escondendo o item de menu — mesmo padrão de
// getActor/canReadAuditLog em app/api/reports/audit-log/route.ts.

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
  return actor?.role === 'Administrador' || canViewManagementDashboard(actor?.permissions || []);
}

// Resolução de período/filtro agora é compartilhada — ver lib/report-period.ts
// (extraído daqui quando o R1 virou o segundo consumidor). buildFilter local
// mantido só como alias fino: o dashboard gerencial não expõe filtro de
// empresa na UI (Etapa 3), mas MetricsFilter aceita companyId undefined sem
// problema — buildMetricsFilter genérico serve igual.
const buildFilter = buildMetricsFilter;

async function getThresholds(): Promise<MetricThresholds> {
  const res = await query('SELECT * FROM public.config_metric_thresholds WHERE id = 1');
  const row = res.rows[0] || {};
  return {
    firstResponseGoodSeconds: Number(row.first_response_good_seconds ?? 120),
    firstResponseWarningSeconds: Number(row.first_response_warning_seconds ?? 300),
    pct2minGoodPercentage: Number(row.pct_2min_good_percentage ?? 80),
    pct2minWarningPercentage: Number(row.pct_2min_warning_percentage ?? 60),
    durationGoodMinutes: Number(row.duration_good_minutes ?? 10),
    durationWarningMinutes: Number(row.duration_warning_minutes ?? 20),
    satisfactionGoodPercentage: Number(row.satisfaction_good_percentage ?? 85),
    satisfactionWarningPercentage: Number(row.satisfaction_warning_percentage ?? 70),
    individualPeakGood: Number(row.individual_peak_good ?? 3),
    individualPeakWarning: Number(row.individual_peak_warning ?? 5),
    waitingNowGood: Number(row.waiting_now_good ?? 2),
    waitingNowWarning: Number(row.waiting_now_warning ?? 5),
    volumeMinExpected: Number(row.volume_min_expected ?? 1),
    capacityRatioGood: Number(row.capacity_ratio_good ?? 2),
    capacityRatioWarning: Number(row.capacity_ratio_warning ?? 4),
    riskSatisfactionDropPoints: Number(row.risk_satisfaction_drop_points ?? 15),
    riskRecurrenceRateWarning: Number(row.risk_recurrence_rate_warning ?? 20)
  };
}

// value===null vira 'warning' (amostra insuficiente pra afirmar nada, não é
// "bom" nem claramente "ruim").
function classify(value: number | null, goodBound: number, warningBound: number, higherIsBetter: boolean): KpiStatus {
  if (value === null) return 'warning';
  if (higherIsBetter) {
    if (value >= goodBound) return 'good';
    if (value >= warningBound) return 'warning';
    return 'danger';
  }
  if (value <= goodBound) return 'good';
  if (value <= warningBound) return 'warning';
  return 'danger';
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    if (!isAuthorized(actor)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'kpis') {
      const { startDate, endDate } = await resolvePeriod(searchParams);
      const filter = buildFilter(searchParams, startDate, endDate);
      const scope = scopeFromSearchParams(searchParams);
      const thresholds = await getThresholds();

      const [volume, firstResponse, pct2min, duration, satisfaction, peaks, waitingNow] = await Promise.all([
        getVolumeChats(filter),
        getTempoPrimeiraResposta(filter),
        getPctRespondidoAte2min(filter),
        getDuracaoChat(filter),
        getSatisfacao(filter),
        getPicoIndividual(filter),
        getChatsEmEsperaAgora(scope)
      ]);

      const individualPeakValue = peaks.length ? peaks[0].peakConcurrent : 0;

      return NextResponse.json({
        parcial: volume.parcial,
        volume: {
          count: volume.count,
          status: volume.count === 0 ? 'danger' : (volume.count >= thresholds.volumeMinExpected ? 'good' : 'warning') as KpiStatus
        },
        firstResponse: {
          medianSeconds: firstResponse.medianSeconds,
          p90Seconds: firstResponse.p90Seconds,
          sampleSize: firstResponse.sampleSize,
          status: classify(firstResponse.medianSeconds, thresholds.firstResponseGoodSeconds, thresholds.firstResponseWarningSeconds, false)
        },
        pct2min: {
          percentage: pct2min.percentage,
          status: classify(pct2min.percentage, thresholds.pct2minGoodPercentage, thresholds.pct2minWarningPercentage, true)
        },
        duration: {
          medianMinutes: duration.medianMinutes,
          status: classify(duration.medianMinutes, thresholds.durationGoodMinutes, thresholds.durationWarningMinutes, false)
        },
        satisfaction: {
          positiveRate: satisfaction.positiveRate,
          responseRate: satisfaction.responseRate,
          status: classify(satisfaction.positiveRate, thresholds.satisfactionGoodPercentage, thresholds.satisfactionWarningPercentage, true)
        },
        individualPeak: {
          value: individualPeakValue,
          status: classify(individualPeakValue, thresholds.individualPeakGood, thresholds.individualPeakWarning, false)
        },
        waitingNow: {
          count: waitingNow,
          status: classify(waitingNow, thresholds.waitingNowGood, thresholds.waitingNowWarning, false)
        }
      });
    }

    if (action === 'trend') {
      // Fixo em 6 meses (aprovado no plano da Etapa 3) — independente do
      // período selecionado no filtro do topo, que só se aplica aos KPIs e
      // à carga por horário. Fila/instância continuam valendo aqui.
      const MONTHS_BACK = 6;
      const today = await getTodaySP();
      const months = Array.from({ length: MONTHS_BACK }, (_, idx) => {
        const i = MONTHS_BACK - 1 - idx;
        const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
        const monthEndExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 1));
        const isCurrentMonth = i === 0;
        const endDate = isCurrentMonth ? today : addDaysUTC(monthEndExclusive, -1);
        return {
          label: monthStart.toISOString().slice(0, 7),
          startDate: toDateOnly(monthStart),
          endDate: toDateOnly(endDate)
        };
      });

      const rows = await Promise.all(months.map(async (m) => {
        const filter = buildFilter(searchParams, m.startDate, m.endDate);
        const [volume, pct2min, firstResponse, satisfaction, msgsPorChat, duration] = await Promise.all([
          getVolumeChats(filter),
          getPctRespondidoAte2min(filter),
          getTempoPrimeiraResposta(filter),
          getSatisfacao(filter),
          getMsgsPorChat(filter),
          getDuracaoChat(filter)
        ]);
        return {
          month: m.label,
          volume: volume.count,
          pct2min: pct2min.percentage,
          firstResponseMedianSeconds: firstResponse.medianSeconds,
          satisfaction: satisfaction.positiveRate,
          msgsPorChat: msgsPorChat.average,
          durationMedianMinutes: duration.medianMinutes
        };
      }));

      return NextResponse.json({ months: rows });
    }

    if (action === 'comparison') {
      // Semana de calendário (segunda a domingo, America/Sao_Paulo) —
      // aprovado no plano da Etapa 3. Fixo, independente do período do
      // filtro do topo, mesma lógica de 'trend' acima.
      const today = await getTodaySP();
      const weekday = today.getUTCDay();
      const daysSinceMonday = (weekday + 6) % 7;
      const currentMonday = addDaysUTC(today, -daysSinceMonday);
      const previousMonday = addDaysUTC(currentMonday, -7);
      const previousSunday = addDaysUTC(currentMonday, -1);

      const currentFilter = buildFilter(searchParams, toDateOnly(currentMonday), toDateOnly(today));
      const previousFilter = buildFilter(searchParams, toDateOnly(previousMonday), toDateOnly(previousSunday));

      async function fetchWeek(filter: MetricsFilter) {
        const [volume, firstResponse, pct2min, duration, satisfaction, abandono] = await Promise.all([
          getVolumeChats(filter),
          getTempoPrimeiraResposta(filter),
          getPctRespondidoAte2min(filter),
          getDuracaoChat(filter),
          getSatisfacao(filter),
          getTaxaAbandono(filter)
        ]);
        return { volume, firstResponse, pct2min, duration, satisfaction, abandono };
      }

      const [current, previous] = await Promise.all([fetchWeek(currentFilter), fetchWeek(previousFilter)]);

      // higherIsBetter: null = neutro (volume não tem direção certa/errada,
      // só mostra a variação). unit dá pro cliente formatar sem precisar
      // adivinhar pelo texto do label (frágil, quebraria se o label mudasse).
      const rows: { metric: string; unit: 'count' | 'seconds' | 'percentage' | 'minutes'; current: number | null; previous: number | null; higherIsBetter: boolean | null }[] = [
        { metric: 'Volume de chats', unit: 'count', current: current.volume.count, previous: previous.volume.count, higherIsBetter: null },
        { metric: '1ª resposta (mediana)', unit: 'seconds', current: current.firstResponse.medianSeconds, previous: previous.firstResponse.medianSeconds, higherIsBetter: false },
        { metric: '% até 2 min', unit: 'percentage', current: current.pct2min.percentage, previous: previous.pct2min.percentage, higherIsBetter: true },
        { metric: 'Duração (mediana)', unit: 'minutes', current: current.duration.medianMinutes, previous: previous.duration.medianMinutes, higherIsBetter: false },
        { metric: 'Satisfação', unit: 'percentage', current: current.satisfaction.positiveRate, previous: previous.satisfaction.positiveRate, higherIsBetter: true },
        { metric: 'Taxa de abandono', unit: 'percentage', current: current.abandono.percentage, previous: previous.abandono.percentage, higherIsBetter: false }
      ];

      return NextResponse.json({
        currentWeek: { startDate: toDateOnly(currentMonday), endDate: toDateOnly(today) },
        previousWeek: { startDate: toDateOnly(previousMonday), endDate: toDateOnly(previousSunday) },
        rows
      });
    }

    if (action === 'load-by-hour') {
      const { startDate, endDate } = await resolvePeriod(searchParams);
      const filter = buildFilter(searchParams, startDate, endDate);

      const [carga, analistas, peaks] = await Promise.all([
        getCargaSimultanea(filter),
        getAnalistasOnline(filter),
        getPicoIndividual(filter)
      ]);

      // Chave de join é hourOfDay (número), não bucketStart: o driver `pg`
      // devolve timestamptz como objeto Date, e duas instâncias de Date
      // pra exatamente o mesmo instante nunca são iguais por referência —
      // usar bucketStart como chave de Map/Map.get nunca batia, então
      // "Analistas online" ficava sempre 0 no gráfico.
      const analistasByBucket = new Map(analistas.map(a => [a.hourOfDay, a.count]));
      const buckets = carga.map(c => ({
        bucketStart: c.bucketStart,
        cargaSimultanea: c.count,
        analistasOnline: analistasByBucket.get(c.hourOfDay) ?? 0
      }));

      return NextResponse.json({
        buckets,
        // Linha de referência fixa no gráfico — o pico do período inteiro,
        // não uma série por hora (não recalculamos "pico por hora", ver
        // discussão no plano da Etapa 3).
        individualPeakReference: peaks.length ? peaks[0].peakConcurrent : 0
      });
    }

    if (action === 'alerts') {
      const { startDate, endDate } = await resolvePeriod(searchParams);
      const filter = buildFilter(searchParams, startDate, endDate);
      const scope = scopeFromSearchParams(searchParams);
      const thresholds = await getThresholds();

      const alerts: ManagementAlert[] = [];
      const bounds = await getPeriodBounds(filter);

      const [waitingNow, negativeEvaluations, loadNow, queuesWithoutOnline] = await Promise.all([
        getChatsEmEsperaAgora(scope),
        query(
          `SELECT s.id AS session_id, s.customer_name, p.name AS assignee_name, h.finished_at
           FROM public.chat_sessions s
           LEFT JOIN public.queues q ON q.id = s.queue_id
           LEFT JOIN public.profiles p ON p.id = s.assignee_id
           LEFT JOIN LATERAL (
             SELECT finished_at, rating FROM public.chat_histories
             WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
           ) h ON true
           WHERE s.created_at >= $1 AND s.created_at < $2
             AND ($3::text IS NULL OR s.queue_id = $3)
             AND ($4::text IS NULL OR q.whatsapp_instance_id = $4)
             AND h.rating = -1
           ORDER BY h.finished_at DESC
           LIMIT 20`,
          [bounds.startUtc, bounds.endUtcExclusive, scope.queueId ?? null, scope.instanceId ?? null]
        ),
        getCargaAtualPorAnalista(scope),
        query(
          `SELECT q.id, q.name
           FROM public.queues q
           WHERE ($1::text IS NULL OR q.id = $1)
             AND ($2::text IS NULL OR q.whatsapp_instance_id = $2)
             AND NOT EXISTS (
               SELECT 1 FROM unnest(q.member_ids) AS uid
               JOIN public.analyst_status a ON a.user_id = uid AND a.is_online = true
             )`,
          [scope.queueId ?? null, scope.instanceId ?? null]
        )
      ]);

      if (waitingNow > thresholds.waitingNowWarning) {
        alerts.push({
          id: 'waiting-now',
          severity: 'danger',
          message: `${waitingNow} chats em espera acima do limite configurado (limite: ${thresholds.waitingNowWarning})`
        });
      }

      const negativeCount = negativeEvaluations.rows.length;
      if (negativeCount > 0) {
        alerts.push({
          id: 'negative-evaluations',
          severity: 'warning',
          message: `${negativeCount} avaliação(ões) negativa(s) no período`
        });
      }

      for (const analyst of loadNow) {
        if (analyst.activeChats > thresholds.individualPeakWarning) {
          alerts.push({
            id: `peak-${analyst.analystId}`,
            severity: 'warning',
            message: `${analyst.analystName} com ${analyst.activeChats} chats simultâneos (limite configurado: ${thresholds.individualPeakWarning})`
          });
        }
      }

      for (const q of queuesWithoutOnline.rows) {
        alerts.push({
          id: `queue-offline-${q.id}`,
          severity: 'warning',
          message: `Fila "${q.name}" sem nenhum membro online agora`
        });
      }

      return NextResponse.json({ alerts });
    }

    return NextResponse.json({ error: 'Action não suportada.' }, { status: 400 });
  } catch (error: any) {
    console.error('[dashboard/management] Erro no GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
