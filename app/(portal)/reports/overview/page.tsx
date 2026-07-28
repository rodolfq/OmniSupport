'use client';

import React, { useMemo, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Lock, Clock, Percent, Timer, MessageSquare, Hourglass, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, ReportDimension, DimensionBreakdownRow, HourlyBucket, HourOfDayBucket, WeekdayBucket } from '@/lib/types';
import { formatSeconds, formatPercentage, formatMinutes, formatCount, formatAverage } from '@/lib/report-format';
import {
  MetricsFilterBar,
  MetricsFilterState,
  DEFAULT_METRICS_FILTER_STATE,
  isMetricsFilterReady,
  metricsFilterToQueryString
} from '@/components/reports/metrics-filter-bar';
import { ReportSection, ReportSectionStatus } from '@/components/reports/report-section';
import { useReportFetch } from '@/components/reports/use-report-fetch';
import { ReportExportConfig, PageExportPdfButton } from '@/components/reports/export-menu';
import { ReportBackLink } from '@/components/reports/report-back-link';

// R1 — "Atendimento: visão geral". Estabelece o padrão dos relatórios
// seguintes: página aqui, dados em app/api/reports/overview/route.ts
// (nunca calcula métrica — só orquestra lib/services/metrics-service.ts),
// filtro e estados de loading/vazio/erro vêm dos componentes compartilhados
// em components/reports/.

interface SummaryResponse {
  parcial: boolean;
  volume: { count: number };
  firstResponse: { medianSeconds: number | null; p90Seconds: number | null; sampleSize: number };
  pct2min: { percentage: number | null };
  duration: { medianMinutes: number | null };
  msgsPorChat: { average: number | null };
  waiting: { medianSeconds: number | null; p90Seconds: number | null };
  abandono: { percentage: number | null };
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DIMENSION_TABS: { dimension: ReportDimension; label: string }[] = [
  { dimension: 'queue', label: 'Fila' },
  { dimension: 'instance', label: 'Instância' },
  { dimension: 'channel', label: 'Canal' },
  { dimension: 'company', label: 'Empresa' }
];

const REPORT_ENDPOINT = '/api/reports/overview';
const REPORT_ID = 'overview';
const REPORT_LABEL = 'Atendimento — Visão Geral';

export default function ReportOverviewPage() {
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

  const summary = useReportFetch<SummaryResponse>(REPORT_ENDPOINT, 'summary', filterQs, ready);
  const volumeByDay = useReportFetch<{ buckets: HourlyBucket[] }>(REPORT_ENDPOINT, 'volume-by-day', filterQs, ready);
  const volumeByHour = useReportFetch<{ buckets: HourOfDayBucket[] }>(REPORT_ENDPOINT, 'volume-by-hour', filterQs, ready);
  const volumeByWeekday = useReportFetch<{ buckets: WeekdayBucket[] }>(REPORT_ENDPOINT, 'volume-by-weekday', filterQs, ready);

  const [activeDimension, setActiveDimension] = useState<ReportDimension>('queue');
  const breakdown = useReportFetch<{ rows: DimensionBreakdownRow[] }>(REPORT_ENDPOINT, 'breakdown', filterQs, ready, `dimension=${activeDimension}`);

  const summaryExport: ReportExportConfig = useMemo(() => ({
    title: 'Resumo do período',
    columns: [
      { key: 'chatsNoPeriodo', label: 'Chats no período' },
      { key: 'firstResponseMedianaSegundos', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'firstResponseP90Segundos', label: '1ª resposta p90 (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'pct2min', label: '% até 2min', format: (v) => formatPercentage(v as number | null) },
      { key: 'duracaoMedianaMinutos', label: 'Duração mediana (min)', format: (v) => formatMinutes(v as number | null) },
      { key: 'msgsPorChat', label: 'Msgs/chat', format: (v) => formatAverage(v as number | null) },
      { key: 'esperaMedianaSegundos', label: 'Espera mediana (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'abandonoPercentual', label: '% abandono', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: summary.data ? [{
      chatsNoPeriodo: summary.data.volume.count,
      firstResponseMedianaSegundos: summary.data.firstResponse.medianSeconds,
      firstResponseP90Segundos: summary.data.firstResponse.p90Seconds,
      pct2min: summary.data.pct2min.percentage,
      duracaoMedianaMinutos: summary.data.duration.medianMinutes,
      msgsPorChat: summary.data.msgsPorChat.average,
      esperaMedianaSegundos: summary.data.waiting.medianSeconds,
      abandonoPercentual: summary.data.abandono.percentage
    }] : []
  }), [summary.data]);

  const volumeByDayExport: ReportExportConfig = useMemo(() => ({
    title: 'Volume por dia',
    columns: [
      { key: 'bucketStart', label: 'Data', format: (v) => new Date(v as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) },
      { key: 'count', label: 'Chats' }
    ],
    rows: volumeByDay.data?.buckets ?? []
  }), [volumeByDay.data]);

  const volumeByHourExport: ReportExportConfig = useMemo(() => ({
    title: 'Volume por hora do dia',
    columns: [
      { key: 'hour', label: 'Hora', format: (v) => `${v}h` },
      { key: 'count', label: 'Chats' }
    ],
    rows: volumeByHour.data?.buckets ?? []
  }), [volumeByHour.data]);

  const volumeByWeekdayExport: ReportExportConfig = useMemo(() => ({
    title: 'Volume por dia da semana',
    columns: [
      { key: 'weekday', label: 'Dia da semana', format: (v) => WEEKDAY_LABELS[v as number] },
      { key: 'count', label: 'Chats' }
    ],
    rows: volumeByWeekday.data?.buckets ?? []
  }), [volumeByWeekday.data]);

  const breakdownExport: ReportExportConfig = useMemo(() => ({
    title: `Quebra por dimensão (${DIMENSION_TABS.find(t => t.dimension === activeDimension)?.label})`,
    columns: [
      { key: 'segmentLabel', label: 'Segmento' },
      { key: 'volume', label: 'Volume' },
      { key: 'firstResponseMedianSeconds', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'firstResponseP90Seconds', label: '1ª resposta p90 (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'pct2min', label: '% até 2min', format: (v) => formatPercentage(v as number | null) },
      { key: 'durationMedianMinutes', label: 'Duração mediana (min)', format: (v) => formatMinutes(v as number | null) },
      { key: 'msgsPorChat', label: 'Msgs/chat', format: (v) => formatAverage(v as number | null) },
      { key: 'abandonoPercentage', label: '% abandono', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: breakdown.data?.rows ?? []
  }), [breakdown.data, activeDimension]);

  if (currentUser && !hasPermission(Permission.REPORTS_READ)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para visualizar relatórios.</p>
        </div>
      </div>
    );
  }

  const summaryEmpty = summary.data ? summary.data.volume.count === 0 : false;
  const summaryStatus: ReportSectionStatus = summary.status === 'ready' && summaryEmpty ? 'empty' : summary.status;

  const dayEmpty = volumeByDay.data ? volumeByDay.data.buckets.every((b) => b.count === 0) : false;
  const dayStatus: ReportSectionStatus = volumeByDay.status === 'ready' && dayEmpty ? 'empty' : volumeByDay.status;

  const breakdownEmpty = breakdown.data ? breakdown.data.rows.length === 0 : false;
  const breakdownStatus: ReportSectionStatus = breakdown.status === 'ready' && breakdownEmpty ? 'empty' : breakdown.status;

  const allSections = [summaryExport, volumeByDayExport, volumeByHourExport, volumeByWeekdayExport, breakdownExport];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Atendimento — Visão Geral</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">Como a operação performou no período.</p>
          {summary.data?.parcial && (
            <p className="text-[11px] font-bold text-[var(--text-warning-strong)] uppercase tracking-widest mt-1">
              Período em andamento — números ainda parciais
            </p>
          )}
        </div>
        <PageExportPdfButton sections={allSections} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      <ReportSection
        title="Resumo do período"
        status={summaryStatus}
        onRetry={summary.retry}
        exportConfig={summaryExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Chats no período" value={formatCount(summary.data?.volume.count ?? null)} icon={<MessageSquare size={16} />} />
          <StatTile
            label="1ª resposta (mediana)"
            value={formatSeconds(summary.data?.firstResponse.medianSeconds ?? null)}
            sub={summary.data ? `p90: ${formatSeconds(summary.data.firstResponse.p90Seconds)}` : undefined}
            icon={<Clock size={16} />}
          />
          <StatTile label="% respondido até 2min" value={formatPercentage(summary.data?.pct2min.percentage ?? null)} icon={<Percent size={16} />} />
          <StatTile label="Duração (mediana)" value={formatMinutes(summary.data?.duration.medianMinutes ?? null)} icon={<Timer size={16} />} />
          <StatTile label="Mensagens por chat" value={formatAverage(summary.data?.msgsPorChat.average ?? null)} icon={<MessageSquare size={16} />} />
          <StatTile
            label="Tempo em espera (mediana)"
            value={formatSeconds(summary.data?.waiting.medianSeconds ?? null)}
            sub={summary.data ? `p90: ${formatSeconds(summary.data.waiting.p90Seconds)}` : undefined}
            icon={<Hourglass size={16} />}
          />
          <StatTile label="Taxa de abandono" value={formatPercentage(summary.data?.abandono.percentage ?? null)} icon={<TrendingDown size={16} />} />
        </div>
      </ReportSection>

      <ReportSection
        title="Volume por dia"
        status={dayStatus}
        onRetry={volumeByDay.retry}
        exportConfig={volumeByDayExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={volumeByDay.data?.buckets ?? []}>
              <XAxis dataKey="bucketStart" tickFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} />
              <Line type="monotone" dataKey="count" name="Chats" stroke="#4f46e5" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ReportSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ReportSection
          title="Volume por hora do dia"
          subtitle="Horário de Brasília"
          status={volumeByHour.status}
          onRetry={volumeByHour.retry}
          exportConfig={volumeByHourExport}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={filterSummary}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeByHour.data?.buckets ?? []}>
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(h) => `${h}h`} />
                <Bar dataKey="count" name="Chats" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportSection>

        <ReportSection
          title="Volume por dia da semana"
          status={volumeByWeekday.status}
          onRetry={volumeByWeekday.retry}
          exportConfig={volumeByWeekdayExport}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={filterSummary}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(volumeByWeekday.data?.buckets ?? []).map((b) => ({ ...b, label: WEEKDAY_LABELS[b.weekday] }))}>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name="Chats" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportSection>
      </div>

      <ReportSection
        title="Quebra por dimensão"
        subtitle="Fila, instância, canal (WhatsApp × widget) e empresa"
        status={breakdownStatus}
        onRetry={breakdown.retry}
        exportConfig={breakdownExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {DIMENSION_TABS.map((tab) => (
              <button
                key={tab.dimension}
                onClick={() => setActiveDimension(tab.dimension)}
                className={cn(
                  "px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all border",
                  activeDimension === tab.dimension
                    ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                    : "bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:border-indigo-300"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                  <th className="text-left py-2 px-3">{DIMENSION_TABS.find((t) => t.dimension === activeDimension)?.label}</th>
                  <th className="text-right py-2 px-3">Volume</th>
                  <th className="text-right py-2 px-3">1ª resposta (mediana)</th>
                  <th className="text-right py-2 px-3">p90</th>
                  <th className="text-right py-2 px-3">% até 2min</th>
                  <th className="text-right py-2 px-3">Duração (mediana)</th>
                  <th className="text-right py-2 px-3">Msgs/chat</th>
                  <th className="text-right py-2 px-3">Abandono</th>
                </tr>
              </thead>
              <tbody>
                {(breakdown.data?.rows ?? []).map((row) => (
                  <tr key={`${row.segmentId ?? 'null'}`} className="border-b border-[var(--border-default)] last:border-0">
                    <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{row.segmentLabel}</td>
                    <td className="py-3 px-3 text-right">{formatCount(row.volume)}</td>
                    <td className="py-3 px-3 text-right">{formatSeconds(row.firstResponseMedianSeconds)}</td>
                    <td className="py-3 px-3 text-right text-[var(--text-tertiary)]">{formatSeconds(row.firstResponseP90Seconds)}</td>
                    <td className="py-3 px-3 text-right">{formatPercentage(row.pct2min)}</td>
                    <td className="py-3 px-3 text-right">{formatMinutes(row.durationMedianMinutes)}</td>
                    <td className="py-3 px-3 text-right">{formatAverage(row.msgsPorChat)}</td>
                    <td className="py-3 px-3 text-right">{formatPercentage(row.abandonoPercentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ReportSection>
    </div>
  );
}

function StatTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="p-6 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">{label}</p>
        <div className="opacity-50">{icon}</div>
      </div>
      <p className="text-3xl font-bold text-[var(--text-primary)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{sub}</p>}
    </div>
  );
}
