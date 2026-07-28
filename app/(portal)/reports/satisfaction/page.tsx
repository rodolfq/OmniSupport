'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Lock, ThumbsUp, MessageSquareText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, SatisfactionTrendBucket, SatisfactionDimensionRow, SatisfactionTimeRangeRow, NegativeEvaluationRow, ReportDimension } from '@/lib/types';
import { formatSeconds, formatMinutes, formatPercentage, formatCount } from '@/lib/report-format';
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

// R4 — "Satisfação e Qualidade", mesmo padrão estrutural do R1. Evolui
// app/api/reports/survey/route.ts (não recomeça do zero) — o GET legado
// sem ?action= continua servindo app/(portal)/reports/page.tsx sem mudança.
// Escala de rating (-1/0/1) NUNCA convertida pra 1-5 — decisão em aberto.
// Nomes de analista na quebra por dimensão só com reports:individual.

interface SummaryResponse {
  parcial: boolean;
  totalClosed: number;
  evaluated: number;
  positiveRate: number | null;
  responseRate: number | null;
}

const DIMENSION_TABS: { dimension: ReportDimension; label: string }[] = [
  { dimension: 'queue', label: 'Fila' },
  { dimension: 'analyst', label: 'Analista' },
  { dimension: 'company', label: 'Empresa' }
];

const NEGATIVE_PAGE_SIZE = 20;
const REPORT_ENDPOINT = '/api/reports/survey';
const REPORT_ID = 'satisfaction';
const REPORT_LABEL = 'Satisfação e Qualidade';

export default function ReportSatisfactionPage() {
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
  const trend = useReportFetch<{ buckets: SatisfactionTrendBucket[] }>(REPORT_ENDPOINT, 'trend', filterQs, ready);
  const crosscut = useReportFetch<{ byFirstResponse: SatisfactionTimeRangeRow[]; byDuration: SatisfactionTimeRangeRow[] }>(REPORT_ENDPOINT, 'crosscut', filterQs, ready);

  const [activeDimension, setActiveDimension] = useState<ReportDimension>('queue');
  const breakdown = useReportFetch<{ rows: (SatisfactionDimensionRow & { isSelf: boolean })[] }>(REPORT_ENDPOINT, 'breakdown', filterQs, ready, `dimension=${activeDimension}`);

  const [negativePage, setNegativePage] = useState(0);
  useEffect(() => setNegativePage(0), [filterQs]);
  const negativeQs = `limit=${NEGATIVE_PAGE_SIZE}&offset=${negativePage * NEGATIVE_PAGE_SIZE}`;
  const negatives = useReportFetch<{ rows: NegativeEvaluationRow[]; total: number }>(REPORT_ENDPOINT, 'negative-list', filterQs, ready, negativeQs);

  const summaryExport: ReportExportConfig = useMemo(() => ({
    title: 'Resumo do período',
    columns: [
      { key: 'evaluated', label: 'Avaliados' },
      { key: 'totalClosed', label: 'Encerrados' },
      { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) },
      { key: 'responseRate', label: 'Taxa de resposta', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: summary.data ? [summary.data] : []
  }), [summary.data]);

  const negativesExport: ReportExportConfig = useMemo(() => ({
    title: 'Avaliações negativas',
    columns: [
      { key: 'customerName', label: 'Cliente' },
      { key: 'analystName', label: 'Analista' },
      { key: 'finishedAt', label: 'Encerrado em', format: (v) => new Date(v as string).toLocaleString('pt-BR') },
      { key: 'firstResponseSeconds', label: '1ª resposta (s)', format: (v) => formatSeconds(v as number | null) },
      { key: 'durationSeconds', label: 'Duração (s)', format: (v) => v !== null ? formatMinutes((v as number) / 60) : '—' }
    ],
    rows: negatives.data?.rows ?? []
  }), [negatives.data]);

  const trendExport: ReportExportConfig = useMemo(() => ({
    title: 'Tendência',
    columns: [
      { key: 'bucketStart', label: 'Data', format: (v) => new Date(v as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) },
      { key: 'evaluated', label: 'Avaliados' },
      { key: 'positive', label: 'Positivos' },
      { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: trend.data?.buckets ?? []
  }), [trend.data]);

  const breakdownExport: ReportExportConfig = useMemo(() => ({
    title: `Quebra por dimensão (${DIMENSION_TABS.find(t => t.dimension === activeDimension)?.label})`,
    columns: [
      { key: 'segmentLabel', label: 'Segmento' },
      { key: 'evaluated', label: 'Avaliados' },
      { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) },
      { key: 'responseRate', label: 'Taxa de resposta', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: breakdown.data?.rows ?? []
  }), [breakdown.data, activeDimension]);

  const crosscutFirstResponseExport: ReportExportConfig = useMemo(() => ({
    title: 'Satisfação × tempo de 1ª resposta',
    columns: [
      { key: 'rangeLabel', label: 'Faixa' },
      { key: 'evaluated', label: 'Avaliados' },
      { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: crosscut.data?.byFirstResponse ?? []
  }), [crosscut.data]);

  const crosscutDurationExport: ReportExportConfig = useMemo(() => ({
    title: 'Satisfação × duração do chat',
    columns: [
      { key: 'rangeLabel', label: 'Faixa' },
      { key: 'evaluated', label: 'Avaliados' },
      { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) }
    ],
    rows: crosscut.data?.byDuration ?? []
  }), [crosscut.data]);

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

  const summaryEmpty = summary.data ? summary.data.evaluated === 0 : false;
  const summaryStatus: ReportSectionStatus = summary.status === 'ready' && summaryEmpty ? 'empty' : summary.status;

  const negativesEmpty = negatives.data ? negatives.data.total === 0 : false;
  const negativesStatus: ReportSectionStatus = negatives.status === 'ready' && negativesEmpty ? 'empty' : negatives.status;
  const negativeTotalPages = negatives.data ? Math.max(1, Math.ceil(negatives.data.total / NEGATIVE_PAGE_SIZE)) : 1;

  const breakdownEmpty = breakdown.data ? breakdown.data.rows.length === 0 : false;
  const breakdownStatus: ReportSectionStatus = breakdown.status === 'ready' && breakdownEmpty ? 'empty' : breakdown.status;

  const allSections = [summaryExport, negativesExport, trendExport, breakdownExport, crosscutFirstResponseExport, crosscutDurationExport];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Satisfação e Qualidade</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Escala do sistema: -1 (negativo) / 0 (neutro) / 1 (positivo) — não convertida pra nota 1-5.
          </p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <StatTile label="% Satisfação (positivos/avaliados)" value={formatPercentage(summary.data?.positiveRate ?? null)} icon={<ThumbsUp size={16} />} />
          <StatTile
            label="Taxa de resposta (avaliados/encerrados)"
            value={formatPercentage(summary.data?.responseRate ?? null)}
            sub={summary.data ? `${formatCount(summary.data.evaluated)} de ${formatCount(summary.data.totalClosed)} encerrados` : undefined}
            icon={<MessageSquareText size={16} />}
          />
        </div>
      </ReportSection>

      <ReportSection
        title="Avaliações negativas"
        subtitle="O bloco que gera ação — cada linha tem link direto pra conversa"
        status={negativesStatus}
        onRetry={negatives.retry}
        exportConfig={negativesExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 px-3">Cliente</th>
                <th className="text-left py-2 px-3">Analista</th>
                <th className="text-left py-2 px-3">Encerrado em</th>
                <th className="text-right py-2 px-3">1ª resposta</th>
                <th className="text-right py-2 px-3">Duração</th>
                <th className="text-right py-2 px-3">Conversa</th>
              </tr>
            </thead>
            <tbody>
              {(negatives.data?.rows ?? []).map(row => (
                <tr key={row.historyId} className="border-b border-[var(--border-default)] last:border-0">
                  <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{row.customerName}</td>
                  <td className="py-3 px-3 text-[var(--text-secondary)]">{row.analystName ?? '—'}</td>
                  <td className="py-3 px-3 text-[var(--text-tertiary)]">{new Date(row.finishedAt).toLocaleString('pt-BR')}</td>
                  <td className="py-3 px-3 text-right">{formatSeconds(row.firstResponseSeconds)}</td>
                  <td className="py-3 px-3 text-right">{row.durationSeconds !== null ? formatMinutes(row.durationSeconds / 60) : '—'}</td>
                  <td className="py-3 px-3 text-right">
                    <Link
                      href={`/chat-history?historyId=${row.historyId}`}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent-text)] hover:underline"
                    >
                      Ver conversa <ExternalLink size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {negatives.data && negatives.data.total > NEGATIVE_PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs font-semibold text-[var(--text-tertiary)]">
              Página {negativePage + 1} de {negativeTotalPages} — {negatives.data.total} negativas no período
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNegativePage(p => Math.max(0, p - 1))}
                disabled={negativePage === 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setNegativePage(p => Math.min(negativeTotalPages - 1, p + 1))}
                disabled={negativePage >= negativeTotalPages - 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </ReportSection>

      <ReportSection
        title="Tendência"
        status={trend.status}
        onRetry={trend.retry}
        exportConfig={trendExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend.data?.buckets ?? []}>
              <XAxis dataKey="bucketStart" tickFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} formatter={(v: number) => `${v.toFixed(0)}%`} />
              <Line type="monotone" dataKey="positiveRate" name="% Satisfação" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ReportSection>

      <ReportSection
        title="Quebra por dimensão"
        subtitle="Fila, analista e empresa"
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
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                  <th className="text-left py-2 px-3">{DIMENSION_TABS.find((t) => t.dimension === activeDimension)?.label}</th>
                  <th className="text-right py-2 px-3">Avaliados</th>
                  <th className="text-right py-2 px-3">% Satisfação</th>
                  <th className="text-right py-2 px-3">Taxa de resposta</th>
                </tr>
              </thead>
              <tbody>
                {(breakdown.data?.rows ?? []).map((row) => (
                  <tr key={`${row.segmentId ?? 'null'}`} className={cn("border-b border-[var(--border-default)] last:border-0", row.isSelf && "bg-[var(--accent)]/5")}>
                    <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">
                      {row.segmentLabel}{row.isSelf && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--accent-text)]">você</span>}
                    </td>
                    {row.amostraInsuficiente ? (
                      <td colSpan={3} className="py-3 px-3 text-right text-[var(--text-tertiary)] italic">Amostra insuficiente ({formatCount(row.evaluated)} avaliações)</td>
                    ) : (
                      <>
                        <td className="py-3 px-3 text-right">{formatCount(row.evaluated)}</td>
                        <td className="py-3 px-3 text-right">{formatPercentage(row.positiveRate)}</td>
                        <td className="py-3 px-3 text-right">{formatPercentage(row.responseRate)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </ReportSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <ReportSection
          title="Satisfação × tempo de 1ª resposta"
          subtitle="A nota cai quando o tempo sobe?"
          status={crosscut.status}
          onRetry={crosscut.retry}
          exportConfig={crosscutFirstResponseExport}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={filterSummary}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={crosscut.data?.byFirstResponse ?? []}>
                <XAxis dataKey="rangeLabel" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: axisColor }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(0)}%`} />
                <Bar dataKey="positiveRate" name="% Satisfação" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportSection>

        <ReportSection
          title="Satisfação × duração do chat"
          status={crosscut.status}
          onRetry={crosscut.retry}
          exportConfig={crosscutDurationExport}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={filterSummary}
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={crosscut.data?.byDuration ?? []}>
                <XAxis dataKey="rangeLabel" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: axisColor }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(0)}%`} />
                <Bar dataKey="positiveRate" name="% Satisfação" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ReportSection>
      </div>
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
