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

export type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

// Início usado pelo preset 'all'. Data fixa e bem anterior a qualquer registro
// em vez de MIN(created_at): evita uma consulta extra só pra descobrir o
// começo, e o resultado é o mesmo — nenhum registro do sistema é anterior a
// isso. Só faz sentido em relatório de baixa cardinalidade (ver o comentário
// em components/reports/metrics-filter-bar.tsx).
const ALL_TIME_START = '2000-01-01';
// Fim do 'all' quando o relatório também olha pra frente (extendToPeriodEnd).
const ALL_TIME_END = '2100-12-31';

export interface ResolvePeriodOptions {
  /**
   * Fecha o intervalo no FIM do período de calendário em vez de "hoje".
   *
   * O padrão (false) é o certo para relatório de coisa que já aconteceu —
   * atendimento, satisfação: não existe conversa em data futura, e terminar
   * em hoje evita sugerir que o mês inteiro foi medido.
   *
   * Já um relatório de PLANEJAMENTO precisa enxergar o futuro: em Hotfixes a
   * situação "Pendente" (data prevista ainda não chegou) só existe para
   * registro com data à frente de hoje — cortar em hoje faria esse estado
   * nunca aparecer.
   */
  extendToPeriodEnd?: boolean;
}

export async function resolvePeriod(
  searchParams: URLSearchParams,
  options: ResolvePeriodOptions = {}
): Promise<{ startDate: string; endDate: string }> {
  const preset = (searchParams.get('period') || 'month') as PeriodPreset;
  const extend = !!options.extendToPeriodEnd;
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
    const sunday = addDaysUTC(monday, 6);
    return { startDate: toDateOnly(monday), endDate: toDateOnly(extend ? sunday : today) };
  }
  if (preset === 'year') {
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
    return { startDate: toDateOnly(yearStart), endDate: toDateOnly(extend ? yearEnd : today) };
  }
  if (preset === 'all') {
    return { startDate: ALL_TIME_START, endDate: extend ? ALL_TIME_END : toDateOnly(today) };
  }
  // 'month'
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  // Dia 0 do mês seguinte = último dia deste mês, sem tabela de 28/30/31.
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return { startDate: toDateOnly(monthStart), endDate: toDateOnly(extend ? monthEnd : today) };
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
