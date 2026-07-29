import { query } from '../db';
import {
  MetricsFilter,
  CountResult,
  MedianP90Result,
  PercentageResult,
  MedianMinutesResult,
  AverageResult,
  HourlyBucket,
  SatisfactionResult,
  AnalystPeak,
  AnalystLoadNow,
  HourOfDayBucket,
  WeekdayBucket,
  ReportDimension,
  DimensionBreakdownRow,
  AnalystPerformanceRow,
  AnalystAbsenceBreakdown,
  TeamMedians,
  MIN_ANALYST_SAMPLE,
  CapacityRawBucket,
  SatisfactionTrendBucket,
  SatisfactionDimensionRow,
  SatisfactionTimeRangeRow,
  AccountSummaryRow,
  AccountTopContact,
  AccountMonthlyBucket
} from '../types';

// Fonte ÚNICA de cálculo das métricas de chat — dashboard gerencial e
// relatórios consomem daqui, nunca recalculam por conta própria. Se cada
// tela calcular do seu jeito, a reunião de diretoria vira discussão sobre
// qual número está certo.
//
// Convenções que valem para TODAS as funções abaixo:
//
// - 1ª RESPOSTA = primeira mensagem HUMANA do analista dentro da conversa:
//   chat_messages.type <> 'system' E sender_id <> chat_sessions.customer_id
//   (e sender_id IS NOT NULL, pra não contar uma linha de sistema sem
//   remetente). NÃO usamos automation_dispatches: aquela tabela é uma fila
//   de notificação por CHAMADO (ticket_id), sem session_id — não tem como
//   ligar a uma conversa. O critério acima é o mesmo que o código já usa
//   hoje (client-side, em chat-widget.tsx) pra popular
//   chat_histories.first_response_seconds ao fechar um atendimento.
//
// - Tempo é sempre MEDIANA (percentile_cont(0.5)), nunca média — média some
//   com outlier (um chat esquecido aberto por 3 dias não pode distorcer o
//   número de todo mundo).
//
// - FUSO: o banco grava tudo em UTC; a operação (e todo filtro de período)
//   é em America/Sao_Paulo. A conversão de data local -> instante UTC
//   acontece só em getPeriodBounds() abaixo, inteiramente em SQL (Postgres
//   AT TIME ZONE) — nunca na hora local do processo Node, que pode estar
//   rodando em qualquer fuso dependendo do ambiente de deploy.
//
// - CHAT TRANSFERIDO: atribuído inteiro ao último respondente, isto é,
//   chat_sessions.assignee_id (coluna atual — não existe histórico de quem
//   atendeu antes de uma transferência). Mesma regra que todo o resto do
//   código já usa (getRecentByCompany, dashboards, etc.).
//
// - PERÍODO PARCIAL: toda função devolve `parcial: true` quando o
//   `endDate` pedido ainda não fechou (é hoje ou está no futuro, no
//   calendário America/Sao_Paulo) — calculado em getPeriodBounds(),
//   também em SQL, pelo mesmo motivo do fuso acima.
//
// - Base de chats é sempre chat_sessions, com LEFT JOIN para
//   chat_histories — nunca o inverso. Chat abandonado ou ainda aberto não
//   tem linha em chat_histories (só é gravada no fechamento "normal"); uma
//   query que partisse de chat_histories perderia esses casos.
//
// - TEMPO EM ESPERA: por decisão explícita (sem fonte de dado melhor por
//   enquanto — chat_sessions.status é mutável, sem timestamp de transição
//   de status salvo em lugar nenhum), é hoje uma APROXIMAÇÃO idêntica ao
//   tempo de 1ª resposta (tempo até alguém humano falar). Não é "tempo até
//   cair com alguém", é "tempo até a 1ª resposta" — as dias métricas usam a
//   mesma função interna (computeFirstResponseStats) até existir uma fonte
//   de dado de transição de status de verdade.
//
// - Nesta etapa, todo cálculo é on-the-fly (sem tabela de rollup). A
//   assinatura pública de cada função (recebe só MetricsFilter, devolve um
//   tipo de resultado pronto) foi desenhada pra não precisar mudar no dia
//   em que a origem virar uma tabela agregada — só o helper
//   buildScopedSessionsCte()/getPeriodBounds() internos mudariam.

interface PeriodBounds {
  startUtc: string;
  endUtcExclusive: string;
  parcial: boolean;
}

// Único ponto de conversão de fuso do arquivo inteiro — todas as outras
// funções recebem startUtc/endUtcExclusive já prontos e nunca fazem sua
// própria conta de data. Exportada porque app/api/dashboard/management/
// route.ts precisa dos mesmos limites pra uma query own (lista de avaliações
// negativas) que não é, em si, uma das 11 métricas — mas tem que respeitar
// o mesmo período/fuso, sem duplicar a conversão.
export async function getPeriodBounds(filter: MetricsFilter): Promise<PeriodBounds> {
  const res = await query(
    `SELECT
       ($1::date)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS start_utc,
       (($2::date + 1))::timestamp AT TIME ZONE 'America/Sao_Paulo' AS end_utc,
       (NOW() AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date AS parcial`,
    [filter.startDate, filter.endDate]
  );
  const row = res.rows[0];
  return { startUtc: row.start_utc, endUtcExclusive: row.end_utc, parcial: row.parcial };
}

// Fragmento de WHERE + params comuns a toda métrica cujo escopo é "chats
// INICIADOS no período" (a maioria). Espera FROM public.chat_sessions s
// LEFT JOIN public.queues q ON q.id = s.queue_id LEFT JOIN public.profiles
// cust ON cust.id = s.customer_id — os aliases q/cust só existem pra
// resolver instância e empresa, sessões sem fila/sem customer_id vinculado
// ficam de fora quando esses filtros são usados (mesma limitação já aceita
// em getChatHistoriesByCompany/getActiveSessionsByCompany).
function scopeByStartWhere(alias = 's'): string {
  return `
    ${alias}.created_at >= $1 AND ${alias}.created_at < $2
    AND ($3::text IS NULL OR ${alias}.queue_id = $3)
    AND ($4::text IS NULL OR q.whatsapp_instance_id = $4)
    AND ($5::uuid IS NULL OR cust.company_id = $5)
    AND ($6::uuid IS NULL OR ${alias}.assignee_id = $6)
  `;
}

function scopeParams(bounds: PeriodBounds, filter: MetricsFilter): any[] {
  return [
    bounds.startUtc,
    bounds.endUtcExclusive,
    filter.queueId ?? null,
    filter.instanceId ?? null,
    filter.companyId ?? null,
    filter.analystId ?? null
  ];
}

const SCOPED_SESSIONS_JOIN = `
  FROM public.chat_sessions s
  LEFT JOIN public.queues q ON q.id = s.queue_id
  LEFT JOIN public.profiles cust ON cust.id = s.customer_id
`;

// Pega a linha de chat_histories mais recente de uma sessão — uma sessão só
// deveria fechar uma vez, mas seguimos o mesmo padrão defensivo já usado no
// UPDATE de rating (app/api/chats/route.ts) pra não quebrar se algum
// caminho gravar mais de uma linha.
const LATEST_HISTORY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT finished_at, duration_seconds, rating
    FROM public.chat_histories
    WHERE session_id = s.id
    ORDER BY created_at DESC
    LIMIT 1
  ) h ON true
`;

// --- 1. volumeChats ---------------------------------------------------

export async function getVolumeChats(filter: MetricsFilter): Promise<CountResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `SELECT COUNT(*)::int AS total
     ${SCOPED_SESSIONS_JOIN}
     WHERE ${scopeByStartWhere()}`,
    scopeParams(bounds, filter)
  );
  return { count: res.rows[0]?.total ?? 0, parcial: bounds.parcial };
}

// --- Helper compartilhado: 1ª resposta humana (ver convenção no topo) --

async function computeFirstResponseStats(filter: MetricsFilter): Promise<MedianP90Result> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.customer_id
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     first_response AS (
       SELECT sc.id,
              EXTRACT(EPOCH FROM (MIN(m.created_at) - sc.created_at)) AS seconds
       FROM scoped sc
       JOIN public.chat_messages m
         ON m.session_id = sc.id
        AND m.type <> 'system'
        AND m.sender_id IS NOT NULL
        AND m.sender_id IS DISTINCT FROM sc.customer_id
        AND m.text IS NOT NULL AND m.text <> ''
       GROUP BY sc.id, sc.created_at
     )
     SELECT
       percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) AS median_seconds,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds) AS p90_seconds,
       COUNT(*)::int AS sample_size
     FROM first_response
     WHERE seconds >= 0`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  return {
    medianSeconds: row?.median_seconds !== null && row?.median_seconds !== undefined ? Number(row.median_seconds) : null,
    p90Seconds: row?.p90_seconds !== null && row?.p90_seconds !== undefined ? Number(row.p90_seconds) : null,
    sampleSize: row?.sample_size ?? 0,
    parcial: bounds.parcial
  };
}

// --- 2. tempoPrimeiraResposta ------------------------------------------

export async function getTempoPrimeiraResposta(filter: MetricsFilter): Promise<MedianP90Result> {
  return computeFirstResponseStats(filter);
}

// --- 3. pctRespondidoAte2min --------------------------------------------

export async function getPctRespondidoAte2min(filter: MetricsFilter): Promise<PercentageResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.customer_id
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     first_response AS (
       SELECT sc.id,
              EXTRACT(EPOCH FROM (MIN(m.created_at) - sc.created_at)) AS seconds
       FROM scoped sc
       JOIN public.chat_messages m
         ON m.session_id = sc.id
        AND m.type <> 'system'
        AND m.sender_id IS NOT NULL
        AND m.sender_id IS DISTINCT FROM sc.customer_id
        AND m.text IS NOT NULL AND m.text <> ''
       GROUP BY sc.id, sc.created_at
     )
     SELECT
       (SELECT COUNT(*) FROM scoped)::int AS denominator,
       COUNT(*) FILTER (WHERE fr.seconds >= 0 AND fr.seconds <= 120)::int AS numerator
     FROM first_response fr`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  const denominator = row?.denominator ?? 0;
  const numerator = row?.numerator ?? 0;
  return {
    numerator,
    denominator,
    percentage: denominator > 0 ? (numerator / denominator) * 100 : null,
    parcial: bounds.parcial
  };
}

// --- 4. duracaoChat -------------------------------------------------------
// Só considera chats FECHADOS (com chat_histories) — chat aberto não tem
// duração final ainda.

export async function getDuracaoChat(filter: MetricsFilter): Promise<MedianMinutesResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `SELECT
       percentile_cont(0.5) WITHIN GROUP (ORDER BY h.duration_seconds) / 60.0 AS median_minutes,
       COUNT(*)::int AS sample_size
     ${SCOPED_SESSIONS_JOIN}
     ${LATEST_HISTORY_JOIN}
     WHERE ${scopeByStartWhere()}
       AND h.duration_seconds IS NOT NULL`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  return {
    medianMinutes: row?.median_minutes !== null && row?.median_minutes !== undefined ? Number(row.median_minutes) : null,
    sampleSize: row?.sample_size ?? 0,
    parcial: bounds.parcial
  };
}

// --- 5. msgsPorChat ---------------------------------------------------

export async function getMsgsPorChat(filter: MetricsFilter): Promise<AverageResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     counts AS (
       SELECT sc.id, COUNT(m.id) AS msg_count
       FROM scoped sc
       LEFT JOIN public.chat_messages m ON m.session_id = sc.id
       GROUP BY sc.id
     )
     SELECT AVG(msg_count) AS average, COUNT(*)::int AS sample_size FROM counts`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  return {
    average: row?.average !== null && row?.average !== undefined ? Number(row.average) : null,
    sampleSize: row?.sample_size ?? 0,
    parcial: bounds.parcial
  };
}

// --- 6. tempoEmEspera ---------------------------------------------------
// Aproximação por decisão explícita: sem timestamp de transição de status
// salvo em nenhum lugar hoje, usamos o mesmo cálculo de tempoPrimeiraResposta
// (ver nota no topo do arquivo). Fica em função própria — não um alias —
// pra dar pra trocar a implementação sozinha no dia em que existir uma
// fonte de dado real, sem mexer em quem chama tempoPrimeiraResposta.

export async function getTempoEmEspera(filter: MetricsFilter): Promise<MedianP90Result> {
  return computeFirstResponseStats(filter);
}

// --- 7. taxaAbandono ----------------------------------------------------
// % de chats FECHADOS sem nenhuma resposta humana de analista. Base é
// chat_sessions (status='closed'), não chat_histories — um chat fechado por
// um caminho que não gravou histórico (ex.: "Fechar como Spam") ainda
// precisa contar aqui.

export async function getTaxaAbandono(filter: MetricsFilter): Promise<PercentageResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.customer_id
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()} AND s.status = 'closed'
     )
     SELECT
       COUNT(*)::int AS denominator,
       COUNT(*) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM public.chat_messages m
           WHERE m.session_id = sc.id
             AND m.type <> 'system'
             AND m.sender_id IS NOT NULL
             AND m.sender_id IS DISTINCT FROM sc.customer_id
             AND m.text IS NOT NULL AND m.text <> ''
         )
       )::int AS numerator
     FROM scoped sc`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  const denominator = row?.denominator ?? 0;
  const numerator = row?.numerator ?? 0;
  return {
    numerator,
    denominator,
    percentage: denominator > 0 ? (numerator / denominator) * 100 : null,
    parcial: bounds.parcial
  };
}

// --- 8. satisfacao --------------------------------------------------------
// positiveRate = positivos / avaliados. responseRate = avaliados / fechados
// no período — fica parcial:true também quando o fim do período ainda está
// dentro da janela de resposta da pesquisa (config_survey_settings), já que
// esses ainda podem receber resposta depois.

export async function getSatisfacao(filter: MetricsFilter): Promise<SatisfactionResult> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `SELECT
       COUNT(*)::int AS total_closed,
       COUNT(*) FILTER (WHERE h.rating IS NOT NULL)::int AS evaluated,
       COUNT(*) FILTER (WHERE h.rating = 1)::int AS positive
     ${SCOPED_SESSIONS_JOIN}
     ${LATEST_HISTORY_JOIN}
     WHERE ${scopeByStartWhere()} AND s.status = 'closed'`,
    scopeParams(bounds, filter)
  );
  const row = res.rows[0];
  const totalClosed = row?.total_closed ?? 0;
  const evaluated = row?.evaluated ?? 0;
  const positive = row?.positive ?? 0;
  return {
    totalClosed,
    evaluated,
    positiveRate: evaluated > 0 ? (positive / evaluated) * 100 : null,
    responseRate: totalClosed > 0 ? (evaluated / totalClosed) * 100 : null,
    parcial: bounds.parcial
  };
}

// --- Escopo por SOBREPOSIÇÃO (usado só por cargaSimultanea/picoIndividual) --
// Diferente de scopeByStartWhere: aqui precisamos de chats que estavam
// ATIVOS em algum momento do período, não só dos que começaram nele — um
// chat aberto antes do início do período e ainda em andamento também pesa
// na carga simultânea.

function scopeByOverlapWhere(): string {
  return `
    s.created_at < $2 AND COALESCE(h.finished_at, NOW()) > $1
    AND ($3::text IS NULL OR s.queue_id = $3)
    AND ($4::text IS NULL OR q.whatsapp_instance_id = $4)
    AND ($5::uuid IS NULL OR cust.company_id = $5)
    AND ($6::uuid IS NULL OR s.assignee_id = $6)
  `;
}

// --- 9. cargaSimultanea --------------------------------------------------
// Sweep-line (soma corrida de +1 abertura / -1 fechamento) reamostrada por
// hora, em vez de generate_series × overlap (que seria O(buckets × chats))
// — ver plano da Etapa 2 pra essa e pra picoIndividual, são as 2 mais
// pesadas junto com analistasOnline. Testar EXPLAIN ANALYZE contra o volume
// atual antes de considerar fechada; se passar de ~1s, parar e discutir
// rollup diário antes de seguir.

// "Carga por horário" (Dashboard Gerencial) é um PERFIL por hora do dia
// (0h-23h, sempre 24 pontos), não uma série contínua no tempo — período
// "mês" gerava ~720 buckets (1 por hora real do intervalo inteiro), eixo
// ilegível e sem sentido pra identificar horário de pico. Reamostra por
// hora real (per_hour, como antes) e agrega pela MÉDIA de todas as
// ocorrências daquela hora-do-dia (America/Sao_Paulo) dentro do período.
export async function getCargaSimultanea(filter: MetricsFilter): Promise<HourlyBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, COALESCE(h.finished_at, NOW()) AS ended_at
       ${SCOPED_SESSIONS_JOIN}
       ${LATEST_HISTORY_JOIN}
       WHERE ${scopeByOverlapWhere()}
     ),
     events AS (
       SELECT created_at AS ts, 1 AS delta FROM scoped
       UNION ALL
       SELECT ended_at AS ts, -1 AS delta FROM scoped
     ),
     running AS (
       SELECT ts,
              SUM(delta) OVER (ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM events
     ),
     buckets AS (
       SELECT generate_series($1::timestamptz, $2::timestamptz, interval '1 hour') AS bucket_start
     ),
     per_hour AS (
       SELECT
         EXTRACT(HOUR FROM (b.bucket_start AT TIME ZONE 'America/Sao_Paulo'))::int AS hour_of_day,
         COALESCE(
           (SELECT r.concurrent FROM running r WHERE r.ts <= b.bucket_start ORDER BY r.ts DESC LIMIT 1),
           0
         )::int AS concurrent_chats
       FROM buckets b
     )
     SELECT
       hour_of_day,
       (TIMESTAMP '2000-01-01 00:00:00' + (hour_of_day || ' hours')::interval) AT TIME ZONE 'America/Sao_Paulo' AS bucket_start,
       AVG(concurrent_chats) AS concurrent_chats
     FROM per_hour
     GROUP BY hour_of_day
     ORDER BY hour_of_day`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({ bucketStart: r.bucket_start, count: Number(r.concurrent_chats), hourOfDay: r.hour_of_day }));
}

// --- 10. analistasOnline --------------------------------------------------
// A partir de user_status_history — não há coluna "duration" confiável
// (nunca é preenchida no INSERT, ver app/api/chats/route.ts ação
// log-status-change), então reconstruímos o intervalo de cada status via
// LEAD() (linha N vale do seu timestamp até o timestamp da próxima linha do
// mesmo usuário, ou até agora se for a última). Filtro por analista/fila é
// aplicado ANTES do LEAD (filtro por partição inteira, não corta o meio de
// uma sequência — seguro). instanceId/companyId não se aplicam a "quem
// estava online" e são ignorados de propósito nesta métrica.

// Mesma mudança de perfil-por-hora-do-dia de getCargaSimultanea acima —
// as duas alimentam o mesmo gráfico e precisam usar exatamente a mesma
// hora-do-dia como eixo, senão as séries desalinham.
export async function getAnalistasOnline(filter: MetricsFilter): Promise<HourlyBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH status_intervals AS (
       SELECT user_id, status, timestamp AS started_at,
              COALESCE(LEAD(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp), NOW()) AS ended_at
       FROM public.user_status_history
       WHERE ($3::uuid IS NULL OR user_id = $3)
         AND ($4::text IS NULL OR user_id = ANY(SELECT unnest(member_ids) FROM public.queues WHERE id = $4))
     ),
     online AS (
       SELECT user_id, started_at, ended_at
       FROM status_intervals
       WHERE status = 'online' AND started_at < $2 AND ended_at > $1
     ),
     buckets AS (
       SELECT generate_series($1::timestamptz, $2::timestamptz, interval '1 hour') AS bucket_start
     ),
     per_hour AS (
       SELECT
         EXTRACT(HOUR FROM (b.bucket_start AT TIME ZONE 'America/Sao_Paulo'))::int AS hour_of_day,
         COUNT(DISTINCT o.user_id)::int AS analysts_online
       FROM buckets b
       LEFT JOIN online o
         ON o.started_at < b.bucket_start + interval '1 hour' AND o.ended_at > b.bucket_start
       GROUP BY b.bucket_start
     )
     SELECT
       hour_of_day,
       (TIMESTAMP '2000-01-01 00:00:00' + (hour_of_day || ' hours')::interval) AT TIME ZONE 'America/Sao_Paulo' AS bucket_start,
       AVG(analysts_online) AS analysts_online
     FROM per_hour
     GROUP BY hour_of_day
     ORDER BY hour_of_day`,
    [bounds.startUtc, bounds.endUtcExclusive, filter.analystId ?? null, filter.queueId ?? null]
  );
  return res.rows.map(r => ({ bucketStart: r.bucket_start, count: Number(r.analysts_online), hourOfDay: r.hour_of_day }));
}

// --- 11. picoIndividual ----------------------------------------------------
// Mesmo sweep-line de cargaSimultanea, particionado por assignee_id.

export async function getPicoIndividual(filter: MetricsFilter): Promise<AnalystPeak[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.assignee_id, s.created_at, COALESCE(h.finished_at, NOW()) AS ended_at
       ${SCOPED_SESSIONS_JOIN}
       ${LATEST_HISTORY_JOIN}
       WHERE s.assignee_id IS NOT NULL AND ${scopeByOverlapWhere()}
     ),
     events AS (
       SELECT assignee_id, created_at AS ts, 1 AS delta FROM scoped
       UNION ALL
       SELECT assignee_id, ended_at AS ts, -1 AS delta FROM scoped
     ),
     running AS (
       SELECT assignee_id, ts,
              SUM(delta) OVER (PARTITION BY assignee_id ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM events
     )
     SELECT r.assignee_id, p.name AS analyst_name, MAX(r.concurrent)::int AS peak_concurrent
     FROM running r
     JOIN public.profiles p ON p.id = r.assignee_id
     GROUP BY r.assignee_id, p.name
     ORDER BY peak_concurrent DESC`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({ analystId: r.assignee_id, analystName: r.analyst_name, peakConcurrent: r.peak_concurrent }));
}

// --- 12. chatsEmEsperaAgora (snapshot ao vivo) -----------------------------
// Etapa 3 do roadmap — usada pelo KPI "chats em espera agora" e pelo alerta
// correspondente. Foge do padrão MetricsFilter/período de propósito: é
// "agora", não um agregado histórico. Só aceita fila/instância —
// companyId/analystId não fazem sentido pra essa pergunta e a tela
// gerencial não os expõe no filtro.

export async function getChatsEmEsperaAgora(scope: { queueId?: string; instanceId?: string } = {}): Promise<number> {
  const res = await query(
    `SELECT COUNT(*)::int AS total
     FROM public.chat_sessions s
     LEFT JOIN public.queues q ON q.id = s.queue_id
     WHERE s.status = 'waiting'
       AND ($1::text IS NULL OR s.queue_id = $1)
       AND ($2::text IS NULL OR q.whatsapp_instance_id = $2)`,
    [scope.queueId ?? null, scope.instanceId ?? null]
  );
  return res.rows[0]?.total ?? 0;
}

// --- 13. cargaAtualPorAnalista (snapshot ao vivo) --------------------------
// Etapa 3 — usada pelo alerta "analista acima do pico configurado" (o
// chamador compara activeChats contra config_metric_thresholds
// .individual_peak_warning). Não confundir com picoIndividual (11): aquela
// é o MÁXIMO histórico num período; esta é a carga ATUAL, agora mesmo.

export async function getCargaAtualPorAnalista(scope: { queueId?: string; instanceId?: string } = {}): Promise<AnalystLoadNow[]> {
  const res = await query(
    `SELECT s.assignee_id, p.name AS analyst_name, COUNT(*)::int AS active_chats
     FROM public.chat_sessions s
     LEFT JOIN public.queues q ON q.id = s.queue_id
     JOIN public.profiles p ON p.id = s.assignee_id
     WHERE s.status <> 'closed' AND s.assignee_id IS NOT NULL
       AND ($1::text IS NULL OR s.queue_id = $1)
       AND ($2::text IS NULL OR q.whatsapp_instance_id = $2)
     GROUP BY s.assignee_id, p.name
     ORDER BY active_chats DESC`,
    [scope.queueId ?? null, scope.instanceId ?? null]
  );
  return res.rows.map(r => ({ analystId: r.assignee_id, analystName: r.analyst_name, activeChats: r.active_chats }));
}

// --- 14. volumePorDia --------------------------------------------------
// Relatório "Atendimento — visão geral" (R1). Um balde por dia de
// calendário (America/Sao_Paulo) dentro do período — sem teto de dias:
// mesmo período longo/custom não corta o eixo, decisão explícita do plano
// do R1 (recharts já aguenta dezenas/centenas de pontos em outras telas).

export async function getVolumePorDia(filter: MetricsFilter): Promise<HourlyBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `SELECT
       (date_trunc('day', s.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS bucket_start,
       COUNT(*)::int AS total
     ${SCOPED_SESSIONS_JOIN}
     WHERE ${scopeByStartWhere()}
     GROUP BY 1
     ORDER BY 1`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({ bucketStart: r.bucket_start, count: r.total }));
}

// --- 15. volumePorHoraDoDia ----------------------------------------------
// Distribuição por hora do dia (0-23, America/Sao_Paulo) somando todos os
// dias do período — "em que hora do dia a operação recebe mais volume",
// não uma série temporal. generate_series garante que hora sem chat nenhum
// apareça como 0 em vez de sumir do gráfico.

export async function getVolumePorHoraDoDia(filter: MetricsFilter): Promise<HourOfDayBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     hours AS (SELECT generate_series(0, 23) AS hour)
     SELECT h.hour, COUNT(sc.id)::int AS total
     FROM hours h
     LEFT JOIN scoped sc ON sc.hour = h.hour
     GROUP BY h.hour
     ORDER BY h.hour`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({ hour: r.hour, count: r.total }));
}

// --- 16. volumePorDiaDaSemana --------------------------------------------
// Distribuição por dia da semana (0=domingo..6=sábado, EXTRACT(DOW) — mesma
// convenção de getUTCDay() já usada em app/api/dashboard/management/route.ts,
// não misturo com numeração "segunda-first" pra não ter duas convenções de
// dia-da-semana coexistindo no projeto).

export async function getVolumePorDiaDaSemana(filter: MetricsFilter): Promise<WeekdayBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, EXTRACT(DOW FROM s.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS weekday
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     days AS (SELECT generate_series(0, 6) AS weekday)
     SELECT d.weekday, COUNT(sc.id)::int AS total
     FROM days d
     LEFT JOIN scoped sc ON sc.weekday = d.weekday
     GROUP BY d.weekday
     ORDER BY d.weekday`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({ weekday: r.weekday, count: r.total }));
}

// --- 17. resumoPorDimensao ------------------------------------------------
// "Quebra por" do R1 (fila/instância/canal/empresa) — as 7 métricas do
// relatório numa query só por dimensão (GROUP BY), não N queries por
// segmento. dimension vem tipado (união fechada) e mapeado aqui pra uma
// coluna SQL fixa de uma whitelist — nunca interpolamos a string recebida
// da rota diretamente, mesmo sendo um valor interno, por segurança.
//
// canal = CASE WHEN queue_id IS NOT NULL THEN 'whatsapp' ELSE 'widget' END —
// confirmado em lib/services/queue-routing.ts (resolveCombinedQueuePool):
// conversas do widget logado sempre entram com queue_id NULL, de propósito
// ("não chegam por nenhum número de WhatsApp"); toda conversa de WhatsApp
// resolve uma fila real via resolveQueueForInstance.
//
// ⚠️ Candidata a query mais pesada do R1 — GROUP BY com percentile_cont por
// grupo sobre CTEs de chat_messages/chat_histories. Testar EXPLAIN ANALYZE
// contra o volume atual; se passar de ~1s, parar e discutir rollup antes de
// seguir (mesmo compromisso da Etapa 2).

const DIMENSION_COLUMNS: Record<ReportDimension, string> = {
  queue: 'sc.queue_id',
  instance: 'sc.whatsapp_instance_id',
  channel: 'sc.channel',
  company: 'sc.company_id',
  analyst: 'sc.assignee_id'
};

export async function getResumoPorDimensao(filter: MetricsFilter, dimension: ReportDimension): Promise<DimensionBreakdownRow[]> {
  const dimCol = DIMENSION_COLUMNS[dimension];
  if (!dimCol) throw new Error(`Dimensão inválida: ${dimension}`);
  const bounds = await getPeriodBounds(filter);

  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.customer_id, s.status, s.queue_id, s.assignee_id,
              q.whatsapp_instance_id,
              cust.company_id,
              CASE WHEN s.queue_id IS NOT NULL THEN 'whatsapp' ELSE 'widget' END AS channel
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()}
     ),
     first_response AS (
       SELECT sc.id, EXTRACT(EPOCH FROM (MIN(m.created_at) - sc.created_at)) AS seconds
       FROM scoped sc
       JOIN public.chat_messages m
         ON m.session_id = sc.id
        AND m.type <> 'system'
        AND m.sender_id IS NOT NULL
        AND m.sender_id IS DISTINCT FROM sc.customer_id
        AND m.text IS NOT NULL AND m.text <> ''
       GROUP BY sc.id, sc.created_at
     ),
     msg_counts AS (
       SELECT sc.id, COUNT(m.id) AS msg_count
       FROM scoped sc
       LEFT JOIN public.chat_messages m ON m.session_id = sc.id
       GROUP BY sc.id
     ),
     closed AS (
       SELECT sc.id, h.duration_seconds,
         NOT EXISTS (
           SELECT 1 FROM public.chat_messages m
           WHERE m.session_id = sc.id
             AND m.type <> 'system'
             AND m.sender_id IS NOT NULL
             AND m.sender_id IS DISTINCT FROM sc.customer_id
             AND m.text IS NOT NULL AND m.text <> ''
         ) AS abandoned
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT duration_seconds FROM public.chat_histories
         WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
       WHERE sc.status = 'closed'
     )
     SELECT
       ${dimCol} AS segment_key,
       COUNT(sc.id)::int AS volume,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.seconds) AS first_response_median_seconds,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY fr.seconds) AS first_response_p90_seconds,
       (COUNT(*) FILTER (WHERE fr.seconds >= 0 AND fr.seconds <= 120))::float / NULLIF(COUNT(sc.id), 0) * 100 AS pct_2min,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY cl.duration_seconds) / 60.0 AS duration_median_minutes,
       AVG(mc.msg_count) AS msgs_por_chat,
       (COUNT(*) FILTER (WHERE cl.abandoned))::float / NULLIF(COUNT(cl.id), 0) * 100 AS abandono_percentage
     FROM scoped sc
     LEFT JOIN first_response fr ON fr.id = sc.id
     LEFT JOIN msg_counts mc ON mc.id = sc.id
     LEFT JOIN closed cl ON cl.id = sc.id
     GROUP BY ${dimCol}
     ORDER BY volume DESC`,
    scopeParams(bounds, filter)
  );

  const rows: DimensionBreakdownRow[] = res.rows.map(r => ({
    segmentId: r.segment_key,
    segmentLabel: r.segment_key ?? '', // resolvido (nome real) pelo chamador — ver resolveSegmentLabels
    volume: r.volume,
    firstResponseMedianSeconds: r.first_response_median_seconds !== null ? Number(r.first_response_median_seconds) : null,
    firstResponseP90Seconds: r.first_response_p90_seconds !== null ? Number(r.first_response_p90_seconds) : null,
    pct2min: r.pct_2min !== null ? Number(r.pct_2min) : null,
    durationMedianMinutes: r.duration_median_minutes !== null ? Number(r.duration_median_minutes) : null,
    msgsPorChat: r.msgs_por_chat !== null ? Number(r.msgs_por_chat) : null,
    abandonoPercentage: r.abandono_percentage !== null ? Number(r.abandono_percentage) : null
  }));

  return resolveSegmentLabels(dimension, rows);
}

// Nomes reais (fila/instância/empresa/analista) vivem em tabelas diferentes
// por dimensão — resolvidos aqui, fora da query pesada acima, com uma
// consulta pequena e só pros ids que realmente apareceram no resultado.
// Genérica em T pra ser reaproveitada por qualquer resumo-por-dimensão
// (R1 e a versão de satisfação do R4), não só DimensionBreakdownRow.
async function resolveSegmentLabels<T extends { segmentId: string | null; segmentLabel: string }>(dimension: ReportDimension, rows: T[]): Promise<T[]> {
  if (dimension === 'channel') {
    const labels: Record<string, string> = { whatsapp: 'WhatsApp', widget: 'Widget (portal)' };
    return rows.map(r => ({ ...r, segmentLabel: r.segmentId ? (labels[r.segmentId] ?? r.segmentId) : 'Sem canal' }));
  }

  const emptyLabels: Record<Exclude<ReportDimension, 'channel'>, string> = {
    queue: 'Sem fila (widget)',
    instance: 'Sem instância',
    company: 'Sem empresa',
    analyst: 'Sem analista'
  };

  const ids = rows.map(r => r.segmentId).filter((id): id is string => !!id);
  if (ids.length === 0) {
    return rows.map(r => ({ ...r, segmentLabel: emptyLabels[dimension] }));
  }

  // queues.id/whatsapp_instances.id são TEXT; companies.id/profiles.id são
  // UUID — cast explícito por tabela (ANY($1) sem cast não infere o tipo
  // certo pra uuid).
  const tableByDimension: Record<Exclude<ReportDimension, 'channel'>, string> = {
    queue: 'queues',
    instance: 'whatsapp_instances',
    company: 'companies',
    analyst: 'profiles'
  };
  const table = tableByDimension[dimension];
  const castType = dimension === 'company' || dimension === 'analyst' ? 'uuid' : 'text';
  const res = await query(`SELECT id, name FROM public.${table} WHERE id = ANY($1::${castType}[])`, [ids]);
  const nameById = new Map(res.rows.map((r: any) => [r.id, r.name]));

  const emptyLabel = emptyLabels[dimension];
  return rows.map(r => ({ ...r, segmentLabel: r.segmentId ? (nameById.get(r.segmentId) ?? r.segmentId) : emptyLabel }));
}

// ============================================================================
// Relatório "Desempenho por Analista" (R2) — 1 linha por analista, nunca um
// ranking do 1º ao último (a rota compara cada linha contra a MEDIANA do
// time, não posição). anonimização por reports:individual é decidida na
// rota, não aqui: estas funções sempre devolvem o dado real, nominal.
// ============================================================================

// --- getDesempenhoPorAnalista ---------------------------------------------
// chatsAtendidos/1ª resposta/duração/satisfação — mesma técnica de CTEs do
// getResumoPorDimensao, agrupado por assignee_id. msgsEnviadas conta só
// mensagens cujo sender_id é o PRÓPRIO analista (msgsPorChat do R1 conta
// todas as mensagens do chat, incluindo as do cliente — métrica diferente).

export async function getDesempenhoPorAnalista(filter: MetricsFilter): Promise<AnalystPerformanceRow[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.assignee_id, s.created_at, s.customer_id
       ${SCOPED_SESSIONS_JOIN}
       WHERE s.assignee_id IS NOT NULL AND ${scopeByStartWhere()}
     ),
     first_response AS (
       SELECT sc.id, EXTRACT(EPOCH FROM (MIN(m.created_at) - sc.created_at)) AS seconds
       FROM scoped sc
       JOIN public.chat_messages m
         ON m.session_id = sc.id
        AND m.type <> 'system'
        AND m.sender_id IS NOT NULL
        AND m.sender_id IS DISTINCT FROM sc.customer_id
        AND m.text IS NOT NULL AND m.text <> ''
       GROUP BY sc.id, sc.created_at
     ),
     msgs_sent AS (
       SELECT sc.id, COUNT(m.id) AS sent_count
       FROM scoped sc
       LEFT JOIN public.chat_messages m ON m.session_id = sc.id AND m.sender_id = sc.assignee_id
       GROUP BY sc.id
     ),
     closed AS (
       SELECT sc.id, h.duration_seconds, h.rating
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT duration_seconds, rating FROM public.chat_histories
         WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
     )
     SELECT
       sc.assignee_id,
       p.name AS analyst_name,
       COUNT(DISTINCT sc.id)::int AS chats_atendidos,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.seconds) AS first_response_median_seconds,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY cl.duration_seconds) / 60.0 AS duration_median_minutes,
       AVG(ms.sent_count) AS msgs_enviadas,
       (COUNT(*) FILTER (WHERE cl.rating = 1))::float / NULLIF(COUNT(*) FILTER (WHERE cl.rating IS NOT NULL), 0) * 100 AS satisfaction_positive_rate
     FROM scoped sc
     JOIN public.profiles p ON p.id = sc.assignee_id
     LEFT JOIN first_response fr ON fr.id = sc.id
     LEFT JOIN msgs_sent ms ON ms.id = sc.id
     LEFT JOIN closed cl ON cl.id = sc.id
     GROUP BY sc.assignee_id, p.name
     ORDER BY chats_atendidos DESC`,
    scopeParams(bounds, filter)
  );

  return res.rows.map(r => ({
    analystId: r.assignee_id,
    analystName: r.analyst_name,
    isSelf: false, // decidido pela rota
    amostraInsuficiente: r.chats_atendidos < MIN_ANALYST_SAMPLE,
    chatsAtendidos: r.chats_atendidos,
    firstResponseMedianSeconds: r.first_response_median_seconds !== null ? Number(r.first_response_median_seconds) : null,
    durationMedianMinutes: r.duration_median_minutes !== null ? Number(r.duration_median_minutes) : null,
    msgsEnviadas: r.msgs_enviadas !== null ? Number(r.msgs_enviadas) : null,
    satisfactionPositiveRate: r.satisfaction_positive_rate !== null ? Number(r.satisfaction_positive_rate) : null,
    // preenchidos por quem chama, a partir de getSimultaneidadePorAnalista/getHorasOnlinePorAnalista
    simultaneidadeMedia: null,
    simultaneidadePico: null,
    horasOnline: null,
    chatsPorHoraOnline: null
  }));
}

// --- getSimultaneidadePorAnalista ------------------------------------------
// Mesmo sweep-line de picoIndividual (11), mas além do pico calcula a média
// PONDERADA PELO TEMPO de cada trecho de concorrência (não pela contagem de
// eventos — um trecho de carga alta e curto não pode pesar igual a um trecho
// longo e vazio). LEAD() aqui usa ORDER BY ts simples (sem o tie-break por
// delta do sweep-line principal) — só importa em empates no mesmíssimo
// timestamp, caso residual que não afeta o resultado de forma perceptível.

export async function getSimultaneidadePorAnalista(filter: MetricsFilter): Promise<Map<string, { media: number | null; pico: number }>> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.assignee_id, s.created_at, COALESCE(h.finished_at, NOW()) AS ended_at
       ${SCOPED_SESSIONS_JOIN}
       ${LATEST_HISTORY_JOIN}
       WHERE s.assignee_id IS NOT NULL AND ${scopeByOverlapWhere()}
     ),
     events AS (
       SELECT assignee_id, created_at AS ts, 1 AS delta FROM scoped
       UNION ALL
       SELECT assignee_id, ended_at AS ts, -1 AS delta FROM scoped
     ),
     running AS (
       SELECT assignee_id, ts,
              SUM(delta) OVER (PARTITION BY assignee_id ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM events
     ),
     weighted AS (
       SELECT assignee_id, concurrent,
         GREATEST(EXTRACT(EPOCH FROM (
           LEAST(COALESCE(LEAD(ts) OVER (PARTITION BY assignee_id ORDER BY ts), $2::timestamptz), $2::timestamptz)
           - GREATEST(ts, $1::timestamptz)
         )), 0) AS duration_seconds
       FROM running
     )
     SELECT assignee_id,
       MAX(concurrent)::int AS peak_concurrent,
       SUM(concurrent * duration_seconds) / NULLIF(SUM(duration_seconds), 0) AS avg_concurrent
     FROM weighted
     GROUP BY assignee_id`,
    scopeParams(bounds, filter)
  );

  const map = new Map<string, { media: number | null; pico: number }>();
  for (const r of res.rows) {
    map.set(r.assignee_id, {
      media: r.avg_concurrent !== null ? Number(r.avg_concurrent) : null,
      pico: r.peak_concurrent
    });
  }
  return map;
}

// --- getHorasOnlinePorAnalista ---------------------------------------------
// Mesma reconstrução de intervalo via LEAD() de getAnalistasOnline (10), mas
// somando horas por usuário em vez de contar usuários por hora-bucket — base
// do indicador principal do relatório (chatsPorHoraOnline = chatsAtendidos /
// horasOnline, calculado pela rota depois de juntar os dois resultados).

export async function getHorasOnlinePorAnalista(filter: MetricsFilter): Promise<Map<string, number>> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH status_intervals AS (
       SELECT user_id, status, timestamp AS started_at,
              COALESCE(LEAD(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp), NOW()) AS ended_at
       FROM public.user_status_history
       WHERE ($3::uuid IS NULL OR user_id = $3)
         AND ($4::text IS NULL OR user_id = ANY(SELECT unnest(member_ids) FROM public.queues WHERE id = $4))
     ),
     online AS (
       SELECT user_id,
         GREATEST(started_at, $1::timestamptz) AS clipped_start,
         LEAST(ended_at, $2::timestamptz) AS clipped_end
       FROM status_intervals
       WHERE status = 'online' AND started_at < $2 AND ended_at > $1
     )
     SELECT user_id, SUM(EXTRACT(EPOCH FROM (clipped_end - clipped_start))) / 3600.0 AS hours
     FROM online
     GROUP BY user_id`,
    [bounds.startUtc, bounds.endUtcExclusive, filter.analystId ?? null, filter.queueId ?? null]
  );

  const map = new Map<string, number>();
  for (const r of res.rows) map.set(r.user_id, Number(r.hours));
  return map;
}

// --- getTempoAusentePorMotivo ----------------------------------------------
// Mesma técnica acima, status='away', agrupado também por reason (texto
// livre — user_status_history não tem FK pra absence_reasons, quem grava é a
// UI escolhendo um label da lista; agrupar pelo texto direto é suficiente).

export async function getTempoAusentePorMotivo(filter: MetricsFilter): Promise<AnalystAbsenceBreakdown[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH status_intervals AS (
       SELECT user_id, status, reason, timestamp AS started_at,
              COALESCE(LEAD(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp), NOW()) AS ended_at
       FROM public.user_status_history
       WHERE ($3::uuid IS NULL OR user_id = $3)
         AND ($4::text IS NULL OR user_id = ANY(SELECT unnest(member_ids) FROM public.queues WHERE id = $4))
     ),
     away AS (
       SELECT user_id, COALESCE(reason, 'Sem motivo registrado') AS reason,
         GREATEST(started_at, $1::timestamptz) AS clipped_start,
         LEAST(ended_at, $2::timestamptz) AS clipped_end
       FROM status_intervals
       WHERE status = 'away' AND started_at < $2 AND ended_at > $1
     )
     SELECT away.user_id, p.name AS analyst_name, away.reason,
       SUM(EXTRACT(EPOCH FROM (away.clipped_end - away.clipped_start))) / 3600.0 AS hours
     FROM away
     LEFT JOIN public.profiles p ON p.id = away.user_id
     GROUP BY away.user_id, p.name, away.reason
     ORDER BY away.user_id, hours DESC`,
    [bounds.startUtc, bounds.endUtcExclusive, filter.analystId ?? null, filter.queueId ?? null]
  );

  return res.rows.map(r => ({ analystId: r.user_id, analystName: r.analyst_name ?? 'Removido', reason: r.reason, hours: Number(r.hours) }));
}

// --- getTeamMedians ---------------------------------------------------------
// Mediana do TIME sobre os valores JÁ AGREGADOS por analista (percentile_cont
// de uma lista de N números, um por analista) — nunca a mediana dos chats
// individuais. É contra isso que cada linha do relatório é comparada, nunca
// contra um ranking 1º-ao-último.

// ============================================================================
// Relatório "Carga e Capacidade" (R3) — 1 linha por hora-calendário do
// período, ao mesmo tempo fonte do resumo por hora-do-dia (rollup em JS na
// rota, a partir deste mesmo array — evita rodar esta query pesada duas
// vezes) e do drill-down "dados brutos" por faixa.
//
// Funde 3 técnicas já usadas em funções separadas (cargaSimultanea,
// analistasOnline, picoIndividual) numa query só, tagueando cada bucket com
// dia-calendário e hora-do-dia (America/Sao_Paulo).
//
// ⚠️ Testado em EXPLAIN ANALYZE contra o banco de teste (204 chats, 6
// analistas, período de 6 meses): a primeira versão resolvia "valor no
// instante do bucket" com uma subquery correlacionada (carga/pico) ou um
// LEFT JOIN por intervalo (online) — 890ms só no pico (loops=29814) e
// 257ms só no online (3.4M pares avaliados), 2.4s no total. Reescrito pra
// "carry-forward" via window function nas 3 métricas (mesma ideia: marca
// cada bucket como uma linha SEM valor na linha do tempo dos eventos reais,
// agrupa por "quantos eventos reais já passaram" — COUNT ignora NULL — e
// usa MAX() dentro do grupo pra herdar o último valor real) — sem subquery
// correlacionada, sem join por intervalo. Resultado no mesmo teste: ~90ms
// no total. Se mesmo assim passar de ~1s contra o volume de produção,
// parar e discutir rollup antes de seguir.
// ============================================================================

export async function getCargaCapacidadePorFaixaBruta(filter: MetricsFilter, criticalRatio: number): Promise<CapacityRawBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH buckets AS (
       SELECT generate_series($1::timestamptz, $2::timestamptz, interval '1 hour') AS bucket_start
     ),
     carga_scoped AS (
       SELECT s.id, s.created_at, COALESCE(h.finished_at, NOW()) AS ended_at
       ${SCOPED_SESSIONS_JOIN}
       ${LATEST_HISTORY_JOIN}
       WHERE ${scopeByOverlapWhere()}
     ),
     carga_events AS (
       SELECT created_at AS ts, 1 AS delta FROM carga_scoped
       UNION ALL
       SELECT ended_at AS ts, -1 AS delta FROM carga_scoped
     ),
     carga_running AS (
       SELECT ts, SUM(delta) OVER (ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM carga_events
     ),
     carga_combined AS (
       SELECT ts, concurrent, false AS is_marker FROM carga_running
       UNION ALL
       SELECT bucket_start, NULL::int, true FROM buckets
     ),
     carga_numbered AS (
       SELECT ts, concurrent, is_marker,
         COUNT(concurrent) OVER (ORDER BY ts, is_marker ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
       FROM carga_combined
     ),
     -- WHERE roda antes de window function — filtrar is_marker aqui já
     -- descartaria as linhas de evento real antes do MAX() OVER enxergá-las.
     -- Por isso o MAX() é calculado numa CTE separada (sobre todas as
     -- linhas) e só filtrado depois, na CTE seguinte.
     carga_filled AS (
       SELECT ts, is_marker, MAX(concurrent) OVER (PARTITION BY grp) AS concurrent_filled
       FROM carga_numbered
     ),
     carga_by_bucket AS (
       SELECT ts AS bucket_start, COALESCE(concurrent_filled, 0)::int AS carga
       FROM carga_filled
       WHERE is_marker
     ),
     status_intervals AS (
       SELECT user_id, status, timestamp AS started_at,
              COALESCE(LEAD(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp), NOW()) AS ended_at
       FROM public.user_status_history
       WHERE ($3::text IS NULL OR user_id = ANY(SELECT unnest(member_ids) FROM public.queues WHERE id = $3))
     ),
     online_intervals AS (
       SELECT user_id, started_at, ended_at FROM status_intervals
       WHERE status = 'online' AND started_at < $2 AND ended_at > $1
     ),
     -- Mesmo sweep-line de carga_events/carga_running, só que somando
     -- intervalos de "online" de todos os analistas em vez de sessões — cada
     -- analista só tem UM intervalo aberto por vez (reconstrução via LEAD já
     -- garante isso), então a soma corrida de +1/-1 sem partição equivale a
     -- contar quantos analistas distintos estão online em cada instante.
     online_events AS (
       SELECT started_at AS ts, 1 AS delta FROM online_intervals
       UNION ALL
       SELECT ended_at AS ts, -1 AS delta FROM online_intervals
     ),
     online_running AS (
       SELECT ts, SUM(delta) OVER (ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM online_events
     ),
     online_combined AS (
       SELECT ts, concurrent, false AS is_marker FROM online_running
       UNION ALL
       SELECT bucket_start, NULL::int, true FROM buckets
     ),
     online_numbered AS (
       SELECT ts, concurrent, is_marker,
         COUNT(concurrent) OVER (ORDER BY ts, is_marker ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
       FROM online_combined
     ),
     online_filled AS (
       SELECT ts, is_marker, MAX(concurrent) OVER (PARTITION BY grp) AS concurrent_filled
       FROM online_numbered
     ),
     online_by_bucket AS (
       SELECT ts AS bucket_start, COALESCE(concurrent_filled, 0)::int AS online
       FROM online_filled
       WHERE is_marker
     ),
     pico_scoped AS (
       SELECT s.id, s.assignee_id, s.created_at, COALESCE(h.finished_at, NOW()) AS ended_at
       ${SCOPED_SESSIONS_JOIN}
       ${LATEST_HISTORY_JOIN}
       WHERE s.assignee_id IS NOT NULL AND ${scopeByOverlapWhere()}
     ),
     pico_events AS (
       SELECT assignee_id, created_at AS ts, 1 AS delta FROM pico_scoped
       UNION ALL
       SELECT assignee_id, ended_at AS ts, -1 AS delta FROM pico_scoped
     ),
     pico_running AS (
       SELECT assignee_id, ts,
              SUM(delta) OVER (PARTITION BY assignee_id ORDER BY ts, delta DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS concurrent
       FROM pico_events
     ),
     -- "Carry-forward" do valor de concorrência de cada analista até cada
     -- bucket: marca cada bucket como uma linha SEM valor (NULL) na mesma
     -- linha do tempo dos eventos reais, agrupa por "quantos eventos reais já
     -- passaram" (COUNT ignora NULL) e usa MAX() dentro do grupo pra herdar o
     -- último valor real — sem LATERAL correlacionado, sem reprocessar a CTE
     -- de eventos por bucket.
     pico_combined AS (
       SELECT assignee_id, ts, concurrent, false AS is_marker FROM pico_running
       UNION ALL
       SELECT a.assignee_id, b.bucket_start, NULL::int, true
       FROM buckets b CROSS JOIN (SELECT DISTINCT assignee_id FROM pico_scoped) a
     ),
     pico_numbered AS (
       SELECT assignee_id, ts, concurrent, is_marker,
         COUNT(concurrent) OVER (PARTITION BY assignee_id ORDER BY ts, is_marker ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
       FROM pico_combined
     ),
     pico_filled AS (
       SELECT ts, is_marker,
         MAX(concurrent) OVER (PARTITION BY assignee_id, grp) AS concurrent_filled
       FROM pico_numbered
     ),
     pico_by_bucket AS (
       SELECT ts AS bucket_start, COALESCE(MAX(concurrent_filled), 0)::int AS pico
       FROM pico_filled
       WHERE is_marker
       GROUP BY ts
     )
     SELECT
       cb.bucket_start,
       (cb.bucket_start AT TIME ZONE 'America/Sao_Paulo')::date AS date_sp,
       EXTRACT(HOUR FROM cb.bucket_start AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
       cb.carga AS carga_simultanea,
       COALESCE(ob.online, 0) AS analistas_online,
       COALESCE(pb.pico, 0) AS pico_individual,
       CASE WHEN COALESCE(ob.online, 0) > 0 THEN cb.carga::numeric / ob.online ELSE NULL END AS carga_por_analista,
       (
         (COALESCE(ob.online, 0) > 0 AND cb.carga::numeric / ob.online >= $7)
         OR (COALESCE(ob.online, 0) = 0 AND cb.carga > 0)
       ) AS critico
     FROM carga_by_bucket cb
     LEFT JOIN online_by_bucket ob ON ob.bucket_start = cb.bucket_start
     LEFT JOIN pico_by_bucket pb ON pb.bucket_start = cb.bucket_start
     ORDER BY cb.bucket_start`,
    [...scopeParams(bounds, filter), criticalRatio]
  );

  return res.rows.map(r => ({
    bucketStart: r.bucket_start,
    dateSp: r.date_sp instanceof Date ? r.date_sp.toISOString().slice(0, 10) : String(r.date_sp),
    hour: r.hour,
    cargaSimultanea: r.carga_simultanea,
    analistasOnline: r.analistas_online,
    picoIndividual: r.pico_individual,
    cargaPorAnalista: r.carga_por_analista !== null ? Number(r.carga_por_analista) : null,
    critico: r.critico
  }));
}

export function computeTeamMedians(rows: AnalystPerformanceRow[]): TeamMedians {
  const median = (values: (number | null)[]): number | null => {
    const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  return {
    chatsAtendidos: median(rows.map(r => r.chatsAtendidos)),
    firstResponseMedianSeconds: median(rows.map(r => r.firstResponseMedianSeconds)),
    durationMedianMinutes: median(rows.map(r => r.durationMedianMinutes)),
    msgsEnviadas: median(rows.map(r => r.msgsEnviadas)),
    satisfactionPositiveRate: median(rows.map(r => r.satisfactionPositiveRate)),
    simultaneidadeMedia: median(rows.map(r => r.simultaneidadeMedia)),
    simultaneidadePico: median(rows.map(r => r.simultaneidadePico)),
    horasOnline: median(rows.map(r => r.horasOnline)),
    chatsPorHoraOnline: median(rows.map(r => r.chatsPorHoraOnline))
  };
}

// ============================================================================
// Relatório "Satisfação e Qualidade" (R4) — evolui app/api/reports/survey/
// route.ts, não substitui. chat_histories.rating é -1 (negativo) / 0
// (neutro) / 1 (positivo) — NUNCA convertido pra escala 1-5 de fonte
// externa (isso é decisão em aberto, fora deste relatório). "Avaliado"
// sempre = rating IS NOT NULL, sobre chats FECHADOS (só fechamento normal
// dispara a pesquisa).
// ============================================================================

// --- getSatisfacaoPorDia ----------------------------------------------------
// Mesmo bucket de dia-calendário de getVolumePorDia (14), agora medindo
// avaliação em vez de volume.

export async function getSatisfacaoPorDia(filter: MetricsFilter): Promise<SatisfactionTrendBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `SELECT
       (date_trunc('day', s.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS bucket_start,
       COUNT(*) FILTER (WHERE h.rating IS NOT NULL)::int AS evaluated,
       COUNT(*) FILTER (WHERE h.rating = 1)::int AS positive
     ${SCOPED_SESSIONS_JOIN}
     ${LATEST_HISTORY_JOIN}
     WHERE ${scopeByStartWhere()} AND s.status = 'closed'
     GROUP BY 1
     ORDER BY 1`,
    scopeParams(bounds, filter)
  );
  return res.rows.map(r => ({
    bucketStart: r.bucket_start,
    evaluated: r.evaluated,
    positive: r.positive,
    positiveRate: r.evaluated > 0 ? (r.positive / r.evaluated) * 100 : null
  }));
}

// --- getSatisfacaoPorDimensao -----------------------------------------------
// Mesma técnica de whitelist de coluna + resolveSegmentLabels do R1
// (getResumoPorDimensao) — aceita também 'analyst' (novo, ver
// DIMENSION_COLUMNS/resolveSegmentLabels acima). amostraInsuficiente reusa o
// mesmo N=10 do R2 (MIN_ANALYST_SAMPLE) pra não ter dois números de "amostra
// mínima" diferentes coexistindo no app.

export async function getSatisfacaoPorDimensao(filter: MetricsFilter, dimension: ReportDimension): Promise<SatisfactionDimensionRow[]> {
  const dimCol = DIMENSION_COLUMNS[dimension];
  if (!dimCol) throw new Error(`Dimensão inválida: ${dimension}`);
  const bounds = await getPeriodBounds(filter);

  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.queue_id, s.assignee_id, q.whatsapp_instance_id, cust.company_id,
              CASE WHEN s.queue_id IS NOT NULL THEN 'whatsapp' ELSE 'widget' END AS channel
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()} AND s.status = 'closed'
     )
     SELECT
       ${dimCol} AS segment_key,
       COUNT(*) FILTER (WHERE h.rating IS NOT NULL)::int AS evaluated,
       COUNT(*) FILTER (WHERE h.rating = 1)::int AS positive,
       COUNT(*) FILTER (WHERE h.rating = -1)::int AS negative,
       COUNT(*)::int AS total_closed
     FROM scoped sc
     LEFT JOIN LATERAL (
       SELECT rating FROM public.chat_histories WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
     ) h ON true
     GROUP BY ${dimCol}
     ORDER BY evaluated DESC`,
    scopeParams(bounds, filter)
  );

  const rows: SatisfactionDimensionRow[] = res.rows.map(r => ({
    segmentId: r.segment_key,
    segmentLabel: r.segment_key ?? '',
    evaluated: r.evaluated,
    positive: r.positive,
    negative: r.negative,
    positiveRate: r.evaluated > 0 ? (r.positive / r.evaluated) * 100 : null,
    responseRate: r.total_closed > 0 ? (r.evaluated / r.total_closed) * 100 : null,
    amostraInsuficiente: r.evaluated < MIN_ANALYST_SAMPLE
  }));

  return resolveSegmentLabels(dimension, rows);
}

// --- getSatisfacaoPorFaixaTempo ---------------------------------------------
// "A nota cai quando o tempo sobe?" — duas quebras 1D fixas (resposta e
// duração), não uma matriz cruzada 2D: com volume moderado, cruzar as duas
// fragmentaria demais a amostra por célula. Faixas fixas em CASE WHEN (não
// config): resposta usa o mesmo limiar de 2min já usado em
// pctRespondidoAte2min, pra manter consistência com o resto do arquivo.

const FIRST_RESPONSE_RANGE_SQL = `
  CASE
    WHEN fr.seconds IS NULL THEN NULL
    WHEN fr.seconds <= 120 THEN '1_ate_2min'
    WHEN fr.seconds <= 300 THEN '2_2a5min'
    WHEN fr.seconds <= 900 THEN '3_5a15min'
    ELSE '4_15min_mais'
  END
`;
const FIRST_RESPONSE_RANGE_LABELS: Record<string, string> = {
  '1_ate_2min': 'Até 2 min',
  '2_2a5min': '2 a 5 min',
  '3_5a15min': '5 a 15 min',
  '4_15min_mais': 'Mais de 15 min'
};

const DURATION_RANGE_SQL = `
  CASE
    WHEN cl.duration_seconds IS NULL THEN NULL
    WHEN cl.duration_seconds <= 300 THEN '1_ate_5min'
    WHEN cl.duration_seconds <= 900 THEN '2_5a15min'
    WHEN cl.duration_seconds <= 1800 THEN '3_15a30min'
    ELSE '4_30min_mais'
  END
`;
const DURATION_RANGE_LABELS: Record<string, string> = {
  '1_ate_5min': 'Até 5 min',
  '2_5a15min': '5 a 15 min',
  '3_15a30min': '15 a 30 min',
  '4_30min_mais': 'Mais de 30 min'
};

export async function getSatisfacaoPorFaixaTempo(filter: MetricsFilter): Promise<{ byFirstResponse: SatisfactionTimeRangeRow[]; byDuration: SatisfactionTimeRangeRow[] }> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.customer_id
       ${SCOPED_SESSIONS_JOIN}
       WHERE ${scopeByStartWhere()} AND s.status = 'closed'
     ),
     first_response AS (
       SELECT sc.id, EXTRACT(EPOCH FROM (MIN(m.created_at) - sc.created_at)) AS seconds
       FROM scoped sc
       JOIN public.chat_messages m
         ON m.session_id = sc.id
        AND m.type <> 'system'
        AND m.sender_id IS NOT NULL
        AND m.sender_id IS DISTINCT FROM sc.customer_id
        AND m.text IS NOT NULL AND m.text <> ''
       GROUP BY sc.id, sc.created_at
     ),
     closed AS (
       SELECT sc.id, h.rating, h.duration_seconds
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT rating, duration_seconds FROM public.chat_histories
         WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
     )
     SELECT 'first_response' AS kind, ${FIRST_RESPONSE_RANGE_SQL} AS range_key,
       COUNT(*) FILTER (WHERE cl.rating IS NOT NULL)::int AS evaluated,
       COUNT(*) FILTER (WHERE cl.rating = 1)::int AS positive
     FROM scoped sc
     LEFT JOIN first_response fr ON fr.id = sc.id
     LEFT JOIN closed cl ON cl.id = sc.id
     GROUP BY 2
     UNION ALL
     SELECT 'duration' AS kind, ${DURATION_RANGE_SQL} AS range_key,
       COUNT(*) FILTER (WHERE cl.rating IS NOT NULL)::int AS evaluated,
       COUNT(*) FILTER (WHERE cl.rating = 1)::int AS positive
     FROM scoped sc
     LEFT JOIN closed cl ON cl.id = sc.id
     GROUP BY 2`,
    scopeParams(bounds, filter)
  );

  // Object.keys preserva a ordem de inserção das chaves '1_'..'4_' acima —
  // usado pra ordenar as faixas cronologicamente (não alfabeticamente pelo
  // rótulo, que embaralharia "15 a 30 min" antes de "5 a 15 min").
  const byKind = new Map<string, Map<string, { evaluated: number; positive: number }>>([
    ['first_response', new Map()],
    ['duration', new Map()]
  ]);
  for (const r of res.rows) {
    if (r.range_key === null) continue; // sem dado pra classificar (chat sem 1ª resposta / sem duração)
    byKind.get(r.kind)!.set(r.range_key, { evaluated: r.evaluated, positive: r.positive });
  }

  const buildRows = (kind: string, labels: Record<string, string>): SatisfactionTimeRangeRow[] =>
    Object.keys(labels).map(key => {
      const found = byKind.get(kind)!.get(key);
      const evaluated = found?.evaluated ?? 0;
      const positive = found?.positive ?? 0;
      return { rangeLabel: labels[key], evaluated, positive, positiveRate: evaluated > 0 ? (positive / evaluated) * 100 : null };
    });

  return {
    byFirstResponse: buildRows('first_response', FIRST_RESPONSE_RANGE_LABELS),
    byDuration: buildRows('duration', DURATION_RANGE_LABELS)
  };
}

// ============================================================================
// Relatório "Conta/Cliente" (R5) — único dos cinco que responde pergunta
// comercial (diretoria/CS), não operacional. sinalRisco NÃO é calculado
// aqui (precisa comparar contra o período anterior, uma 2ª chamada desta
// mesma função) — fica por conta da rota, que soma esse campo ao retorno.
// ============================================================================

// --- getContasResumo --------------------------------------------------------
// 1 linha por empresa. minutosConsumidos é SOMA (não mediana) — a pergunta
// aqui é "quanto a conta consumiu", não "qual o caso típico" (mesma exceção
// deliberada que volumeChats já é a um cálculo de tendência central).
//
// Recorrência em 72h: LAG() SEM cortar por período na partição (só no
// filtro final) — um chat logo no início do período perde o contato
// anterior se a partição já vier cortada pela data. ⚠️ Isso varre
// chat_sessions inteira antes de filtrar período (precisa do histórico
// completo pra LAG funcionar certo) — candidata pesada, testar EXPLAIN
// ANALYZE contra o volume de produção; se ficar lenta, considerar limitar a
// uma janela "período + 72h de antecedência" em vez da tabela inteira.

export async function getContasResumo(filter: MetricsFilter): Promise<Omit<AccountSummaryRow, 'sinalRisco'>[]> {
  const bounds = await getPeriodBounds(filter);
  const params = [bounds.startUtc, bounds.endUtcExclusive, filter.companyId ?? null];

  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.status, cust.company_id
       FROM public.chat_sessions s
       LEFT JOIN public.profiles cust ON cust.id = s.customer_id
       WHERE s.created_at >= $1 AND s.created_at < $2
         AND cust.company_id IS NOT NULL
         AND ($3::uuid IS NULL OR cust.company_id = $3)
     ),
     volume_by_company AS (
       SELECT company_id, COUNT(*)::int AS volume FROM scoped GROUP BY company_id
     ),
     closed AS (
       SELECT sc.id, sc.company_id, h.duration_seconds, h.rating
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT duration_seconds, rating FROM public.chat_histories
         WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
       WHERE sc.status = 'closed'
     ),
     closed_stats AS (
       SELECT company_id,
         COUNT(*)::int AS total_closed,
         COALESCE(SUM(duration_seconds), 0) / 60.0 AS minutos_consumidos,
         COUNT(*) FILTER (WHERE rating IS NOT NULL)::int AS evaluated,
         COUNT(*) FILTER (WHERE rating = 1)::int AS positive
       FROM closed
       GROUP BY company_id
     ),
     all_contacts AS (
       SELECT s.id, s.customer_id, cust.company_id, s.created_at,
         LAG(s.created_at) OVER (PARTITION BY s.customer_id ORDER BY s.created_at) AS previous_contact_at
       FROM public.chat_sessions s
       JOIN public.profiles cust ON cust.id = s.customer_id
       WHERE ($3::uuid IS NULL OR cust.company_id = $3)
     ),
     recontact_stats AS (
       SELECT company_id,
         COUNT(*)::int AS volume,
         COUNT(*) FILTER (WHERE previous_contact_at IS NOT NULL AND created_at - previous_contact_at <= interval '72 hours')::int AS recontacts
       FROM all_contacts
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY company_id
     ),
     avaliacao_interna AS (
       SELECT ce.company_id, AVG(row_avg.avg_score) AS avaliacao_interna_media
       FROM public.customer_evaluations ce
       CROSS JOIN LATERAL (
         SELECT AVG(v) AS avg_score
         FROM unnest(ARRAY[ce.knowledge_score, ce.autonomy_score, ce.learning_score, ce.engagement_score, ce.organization_score, ce.communication_score]) AS v
         WHERE v IS NOT NULL
       ) row_avg
       WHERE ce.created_at >= $1 AND ce.created_at < $2 AND ($3::uuid IS NULL OR ce.company_id = $3)
       GROUP BY ce.company_id
     )
     SELECT
       v.company_id,
       c.name AS company_name,
       v.volume,
       COALESCE(cs.minutos_consumidos, 0) AS minutos_consumidos,
       CASE WHEN r.volume > 0 THEN r.recontacts::float / r.volume * 100 ELSE NULL END AS recorrencia_rate,
       CASE WHEN cs.evaluated > 0 THEN cs.positive::float / cs.evaluated * 100 ELSE NULL END AS positive_rate,
       CASE WHEN cs.total_closed > 0 THEN cs.evaluated::float / cs.total_closed * 100 ELSE NULL END AS response_rate,
       ai.avaliacao_interna_media
     FROM volume_by_company v
     JOIN public.companies c ON c.id = v.company_id
     LEFT JOIN closed_stats cs ON cs.company_id = v.company_id
     LEFT JOIN recontact_stats r ON r.company_id = v.company_id
     LEFT JOIN avaliacao_interna ai ON ai.company_id = v.company_id
     ORDER BY v.volume DESC`,
    params
  );

  return res.rows.map(r => ({
    companyId: r.company_id,
    companyName: r.company_name,
    volume: r.volume,
    minutosConsumidos: Number(r.minutos_consumidos),
    recorrenciaRate: r.recorrencia_rate !== null ? Number(r.recorrencia_rate) : null,
    positiveRate: r.positive_rate !== null ? Number(r.positive_rate) : null,
    responseRate: r.response_rate !== null ? Number(r.response_rate) : null,
    avaliacaoInternaMedia: r.avaliacao_interna_media !== null ? Number(r.avaliacao_interna_media) : null
  }));
}

// --- getContaDetalhe --------------------------------------------------------
// Drill-down de 1 empresa (companyId obrigatório) — chamado só quando a
// linha é expandida na tela: top 10 contatos por volume e evolução mensal.

export async function getContaTopContatos(filter: MetricsFilter, companyId: string): Promise<AccountTopContact[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.customer_id
       FROM public.chat_sessions s
       JOIN public.profiles cust ON cust.id = s.customer_id
       WHERE s.created_at >= $1 AND s.created_at < $2 AND cust.company_id = $3 AND s.customer_id IS NOT NULL
     ),
     closed AS (
       SELECT sc.id, sc.customer_id, h.duration_seconds
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT duration_seconds FROM public.chat_histories WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
     )
     SELECT sc.customer_id, p.name AS customer_name, COUNT(DISTINCT sc.id)::int AS volume,
       COALESCE(SUM(cl.duration_seconds), 0) / 60.0 AS minutos_consumidos
     FROM scoped sc
     JOIN public.profiles p ON p.id = sc.customer_id
     LEFT JOIN closed cl ON cl.id = sc.id
     GROUP BY sc.customer_id, p.name
     ORDER BY volume DESC
     LIMIT 10`,
    [bounds.startUtc, bounds.endUtcExclusive, companyId]
  );
  return res.rows.map(r => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    volume: r.volume,
    minutosConsumidos: Number(r.minutos_consumidos)
  }));
}

export async function getContaEvolucaoMensal(filter: MetricsFilter, companyId: string): Promise<AccountMonthlyBucket[]> {
  const bounds = await getPeriodBounds(filter);
  const res = await query(
    `WITH scoped AS (
       SELECT s.id, s.created_at, s.status,
         (date_trunc('month', s.created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS month_start
       FROM public.chat_sessions s
       JOIN public.profiles cust ON cust.id = s.customer_id
       WHERE s.created_at >= $1 AND s.created_at < $2 AND cust.company_id = $3
     ),
     volume_by_month AS (
       SELECT month_start, COUNT(*)::int AS volume FROM scoped GROUP BY month_start
     ),
     closed AS (
       SELECT sc.id, sc.month_start, h.duration_seconds, h.rating
       FROM scoped sc
       LEFT JOIN LATERAL (
         SELECT duration_seconds, rating FROM public.chat_histories WHERE session_id = sc.id ORDER BY created_at DESC LIMIT 1
       ) h ON true
       WHERE sc.status = 'closed'
     ),
     closed_by_month AS (
       SELECT month_start,
         COALESCE(SUM(duration_seconds), 0) / 60.0 AS minutos_consumidos,
         COUNT(*) FILTER (WHERE rating IS NOT NULL)::int AS evaluated,
         COUNT(*) FILTER (WHERE rating = 1)::int AS positive
       FROM closed
       GROUP BY month_start
     ),
     recontact_by_month AS (
       WITH all_contacts AS (
         SELECT s.id, s.customer_id, s.created_at,
           LAG(s.created_at) OVER (PARTITION BY s.customer_id ORDER BY s.created_at) AS previous_contact_at
         FROM public.chat_sessions s
         JOIN public.profiles cust ON cust.id = s.customer_id
         WHERE cust.company_id = $3
       )
       SELECT
         (date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS month_start,
         COUNT(*)::int AS volume,
         COUNT(*) FILTER (WHERE previous_contact_at IS NOT NULL AND created_at - previous_contact_at <= interval '72 hours')::int AS recontacts
       FROM all_contacts
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY 1
     )
     SELECT
       v.month_start,
       v.volume,
       COALESCE(cm.minutos_consumidos, 0) AS minutos_consumidos,
       CASE WHEN cm.evaluated > 0 THEN cm.positive::float / cm.evaluated * 100 ELSE NULL END AS positive_rate,
       CASE WHEN rm.volume > 0 THEN rm.recontacts::float / rm.volume * 100 ELSE NULL END AS recorrencia_rate
     FROM volume_by_month v
     LEFT JOIN closed_by_month cm ON cm.month_start = v.month_start
     LEFT JOIN recontact_by_month rm ON rm.month_start = v.month_start
     ORDER BY v.month_start`,
    [bounds.startUtc, bounds.endUtcExclusive, companyId]
  );
  return res.rows.map(r => ({
    monthStart: r.month_start,
    volume: r.volume,
    minutosConsumidos: Number(r.minutos_consumidos),
    positiveRate: r.positive_rate !== null ? Number(r.positive_rate) : null,
    recorrenciaRate: r.recorrencia_rate !== null ? Number(r.recorrencia_rate) : null
  }));
}
