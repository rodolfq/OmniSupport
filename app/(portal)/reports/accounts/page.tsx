'use client';

import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lock, ChevronDown, ChevronUp, AlertTriangle, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, AccountSummaryRow, AccountTopContact, AccountMonthlyBucket } from '@/lib/types';
import { formatPercentage, formatCount, formatAverage } from '@/lib/report-format';
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

// R5 — "Conta/Cliente", mesmo padrão estrutural do R1. Único dos cinco que
// responde pergunta comercial (diretoria/CS), não operacional. Tabela com
// 1 linha por empresa + drill-down (top contatos, evolução mensal) sob
// demanda — não força filtrar 1 empresa por vez pra enxergar a carteira.

function formatMinutosConsumidos(min: number | null): string {
  if (min === null || Number.isNaN(min)) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)}h`;
}

const REPORT_ENDPOINT = '/api/reports/accounts';
const REPORT_ID = 'accounts';
const REPORT_LABEL = 'Conta/Cliente';

const SUMMARY_EXPORT_COLUMNS: ReportExportConfig<any>['columns'] = [
  { key: 'companyName', label: 'Empresa' },
  { key: 'volume', label: 'Volume' },
  { key: 'minutosConsumidos', label: 'Minutos consumidos', format: (v) => formatMinutosConsumidos(v as number | null) },
  { key: 'recorrenciaRate', label: 'Recorrência 72h', format: (v) => formatPercentage(v as number | null) },
  { key: 'positiveRate', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) },
  { key: 'avaliacaoInternaMedia', label: 'Avaliação interna', format: (v) => formatAverage(v as number | null) },
  { key: 'sinalRisco', label: 'Sinal de risco', format: (v) => v ? 'Sim' : 'Não' }
];

export default function ReportAccountsPage() {
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

  const summary = useReportFetch<{ rows: AccountSummaryRow[] }>(REPORT_ENDPOINT, 'summary', filterQs, ready);

  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const detailReady = ready && expandedCompanyId !== null;
  const detail = useReportFetch<{ topContacts: AccountTopContact[]; monthly: AccountMonthlyBucket[] }>(
    REPORT_ENDPOINT, 'detail', filterQs, detailReady, `companyId=${expandedCompanyId ?? ''}`
  );

  const summaryExport: ReportExportConfig = useMemo(() => ({
    title: 'Carteira de contas',
    columns: SUMMARY_EXPORT_COLUMNS,
    rows: summary.data?.rows ?? []
  }), [summary.data]);

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

  const rows = summary.data?.rows ?? [];
  const summaryEmpty = summary.data ? rows.length === 0 : false;
  const summaryStatus: ReportSectionStatus = summary.status === 'ready' && summaryEmpty ? 'empty' : summary.status;
  const risksCount = rows.filter(r => r.sinalRisco).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Conta/Cliente</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">Visão comercial da carteira — diretoria e CS.</p>
          {risksCount > 0 && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl text-xs font-bold border bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20">
              <AlertTriangle size={14} />
              {risksCount} conta{risksCount === 1 ? '' : 's'} com sinal de risco no período
            </div>
          )}
        </div>
        <PageExportPdfButton sections={[summaryExport]} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      <ReportSection
        title="Carteira de contas"
        status={summaryStatus}
        onRetry={summary.retry}
        exportConfig={summaryExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 px-3">Empresa</th>
                <th className="text-right py-2 px-3">Volume</th>
                <th className="text-right py-2 px-3">Minutos consumidos</th>
                <th className="text-right py-2 px-3">Recorrência 72h</th>
                <th className="text-right py-2 px-3">% Satisfação</th>
                <th className="text-right py-2 px-3">Avaliação interna</th>
                <th className="text-left py-2 px-3">Risco</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <React.Fragment key={row.companyId}>
                  <tr
                    className={cn(
                      "border-b border-[var(--border-default)] last:border-0 cursor-pointer hover:bg-[var(--surface-pill)]",
                      row.sinalRisco && "bg-[var(--surface-danger)]/30"
                    )}
                    onClick={() => setExpandedCompanyId(expandedCompanyId === row.companyId ? null : row.companyId)}
                  >
                    <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{row.companyName}</td>
                    <td className="py-3 px-3 text-right">{formatCount(row.volume)}</td>
                    <td className="py-3 px-3 text-right">{formatMinutosConsumidos(row.minutosConsumidos)}</td>
                    <td className="py-3 px-3 text-right">{formatPercentage(row.recorrenciaRate)}</td>
                    <td className="py-3 px-3 text-right">{formatPercentage(row.positiveRate)}</td>
                    <td className="py-3 px-3 text-right">
                      {row.avaliacaoInternaMedia !== null ? (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <Star size={12} fill="currentColor" />
                          <span className="text-[var(--text-secondary)] font-semibold">{formatAverage(row.avaliacaoInternaMedia)}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-3">
                      {row.sinalRisco ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20">
                          <AlertTriangle size={11} /> Risco
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[var(--text-tertiary)]">
                      {expandedCompanyId === row.companyId ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </td>
                  </tr>
                  {expandedCompanyId === row.companyId && (
                    <tr>
                      <td colSpan={8} className="bg-[var(--surface-pill)]/50 px-3 py-4">
                        <AccountDrillDown
                          status={detail.status}
                          topContacts={detail.data?.topContacts ?? []}
                          monthly={detail.data?.monthly ?? []}
                          onRetry={detail.retry}
                          axisColor={axisColor}
                          tooltipStyle={tooltipStyle}
                        />
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

function AccountDrillDown({
  status,
  topContacts,
  monthly,
  onRetry,
  axisColor,
  tooltipStyle
}: {
  status: ReportSectionStatus;
  topContacts: AccountTopContact[];
  monthly: AccountMonthlyBucket[];
  onRetry: () => void;
  axisColor: string;
  tooltipStyle: React.CSSProperties;
}) {
  if (status === 'loading') return <p className="text-xs text-[var(--text-tertiary)]">Carregando detalhe da conta...</p>;
  if (status === 'error') {
    return (
      <p className="text-xs text-[var(--text-danger)]">
        Não foi possível carregar o detalhe.{' '}
        <button onClick={onRetry} className="underline font-bold">Tentar de novo</button>
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Top contatos</p>
        {topContacts.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">Sem contatos no período.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-1.5 px-2">Contato</th>
                <th className="text-right py-1.5 px-2">Chats</th>
                <th className="text-right py-1.5 px-2">Minutos</th>
              </tr>
            </thead>
            <tbody>
              {topContacts.map(c => (
                <tr key={c.customerId} className="border-b border-[var(--border-default)]/50 last:border-0">
                  <td className="py-1.5 px-2 font-semibold text-[var(--text-primary)]">{c.customerName}</td>
                  <td className="py-1.5 px-2 text-right">{c.volume}</td>
                  <td className="py-1.5 px-2 text-right">{formatMinutosConsumidos(c.minutosConsumidos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Evolução mensal</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly}>
              <XAxis dataKey="monthStart" tickFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' })} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: axisColor }} />
              <YAxis yAxisId="volume" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: axisColor }} allowDecimals={false} />
              <YAxis yAxisId="pct" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: axisColor }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line yAxisId="volume" type="monotone" dataKey="volume" name="Volume" stroke="#4f46e5" strokeWidth={2} dot={false} />
              <Line yAxisId="pct" type="monotone" dataKey="positiveRate" name="% Satisfação" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="pct" type="monotone" dataKey="recorrenciaRate" name="% Recorrência" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
