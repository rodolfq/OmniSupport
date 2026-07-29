'use client';

import React, { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  Lock, Clock, Percent, Timer, Star, Zap, Hourglass, MessageSquare,
  TrendingUp, TrendingDown, AlertTriangle, Users, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, KpiStatus } from '@/lib/types';
import { formatSeconds, formatPercentage, formatMinutes, formatCount, formatAverage } from '@/lib/report-format';
import {
  MetricsFilterBar,
  MetricsFilterState,
  DEFAULT_METRICS_FILTER_STATE,
  isMetricsFilterReady,
  metricsFilterToQueryString
} from '@/components/reports/metrics-filter-bar';
import { ReportSection } from '@/components/reports/report-section';
import { SectionInfoTip } from '@/components/reports/section-info-tip';
import { useReportFetch } from '@/components/reports/use-report-fetch';
import { ReportExportConfig, SectionExportButton, PageExportPdfButton } from '@/components/reports/export-menu';

// Dashboard Gerencial — Etapa 3 do roadmap "Time x Gerencial". Reaproveita a
// linguagem visual de /dashboard e /reports (mesmos tokens de cor,
// tipografia, cards rounded-2xl). Toda leitura passa por
// app/api/dashboard/management/route.ts, que já checa a permissão
// dashboard:management no servidor (regra de ouro: esconder o item de menu
// não é controle de acesso).
//
// Filtro, formatação e loading/vazio/erro vêm de components/reports/ — os
// mesmos componentes que o R1 ("Atendimento — visão geral") usa, desde que
// o R1 os promoveu a padrão compartilhado. Ganho colateral: esta tela passa
// a ter filtro por empresa, que a Etapa 3 não expunha.

const DASHBOARD_ENDPOINT = '/api/dashboard/management';
const REPORT_ID = 'dashboard-management';
const REPORT_LABEL = 'Dashboard Gerencial';

interface KpisResponse {
  parcial: boolean;
  volume: { count: number; status: KpiStatus };
  firstResponse: { medianSeconds: number | null; p90Seconds: number | null; sampleSize: number; status: KpiStatus };
  pct2min: { percentage: number | null; status: KpiStatus };
  duration: { medianMinutes: number | null; status: KpiStatus };
  satisfaction: { positiveRate: number | null; responseRate: number | null; status: KpiStatus };
  individualPeak: { value: number; status: KpiStatus };
  waitingNow: { count: number; status: KpiStatus };
}

interface TrendRow {
  month: string;
  volume: number;
  pct2min: number | null;
  firstResponseMedianSeconds: number | null;
  satisfaction: number | null;
  msgsPorChat: number | null;
  durationMedianMinutes: number | null;
}

interface TrendResponse {
  months: TrendRow[];
}

interface ComparisonRow {
  metric: string;
  unit: 'count' | 'seconds' | 'percentage' | 'minutes';
  current: number | null;
  previous: number | null;
  higherIsBetter: boolean | null;
}

interface ComparisonResponse {
  currentWeek: { startDate: string; endDate: string };
  previousWeek: { startDate: string; endDate: string };
  rows: ComparisonRow[];
}

interface LoadByHourBucket {
  bucketStart: string;
  cargaSimultanea: number;
  analistasOnline: number;
}

interface LoadByHourResponse {
  buckets: LoadByHourBucket[];
  individualPeakReference: number;
}

interface AlertItem {
  id: string;
  severity: 'warning' | 'danger';
  message: string;
}

interface AlertsResponse {
  alerts: AlertItem[];
}

function formatByUnit(value: number | null, unit: ComparisonRow['unit']): string {
  if (unit === 'seconds') return formatSeconds(value);
  if (unit === 'percentage') return formatPercentage(value);
  if (unit === 'minutes') return formatMinutes(value);
  return formatCount(value);
}

// Formata o eixo de "hora do dia" sempre em America/Sao_Paulo — é o único
// gráfico da tela cujo eixo X É a hora, então mostrar a hora errada aqui
// (se o navegador de quem olha estiver em outro fuso) seria um bug real, não
// só uma questão de convenção visual como nas outras datas da tela.
function formatHourTick(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', timeZone: 'America/Sao_Paulo' });
}

const STATUS_CARD_CLASSES: Record<KpiStatus, string> = {
  good: 'border-[var(--text-success)]/30 bg-[var(--surface-success)]',
  warning: 'border-[var(--border-alert)] bg-[var(--surface-warning)]',
  danger: 'border-[var(--text-danger)]/40 bg-[var(--surface-danger)]'
};

const STATUS_DOT_CLASSES: Record<KpiStatus, string> = {
  good: 'bg-[var(--text-success)]',
  warning: 'bg-[var(--text-warning-strong)]',
  danger: 'bg-[var(--text-danger)]'
};

function KpiCard({ label, value, sub, status, icon }: {
  label: string; value: string; sub?: string; status: KpiStatus; icon: React.ReactNode;
}) {
  return (
    <div className={cn("p-6 rounded-2xl border shadow-sm flex flex-col justify-between transition-all duration-500", STATUS_CARD_CLASSES[status])}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">{label}</p>
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", STATUS_DOT_CLASSES[status])} />
          <div className="opacity-50">{icon}</div>
        </div>
      </div>
      <p className="text-3xl font-bold text-[var(--text-primary)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardManagementPage() {
  const { currentUser, hasPermission } = useApp();
  const { theme } = useTheme();
  const axisColor = theme === 'dark' ? '#94a3b8' : '#64748b';
  const tooltipStyle = theme === 'dark'
    ? { borderRadius: '12px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.3)' }
    : { borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' };

  const [filter, setFilter] = useState<MetricsFilterState>(DEFAULT_METRICS_FILTER_STATE);
  const [filterSummary, setFilterSummary] = useState('');
  const ready = isMetricsFilterReady(filter);
  const filterQs = useMemo(() => metricsFilterToQueryString(filter), [filter]);

  // Tendência (6 meses fixos) e comparativo (semana atual x anterior) têm
  // janela de tempo própria no servidor (ignoram period/startDate/endDate),
  // mas ainda respeitam fila/instância/empresa — por isso os 5 reagem ao
  // mesmo filterQs.
  const kpis = useReportFetch<KpisResponse>(DASHBOARD_ENDPOINT, 'kpis', filterQs, ready);
  const trend = useReportFetch<TrendResponse>(DASHBOARD_ENDPOINT, 'trend', filterQs, true);
  const comparison = useReportFetch<ComparisonResponse>(DASHBOARD_ENDPOINT, 'comparison', filterQs, true);
  const loadByHour = useReportFetch<LoadByHourResponse>(DASHBOARD_ENDPOINT, 'load-by-hour', filterQs, ready);
  const alerts = useReportFetch<AlertsResponse>(DASHBOARD_ENDPOINT, 'alerts', filterQs, ready);

  const kpisExport: ReportExportConfig = useMemo(() => ({
    title: 'KPIs',
    columns: [
      { key: 'chatsNoPeriodo', label: 'Chats no período' },
      { key: 'firstResponseMedianaSegundos', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'pct2min', label: '% até 2min', format: (v) => formatPercentage(v as number | null) },
      { key: 'duracaoMedianaMinutos', label: 'Duração mediana (min)', format: (v) => formatMinutes(v as number | null) },
      { key: 'satisfacaoPercentual', label: '% satisfação', format: (v) => formatPercentage(v as number | null) },
      { key: 'picoIndividual', label: 'Pico individual simultâneo' },
      { key: 'chatsEmEsperaAgora', label: 'Chats em espera agora' }
    ],
    rows: kpis.data ? [{
      chatsNoPeriodo: kpis.data.volume.count,
      firstResponseMedianaSegundos: kpis.data.firstResponse.medianSeconds,
      pct2min: kpis.data.pct2min.percentage,
      duracaoMedianaMinutos: kpis.data.duration.medianMinutes,
      satisfacaoPercentual: kpis.data.satisfaction.positiveRate,
      picoIndividual: kpis.data.individualPeak.value,
      chatsEmEsperaAgora: kpis.data.waitingNow.count
    }] : []
  }), [kpis.data]);

  const trendExport: ReportExportConfig = useMemo(() => ({
    title: 'Tendência mensal',
    columns: [
      { key: 'month', label: 'Mês' },
      { key: 'volume', label: 'Volume' },
      { key: 'pct2min', label: '% até 2min', format: (v) => formatPercentage(v as number | null) },
      { key: 'firstResponseMedianSeconds', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'satisfaction', label: '% satisfação', format: (v) => formatPercentage(v as number | null) },
      { key: 'msgsPorChat', label: 'Msgs/chat' },
      { key: 'durationMedianMinutes', label: 'Duração mediana (min)', format: (v) => formatMinutes(v as number | null) }
    ],
    rows: trend.data?.months ?? []
  }), [trend.data]);

  const comparisonExport: ReportExportConfig = useMemo(() => ({
    title: 'Comparativo — semana atual x semana anterior',
    columns: [
      { key: 'metric', label: 'Métrica' },
      { key: 'current', label: 'Semana atual', format: (v, row) => formatByUnit(v as number | null, row.unit) },
      { key: 'previous', label: 'Semana anterior', format: (v, row) => formatByUnit(v as number | null, row.unit) }
    ],
    rows: comparison.data?.rows ?? []
  }), [comparison.data]);

  const loadByHourExport: ReportExportConfig = useMemo(() => ({
    title: 'Carga por horário',
    columns: [
      { key: 'bucketStart', label: 'Horário', format: (v) => formatHourTick(v as string) },
      { key: 'cargaSimultanea', label: 'Carga simultânea' },
      { key: 'analistasOnline', label: 'Analistas online' }
    ],
    rows: loadByHour.data?.buckets ?? []
  }), [loadByHour.data]);

  const alertsExportRows = alerts.data?.alerts ?? [];
  const alertsExport: ReportExportConfig = useMemo(() => ({
    title: 'Alertas',
    columns: [
      { key: 'severity', label: 'Severidade' },
      { key: 'message', label: 'Mensagem' }
    ],
    rows: alertsExportRows
  }), [alertsExportRows]);

  if (currentUser && !hasPermission(Permission.DASHBOARD_MANAGEMENT)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar o dashboard gerencial.</p>
        </div>
      </div>
    );
  }

  const alertsList = alerts.data?.alerts ?? [];
  const allSections = [kpisExport, trendExport, comparisonExport, loadByHourExport, alertsExport];

  const trendEmpty = trend.data ? trend.data.months.every((m) => m.volume === 0) : false;
  const trendStatus = trend.status === 'ready' && trendEmpty ? 'empty' : trend.status;
  const comparisonEmpty = comparison.data ? comparison.data.rows.every((r) => r.current === null && r.previous === null) : false;
  const comparisonStatus = comparison.status === 'ready' && comparisonEmpty ? 'empty' : comparison.status;
  const loadByHourEmpty = loadByHour.data ? loadByHour.data.buckets.every((b) => b.cargaSimultanea === 0 && b.analistasOnline === 0) : false;
  const loadByHourStatus = loadByHour.status === 'ready' && loadByHourEmpty ? 'empty' : loadByHour.status;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Dashboard Gerencial</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">Indicadores agregados de atendimento para gestão — tendência, comparativo semanal, carga por horário e alertas.</p>
          {kpis.data?.parcial && (
            <p className="text-[11px] font-bold text-[var(--text-warning-strong)] uppercase tracking-widest mt-1">
              Período em andamento — números ainda parciais
            </p>
          )}
        </div>
        <PageExportPdfButton sections={allSections} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      {/* KPIs — mantém o card com faixa de status própria da Etapa 3
          (ReportSection não tem esse conceito, é específico dos limites
          configuráveis em config_metric_thresholds). Header próprio só pra
          caber o botão de export, mesmo componente das outras seções. */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black text-[var(--text-primary)] tracking-tight uppercase">KPIs</h2>
          <SectionInfoTip text="Cada card compara o valor do período com os limites configurados (bom / atenção / crítico). A cor da bolinha indica a faixa atual." />
        </div>
        <SectionExportButton config={kpisExport} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>
      {kpis.status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
          <Loader2 size={14} className="animate-spin" /> Carregando indicadores...
        </div>
      )}
      {kpis.status === 'error' && (
        <div className="flex items-center gap-2 flex-wrap text-sm text-[var(--text-danger)]">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{kpis.error || 'Não foi possível carregar os indicadores.'}</span>
          <button onClick={kpis.retry} className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent-text)] hover:underline">Tentar de novo</button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          label="Chats no período"
          value={formatCount(kpis.data?.volume.count ?? null)}
          status={kpis.data?.volume.status ?? 'warning'}
          icon={<MessageSquare size={16} />}
        />
        <KpiCard
          label="1ª resposta (mediana)"
          value={formatSeconds(kpis.data?.firstResponse.medianSeconds ?? null)}
          sub={kpis.data ? `p90: ${formatSeconds(kpis.data.firstResponse.p90Seconds)}` : undefined}
          status={kpis.data?.firstResponse.status ?? 'warning'}
          icon={<Clock size={16} />}
        />
        <KpiCard
          label="% respondido até 2min"
          value={formatPercentage(kpis.data?.pct2min.percentage ?? null)}
          status={kpis.data?.pct2min.status ?? 'warning'}
          icon={<Percent size={16} />}
        />
        <KpiCard
          label="Duração (mediana)"
          value={formatMinutes(kpis.data?.duration.medianMinutes ?? null)}
          status={kpis.data?.duration.status ?? 'warning'}
          icon={<Timer size={16} />}
        />
        <KpiCard
          label="% satisfação"
          value={formatPercentage(kpis.data?.satisfaction.positiveRate ?? null)}
          sub={kpis.data ? `resposta da pesquisa: ${formatPercentage(kpis.data.satisfaction.responseRate)}` : undefined}
          status={kpis.data?.satisfaction.status ?? 'warning'}
          icon={<Star size={16} />}
        />
        <KpiCard
          label="Pico individual simultâneo"
          value={formatCount(kpis.data?.individualPeak.value ?? null)}
          status={kpis.data?.individualPeak.status ?? 'warning'}
          icon={<Zap size={16} />}
        />
        <KpiCard
          label="Chats em espera agora"
          value={formatCount(kpis.data?.waitingNow.count ?? null)}
          status={kpis.data?.waitingNow.status ?? 'warning'}
          icon={<Hourglass size={16} />}
        />
      </div>

      {/* Tendência mensal */}
      <ReportSection
        title="Tendência mensal"
        subtitle="Últimos 6 meses"
        info="Evolução mês a mês dos últimos 6 meses fechados — mostra se a operação está melhorando ou piorando ao longo do tempo, independente do filtro de período acima."
        status={trendStatus}
        errorMessage={trend.error ?? undefined}
        emptyMessage="Sem chats registrados nos últimos 6 meses."
        onRetry={trend.retry}
        exportConfig={trendExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-64">
            <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest mb-2">Volume x % até 2min</p>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={trend.data?.months ?? []}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: string) => [name === 'Volume' ? formatCount(value) : formatPercentage(value), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line yAxisId="left" type="monotone" dataKey="volume" name="Volume" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="pct2min" name="% até 2min" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest mb-2">1ª resposta x Satisfação</p>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={trend.data?.months ?? []}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: string) => [name === '1ª resposta' ? formatSeconds(value) : formatPercentage(value), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line yAxisId="left" type="monotone" dataKey="firstResponseMedianSeconds" name="1ª resposta" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="satisfaction" name="Satisfação" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <p className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest mb-2">Msgs/chat x Duração mediana</p>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={trend.data?.months ?? []}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: any, name: string) => [name === 'Msgs/chat' ? formatAverage(value) : formatMinutes(value), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line yAxisId="left" type="monotone" dataKey="msgsPorChat" name="Msgs/chat" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="durationMedianMinutes" name="Duração (min)" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </ReportSection>

      {/* Comparativo semana atual x anterior */}
      <ReportSection
        title="Comparativo — semana atual x semana anterior"
        subtitle={comparison.data ? `${comparison.data.currentWeek.startDate} a ${comparison.data.currentWeek.endDate} x ${comparison.data.previousWeek.startDate} a ${comparison.data.previousWeek.endDate}` : undefined}
        info="Compara a semana atual (em andamento) com a mesma janela de dias da semana anterior — não usa o filtro de período acima, é sempre semana x semana."
        status={comparisonStatus}
        errorMessage={comparison.error ?? undefined}
        emptyMessage="Sem dados suficientes para comparar as duas semanas."
        onRetry={comparison.retry}
        exportConfig={comparisonExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 px-3">Métrica</th>
                <th className="text-right py-2 px-3">Semana atual</th>
                <th className="text-right py-2 px-3">Semana anterior</th>
                <th className="text-right py-2 px-3">Variação</th>
              </tr>
            </thead>
            <tbody>
              {(comparison.data?.rows ?? []).map((row) => {
                const hasBothValues = row.current !== null && row.previous !== null && row.previous !== 0;
                const diffPct = hasBothValues ? ((row.current! - row.previous!) / Math.abs(row.previous!)) * 100 : null;
                const increased = diffPct !== null && diffPct > 0;
                let colorClass = 'text-[var(--text-tertiary)]';
                let suffix = '';
                if (diffPct !== null && row.higherIsBetter !== null) {
                  const improved = row.higherIsBetter ? increased : !increased;
                  colorClass = improved ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]';
                  suffix = improved ? ' melhor' : ' pior';
                }
                const Icon = increased ? TrendingUp : TrendingDown;
                return (
                  <tr key={row.metric} className="border-b border-[var(--border-default)] last:border-0">
                    <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{row.metric}</td>
                    <td className="py-3 px-3 text-right font-bold text-[var(--text-primary)]">{formatByUnit(row.current, row.unit)}</td>
                    <td className="py-3 px-3 text-right text-[var(--text-tertiary)]">{formatByUnit(row.previous, row.unit)}</td>
                    <td className={cn("py-3 px-3 text-right font-bold", colorClass)}>
                      {diffPct === null ? '—' : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Icon size={12} /> {increased ? '+' : ''}{diffPct.toFixed(0)}%{suffix}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ReportSection>

      {/* Carga por horário */}
      <ReportSection
        title="Carga por horário"
        subtitle="Carga simultânea x analistas online — horário de Brasília"
        info="Quantos chats estavam simultaneamente ativos por analista online, hora a hora — ajuda a identificar horários de pico que pedem mais gente escalada."
        status={loadByHourStatus}
        errorMessage={loadByHour.error ?? undefined}
        emptyMessage="Sem atendimentos no período selecionado."
        onRetry={loadByHour.retry}
        exportConfig={loadByHourExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={loadByHour.data?.buckets ?? []}>
              <XAxis dataKey="bucketStart" tickFormatter={formatHourTick} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={formatHourTick} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="cargaSimultanea" name="Carga simultânea" stroke="#4f46e5" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="analistasOnline" name="Analistas online" stroke="#22c55e" strokeWidth={2} dot={false} />
              {!!loadByHour.data?.individualPeakReference && (
                <ReferenceLine
                  y={loadByHour.data.individualPeakReference}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{ value: 'Pico individual do período', fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ReportSection>

      {/* Alertas */}
      <ReportSection
        title="Alertas"
        info="Avisos automáticos gerados quando algum indicador do período cai na faixa crítica configurada (ex: fila de espera muito alta, pico de atendimento simultâneo por analista) — os mesmos limites usados nos cards de KPIs acima. Não é um erro do sistema: é o dashboard sinalizando algo que merece atenção."
        status={alerts.status === 'ready' && alertsList.length === 0 ? 'empty' : alerts.status}
        errorMessage={alerts.error ?? undefined}
        emptyMessage="Nenhum alerta no momento — todos os indicadores estão dentro da faixa esperada."
        onRetry={alerts.retry}
        exportConfig={alertsExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="space-y-2">
          {alertsList.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border text-sm font-medium",
                alert.severity === 'danger'
                  ? "border-[var(--text-danger)]/30 bg-[var(--surface-danger)] text-[var(--text-danger)]"
                  : "border-[var(--border-alert)] bg-[var(--surface-warning)] text-[var(--text-warning-strong)]"
              )}
            >
              {alert.severity === 'danger' ? <AlertTriangle size={16} className="shrink-0" /> : <Users size={16} className="shrink-0" />}
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      </ReportSection>
    </div>
  );
}
