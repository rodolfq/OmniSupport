import { query } from './db';
import { MetricsFilter } from './types';

// Resolução de período (preset hoje/semana/mês/custom → startDate/endDate)
// compartilhada por toda rota de dashboard gerencial/relatório — extraído
// de app/api/dashboard/management/route.ts quando o R1 (Etapa 4) virou o
// segundo consumidor. Mesma regra de fuso do resto do projeto: a "hora de
// agora" só é obtida via SQL (AT TIME ZONE 'America/Sao_Paulo'), nunca via
// Date local do processo Node. Depois de resolvido esse único ponto, toda
// aritmética de calendário usa os métodos getUTC*/setUTCDate (seguro:
// é aritmética de calendário pura sobre um valor já ancorado, não conversão
// de fuso).

export async function getTodaySP(): Promise<Date> {
  const res = await query(`SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS today`);
  return res.rows[0].today as Date;
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysUTC(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

export async function resolvePeriod(searchParams: URLSearchParams): Promise<{ startDate: string; endDate: string }> {
  const preset = (searchParams.get('period') || 'month') as PeriodPreset;
  if (preset === 'custom') {
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    if (!startDate || !endDate) {
      throw new Error('startDate e endDate são obrigatórios para period=custom.');
    }
    return { startDate, endDate };
  }
  const today = await getTodaySP();
  if (preset === 'today') {
    return { startDate: toDateOnly(today), endDate: toDateOnly(today) };
  }
  if (preset === 'week') {
    const weekday = today.getUTCDay(); // 0=Dom..6=Sáb
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = addDaysUTC(today, -daysSinceMonday);
    return { startDate: toDateOnly(monday), endDate: toDateOnly(today) };
  }
  // 'month'
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { startDate: toDateOnly(monthStart), endDate: toDateOnly(today) };
}

// Filtro comum (período resolvido + fila/instância/empresa) — todo relatório
// aceita a mesma querystring que o MetricsFilterBar (components/reports/
// metrics-filter-bar.tsx) produz.
export function buildMetricsFilter(searchParams: URLSearchParams, startDate: string, endDate: string): MetricsFilter {
  return {
    startDate,
    endDate,
    queueId: searchParams.get('queueId') || undefined,
    instanceId: searchParams.get('instanceId') || undefined,
    companyId: searchParams.get('companyId') || undefined
  };
}

export function scopeFromSearchParams(searchParams: URLSearchParams): { queueId?: string; instanceId?: string } {
  return {
    queueId: searchParams.get('queueId') || undefined,
    instanceId: searchParams.get('instanceId') || undefined
  };
}

// R5 "Conta/Cliente" — período anterior de MESMO TAMANHO que o filtrado
// (não uma semana fixa, como a comparação do dashboard gerencial: aqui o
// período escolhido no filtro pode ser mês, trimestre ou custom). Pura
// aritmética de calendário sobre datas já resolvidas — sem chamada ao banco.
export function getPreviousPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const lengthDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1; // inclusive
  const previousEnd = addDaysUTC(start, -1);
  const previousStart = addDaysUTC(previousEnd, -(lengthDays - 1));
  return { startDate: toDateOnly(previousStart), endDate: toDateOnly(previousEnd) };
}
