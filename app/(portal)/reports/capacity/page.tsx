'use client';

import React, { useMemo, useState } from 'react';
import { Bar, Line, ComposedChart, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, CapacityHourSummary, CapacityRawBucket, KpiStatus } from '@/lib/types';
import { formatAverage } from '@/lib/report-format';
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

// R3 — "Carga e Capacidade", mesmo padrão estrutural do R1. Responde "a
// escala cobre a demanda?" com um resumo por hora-do-dia (0-23), a partir da
// mesma query bruta usada pelo drill-down por faixa (dados rastreáveis até
// a linha de origem — resumo por dia daquela hora).

const STATUS_LABEL: Record<KpiStatus, string> = { good: 'Cobertura OK', warning: 'Atenção', danger: 'Crítico' };
const STATUS_BADGE_CLASSES: Record<KpiStatus, string> = {
  good: 'bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20',
  warning: 'bg-[var(--surface-warning)] text-[var(--text-warning-strong)] border-[var(--text-warning-strong)]/20',
  danger: 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20'
};
const STATUS_DOT_CLASSES: Record<KpiStatus, string> = {
  good: 'bg-[var(--text-success)]',
  warning: 'bg-[var(--text-warning-strong)]',
  danger: 'bg-[var(--text-danger)]'
};
const STATUS_RANK: Record<KpiStatus, number> = { good: 0, warning: 1, danger: 2 };

const REPORT_ENDPOINT = '/api/reports/capacity';
const REPORT_ID = 'capacity';
const REPORT_LABEL = 'Carga e Capacidade';

const HOUR_EXPORT_COLUMNS: ReportExportConfig<any>['columns'] = [
  { key: 'hour', label: 'Hora', format: (v) => `${v}h` },
  { key: 'cargaSimultaneaMediana', label: 'Carga simultânea (mediana)', format: (v) => formatAverage(v as number | null, 1) },
  { key: 'analistasOnlineMediana', label: 'Analistas online (mediana)', format: (v) => formatAverage(v as number | null, 1) },
  { key: 'cargaPorAnalistaMediana', label: 'Carga/analista (mediana)', format: (v) => formatAverage(v as number | null, 2) },
  { key: 'picoIndividualMediana', label: 'Pico individual (mediana)', format: (v) => formatAverage(v as number | null, 1) },
  { key: 'diasCriticos', label: 'Dias críticos' },
  { key: 'diasAmostrados', label: 'Dias amostrados' },
  { key: 'status', label: 'Status' }
];

export default function ReportCapacityPage() {
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

  const byHour = useReportFetch<{ hours: CapacityHourSummary[] }>(REPORT_ENDPOINT, 'by-hour', filterQs, ready);

  const [expandedHour, setExpandedHour] = useState<number | null>(null);
  const rawReady = ready && expandedHour !== null;
  const raw = useReportFetch<{ rows: CapacityRawBucket[] }>(REPORT_ENDPOINT, 'raw', filterQs, rawReady, `hour=${expandedHour ?? 0}`);

  const hours = byHour.data?.hours ?? [];
  const worstStatus: KpiStatus | null = hours.length > 0
    ? hours.reduce((worst, h) => (STATUS_RANK[h.status] > STATUS_RANK[worst] ? h.status : worst), 'good' as KpiStatus)
    : null;

  const hourExport: ReportExportConfig = useMemo(() => ({
    title: 'Carga e capacidade por hora do dia',
    columns: HOUR_EXPORT_COLUMNS,
    rows: hours
  }), [hours]);

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

  const byHourEmpty = byHour.data ? hours.every(h => h.diasAmostrados === 0) : false;
  const byHourStatus: ReportSectionStatus = byHour.status === 'ready' && byHourEmpty ? 'empty' : byHour.status;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Carga e Capacidade</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">A escala cobre a demanda?</p>
          {worstStatus && (
            <div className={cn("inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl text-xs font-bold border", STATUS_BADGE_CLASSES[worstStatus])}>
              <span className={cn("w-2 h-2 rounded-full", STATUS_DOT_CLASSES[worstStatus])} />
              {STATUS_LABEL[worstStatus]}
            </div>
          )}
        </div>
        <PageExportPdfButton sections={[hourExport]} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      <ReportSection
        title="Carga simultânea × analistas online, por hora do dia"
        subtitle="Horário de Brasília"
        status={byHourStatus}
        onRetry={byHour.retry}
        exportConfig={hourExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hours}>
              <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(h) => `${h}h`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="cargaSimultaneaMediana" name="Carga simultânea (mediana)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              <Bar dataKey="analistasOnlineMediana" name="Analistas online (mediana)" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="picoIndividualMediana" name="Pico individual (mediana)" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ReportSection>

      <ReportSection
        title="Resumo por faixa horária"
        status={byHourStatus}
        onRetry={byHour.retry}
        exportConfig={hourExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 px-3">Hora</th>
                <th className="text-right py-2 px-3">Carga simultânea</th>
                <th className="text-right py-2 px-3">Analistas online</th>
                <th className="text-right py-2 px-3">Carga/analista</th>
                <th className="text-right py-2 px-3">Pico individual</th>
                <th className="text-right py-2 px-3">Dias críticos</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {hours.map(h => (
                <React.Fragment key={h.hour}>
                  <tr
                    className={cn(
                      "border-b border-[var(--border-default)] last:border-0 cursor-pointer hover:bg-[var(--surface-pill)]",
                      h.status === 'danger' && "bg-[var(--surface-danger)]/40"
                    )}
                    onClick={() => setExpandedHour(expandedHour === h.hour ? null : h.hour)}
                  >
                    <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{h.hour}h</td>
                    <td className="py-3 px-3 text-right">{formatAverage(h.cargaSimultaneaMediana, 1)}</td>
                    <td className="py-3 px-3 text-right">{formatAverage(h.analistasOnlineMediana, 1)}</td>
                    <td className="py-3 px-3 text-right font-bold">{formatAverage(h.cargaPorAnalistaMediana, 2)}</td>
                    <td className="py-3 px-3 text-right">{formatAverage(h.picoIndividualMediana, 1)}</td>
                    <td className="py-3 px-3 text-right">{h.diasCriticos} de {h.diasAmostrados}</td>
                    <td className="py-3 px-3">
                      <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border", STATUS_BADGE_CLASSES[h.status])}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT_CLASSES[h.status])} />
                        {STATUS_LABEL[h.status]}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[var(--text-tertiary)]">
                      {expandedHour === h.hour ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                  </tr>
                  {expandedHour === h.hour && (
                    <tr>
                      <td colSpan={8} className="bg-[var(--surface-pill)]/50 px-3 py-4">
                        <DrillDown status={raw.status} rows={raw.data?.rows ?? []} onRetry={raw.retry} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>
    </div>
  );
}

function DrillDown({ status, rows, onRetry }: { status: ReportSectionStatus; rows: CapacityRawBucket[]; onRetry: () => void }) {
  if (status === 'loading') return <p className="text-xs text-[var(--text-tertiary)]">Carregando dados brutos...</p>;
  if (status === 'error') {
    return (
      <p className="text-xs text-[var(--text-danger)]">
        Não foi possível carregar os dados brutos.{' '}
        <button onClick={onRetry} className="underline font-bold">Tentar de novo</button>
      </p>
    );
  }
  if (rows.length === 0) return <p className="text-xs text-[var(--text-tertiary)]">Sem dados nessa faixa, no período.</p>;

  return (
    <div className="overflow-x-auto">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Dado bruto por dia — origem da mediana acima</p>
      <table className="w-full text-xs min-w-[500px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
            <th className="text-left py-1.5 px-2">Data</th>
            <th className="text-right py-1.5 px-2">Carga</th>
            <th className="text-right py-1.5 px-2">Online</th>
            <th className="text-right py-1.5 px-2">Carga/analista</th>
            <th className="text-right py-1.5 px-2">Pico</th>
            <th className="text-left py-1.5 px-2">Crítico</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.bucketStart} className="border-b border-[var(--border-default)]/50 last:border-0">
              <td className="py-1.5 px-2">{new Date(r.dateSp).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
              <td className="py-1.5 px-2 text-right">{r.cargaSimultanea}</td>
              <td className="py-1.5 px-2 text-right">{r.analistasOnline}</td>
              <td className="py-1.5 px-2 text-right">{r.cargaPorAnalista !== null ? r.cargaPorAnalista.toFixed(2) : '—'}</td>
              <td className="py-1.5 px-2 text-right">{r.picoIndividual}</td>
              <td className="py-1.5 px-2">{r.critico ? <span className="text-[var(--text-danger)] font-bold">Sim</span> : 'Não'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
