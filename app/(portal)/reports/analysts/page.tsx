'use client';

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lock, User, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, AnalystPerformanceRow, AnalystAbsenceBreakdown, TeamMedians, MIN_ANALYST_SAMPLE } from '@/lib/types';
import { formatSeconds, formatPercentage, formatMinutes, formatCount, formatAverage, formatHours } from '@/lib/report-format';
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

// R2 — "Desempenho por Analista", mesmo padrão estrutural do R1. Nunca é um
// ranking 1º-ao-último: cada linha compara contra a MEDIANA do time (linha
// fixa no topo da tabela), não contra as outras linhas. Nomes só aparecem
// reais com reports:individual — sem essa permissão a API já devolve
// "Analista N" anonimizado (exceto a própria linha do usuário logado).

type PerformanceRow = AnalystPerformanceRow;
type AbsenceRow = AnalystAbsenceBreakdown & { isSelf: boolean };

const REPORT_ENDPOINT = '/api/reports/analysts';
const REPORT_ID = 'analysts';
const REPORT_LABEL = 'Desempenho por Analista';

const PERFORMANCE_EXPORT_COLUMNS: ReportExportConfig<any>['columns'] = [
  { key: 'analystName', label: 'Analista' },
  { key: 'chatsPorHoraOnline', label: 'Chats/h online', format: (v) => formatAverage(v as number | null, 2) },
  { key: 'chatsAtendidos', label: 'Chats atendidos' },
  { key: 'horasOnline', label: 'Horas online', format: (v) => formatHours(v as number | null) },
  { key: 'firstResponseMedianSeconds', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
  { key: 'durationMedianMinutes', label: 'Duração mediana (min)', format: (v) => formatMinutes(v as number | null) },
  { key: 'msgsEnviadas', label: 'Msgs enviadas', format: (v) => formatAverage(v as number | null) },
  { key: 'satisfactionPositiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) },
  { key: 'simultaneidadeMedia', label: 'Simultaneidade média', format: (v) => formatAverage(v as number | null, 2) },
  { key: 'simultaneidadePico', label: 'Pico', format: (v) => formatAverage(v as number | null, 0) }
];

export default function ReportAnalystsPage() {
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

  const performance = useReportFetch<{ rows: PerformanceRow[]; teamMedians: TeamMedians }>(REPORT_ENDPOINT, 'performance', filterQs, ready);
  const absences = useReportFetch<{ rows: AbsenceRow[] }>(REPORT_ENDPOINT, 'absences', filterQs, ready);

  const rows = useMemo(() => {
    const list = performance.data?.rows ?? [];
    return [...list].sort((a, b) => (b.chatsPorHoraOnline ?? -1) - (a.chatsPorHoraOnline ?? -1));
  }, [performance.data]);

  const absenceReasons = useMemo(() => {
    const set = new Set<string>();
    (absences.data?.rows ?? []).forEach(r => set.add(r.reason));
    return Array.from(set);
  }, [absences.data]);

  const absenceChartData = useMemo(() => {
    const byAnalyst = new Map<string, Record<string, any>>();
    (absences.data?.rows ?? []).forEach(r => {
      const entry = byAnalyst.get(r.analystId) ?? { analystName: r.analystName };
      entry[r.reason] = r.hours;
      byAnalyst.set(r.analystId, entry);
    });
    return Array.from(byAnalyst.values());
  }, [absences.data]);

  const performanceExport: ReportExportConfig = useMemo(() => {
    const medians = performance.data?.teamMedians;
    const medianRow = medians ? [{ analystName: 'Mediana do time', ...medians }] : [];
    return { title: 'Chats por hora online', columns: PERFORMANCE_EXPORT_COLUMNS, rows: [...medianRow, ...rows] };
  }, [performance.data, rows]);

  const absencesExport: ReportExportConfig = useMemo(() => ({
    title: 'Tempo online × ausente',
    columns: [
      { key: 'analystName', label: 'Analista' },
      { key: 'reason', label: 'Motivo' },
      { key: 'hours', label: 'Horas', format: (v) => formatHours(v as number | null) }
    ],
    rows: absences.data?.rows ?? []
  }), [absences.data]);

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

  const performanceEmpty = performance.data ? rows.length === 0 : false;
  const performanceStatus: ReportSectionStatus = performance.status === 'ready' && performanceEmpty ? 'empty' : performance.status;
  const absenceEmpty = absences.data ? absences.data.rows.length === 0 : false;
  const absenceStatus: ReportSectionStatus = absences.status === 'ready' && absenceEmpty ? 'empty' : absences.status;
  const medians = performance.data?.teamMedians;
  const allSections = [performanceExport, absencesExport];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Desempenho por Analista</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Cada linha compara contra a mediana do time — não é um ranking. Analistas com menos de {MIN_ANALYST_SAMPLE} chats no período têm amostra marcada como insuficiente.
          </p>
        </div>
        <PageExportPdfButton sections={allSections} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      <ReportSection
        title="Chats por hora online — indicador principal"
        subtitle="Normaliza volume pelo tempo realmente disponível de cada analista"
        status={performanceStatus}
        onRetry={performance.retry}
        exportConfig={performanceExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 px-3">Analista</th>
                <th className="text-right py-2 px-3">Chats/h online</th>
                <th className="text-right py-2 px-3">Chats atendidos</th>
                <th className="text-right py-2 px-3">Horas online</th>
                <th className="text-right py-2 px-3">1ª resposta (mediana)</th>
                <th className="text-right py-2 px-3">Duração (mediana)</th>
                <th className="text-right py-2 px-3">Msgs enviadas</th>
                <th className="text-right py-2 px-3">% Satisfação</th>
                <th className="text-right py-2 px-3">Simultaneidade média</th>
                <th className="text-right py-2 px-3">Pico</th>
              </tr>
            </thead>
            <tbody>
              {medians && (
                <tr className="border-b-2 border-[var(--accent)]/30 bg-[var(--accent)]/5 font-bold">
                  <td className="py-3 px-3 text-[var(--accent-text)] flex items-center gap-1.5">
                    <Gauge size={13} /> Mediana do time
                  </td>
                  <td className="py-3 px-3 text-right">{formatAverage(medians.chatsPorHoraOnline, 2)}</td>
                  <td className="py-3 px-3 text-right">{formatAverage(medians.chatsAtendidos, 0)}</td>
                  <td className="py-3 px-3 text-right">{formatHours(medians.horasOnline)}</td>
                  <td className="py-3 px-3 text-right">{formatSeconds(medians.firstResponseMedianSeconds)}</td>
                  <td className="py-3 px-3 text-right">{formatMinutes(medians.durationMedianMinutes)}</td>
                  <td className="py-3 px-3 text-right">{formatAverage(medians.msgsEnviadas)}</td>
                  <td className="py-3 px-3 text-right">{formatPercentage(medians.satisfactionPositiveRate)}</td>
                  <td className="py-3 px-3 text-right">{formatAverage(medians.simultaneidadeMedia, 2)}</td>
                  <td className="py-3 px-3 text-right">{formatAverage(medians.simultaneidadePico, 0)}</td>
                </tr>
              )}
              {rows.map(row => (
                <tr
                  key={row.analystId}
                  className={cn(
                    "border-b border-[var(--border-default)] last:border-0",
                    row.isSelf && "bg-[var(--accent)]/5"
                  )}
                >
                  <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">
                    <span className="inline-flex items-center gap-1.5">
                      <User size={13} className="text-[var(--text-tertiary)]" />
                      {row.analystName}
                      {row.isSelf && <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--accent-text)]">você</span>}
                    </span>
                  </td>
                  {row.amostraInsuficiente ? (
                    <td colSpan={9} className="py-3 px-3 text-right text-[var(--text-tertiary)] italic">
                      Amostra insuficiente ({formatCount(row.chatsAtendidos)} chat{row.chatsAtendidos === 1 ? '' : 's'} no período)
                    </td>
                  ) : (
                    <>
                      <td className={cn(
                        "py-3 px-3 text-right font-bold",
                        medians && row.chatsPorHoraOnline !== null && medians.chatsPorHoraOnline !== null
                          ? (row.chatsPorHoraOnline >= medians.chatsPorHoraOnline ? "text-[var(--text-success)]" : "text-[var(--text-warning-strong)]")
                          : undefined
                      )}>
                        {formatAverage(row.chatsPorHoraOnline, 2)}
                      </td>
                      <td className="py-3 px-3 text-right">{formatCount(row.chatsAtendidos)}</td>
                      <td className="py-3 px-3 text-right">{formatHours(row.horasOnline)}</td>
                      <td className="py-3 px-3 text-right">{formatSeconds(row.firstResponseMedianSeconds)}</td>
                      <td className="py-3 px-3 text-right">{formatMinutes(row.durationMedianMinutes)}</td>
                      <td className="py-3 px-3 text-right">{formatAverage(row.msgsEnviadas)}</td>
                      <td className="py-3 px-3 text-right">{formatPercentage(row.satisfactionPositiveRate)}</td>
                      <td className="py-3 px-3 text-right">{formatAverage(row.simultaneidadeMedia, 2)}</td>
                      <td className="py-3 px-3 text-right">{formatAverage(row.simultaneidadePico, 0)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      <ReportSection
        title="Tempo online × ausente"
        subtitle="Horas ausentes por motivo, no período"
        status={absenceStatus}
        onRetry={absences.retry}
        exportConfig={absencesExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={absenceChartData}>
              <XAxis dataKey="analystName" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} unit="h" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}h`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {absenceReasons.map((reason, i) => (
                <Bar key={reason} dataKey={reason} stackId="absence" fill={ABSENCE_COLORS[i % ABSENCE_COLORS.length]} radius={i === absenceReasons.length - 1 ? [4, 4, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ReportSection>
    </div>
  );
}

const ABSENCE_COLORS = ['#f59e0b', '#ef4444', '#6366f1', '#22c55e', '#0ea5e9', '#a855f7'];
