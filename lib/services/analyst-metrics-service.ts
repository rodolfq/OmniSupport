import { query } from '@/lib/db';

// Métricas brutas por analista e período (plano de avaliação v1.3, Fase 1).
// O cálculo do relógio, dos turnos e das medianas fica no banco, em
// migrations/chat_assignments_clock.sql (record_analyst_metrics). Aqui só se
// chama a função e se lê o resultado.
//
// Nenhum agendador chama este serviço ainda: a gravação acontece só quando
// alguém invoca recordAnalystMetrics. Por isso não altera o comportamento atual
// do sistema.

// Versão da definição das métricas. Mudar a definição sobe esse número, e os
// valores antigos continuam gravados (ver a chave da tabela).
export const ANALYST_METRIC_DEFINITION_VERSION = 1;

export interface AnalystMetricValue {
  analystId: string;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  // null = sem dado no período. Diferente de zero.
  value: number | null;
  sampleN: number;
  definitionVersion: number;
  computedAt: string;
}

function assertValidPeriod(periodStart: Date, periodEnd: Date): void {
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error('Período inválido: datas não reconhecidas.');
  }
  if (periodEnd.getTime() <= periodStart.getTime()) {
    throw new Error('Período inválido: o fim precisa ser depois do início.');
  }
}

// Calcula e grava (ou regrava) as métricas de um analista no período.
// Idempotente: rodar de novo atualiza os valores, sem duplicar linhas.
// Devolve quantas métricas foram gravadas.
export async function recordAnalystMetrics(
  analystId: string,
  periodStart: Date,
  periodEnd: Date,
  definitionVersion: number = ANALYST_METRIC_DEFINITION_VERSION
): Promise<number> {
  assertValidPeriod(periodStart, periodEnd);
  const res = await query(
    'SELECT public.record_analyst_metrics($1, $2, $3, $4) AS n',
    [analystId, periodStart.toISOString(), periodEnd.toISOString(), definitionVersion]
  );
  return Number(res.rows[0]?.n ?? 0);
}

// Lê as métricas já gravadas de um analista num período e versão de definição.
export async function listAnalystMetricValues(
  analystId: string,
  periodStart: Date,
  periodEnd: Date,
  definitionVersion: number = ANALYST_METRIC_DEFINITION_VERSION
): Promise<AnalystMetricValue[]> {
  assertValidPeriod(periodStart, periodEnd);
  const res = await query(
    `SELECT analyst_id, period_start, period_end, metric_key, value, sample_n, definition_version, computed_at
       FROM public.analyst_metric_values
      WHERE analyst_id = $1
        AND period_start = $2
        AND period_end = $3
        AND definition_version = $4
      ORDER BY metric_key`,
    [analystId, periodStart.toISOString(), periodEnd.toISOString(), definitionVersion]
  );

  return res.rows.map((r: {
    analyst_id: string;
    period_start: Date | string;
    period_end: Date | string;
    metric_key: string;
    value: string | number | null;
    sample_n: number;
    definition_version: number;
    computed_at: Date | string;
  }) => ({
    analystId: r.analyst_id,
    periodStart: new Date(r.period_start).toISOString(),
    periodEnd: new Date(r.period_end).toISOString(),
    metricKey: r.metric_key,
    value: r.value === null ? null : Number(r.value),
    sampleN: Number(r.sample_n),
    definitionVersion: Number(r.definition_version),
    computedAt: new Date(r.computed_at).toISOString(),
  }));
}
