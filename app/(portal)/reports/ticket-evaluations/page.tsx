'use client';

import React, { useMemo, useState } from 'react';
import { Lock, ThumbsUp, ThumbsDown, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';
import {
  MetricsFilterBar,
  MetricsFilterState,
  MetricsPeriodPreset,
  DEFAULT_METRICS_FILTER_STATE,
  isMetricsFilterReady,
  metricsFilterToQueryString
} from '@/components/reports/metrics-filter-bar';
import { StyledSelect } from '@/components/styled-select';
import { ReportSection, ReportSectionStatus } from '@/components/reports/report-section';
import { useReportFetch } from '@/components/reports/use-report-fetch';
import { ReportExportConfig, PageExportPdfButton } from '@/components/reports/export-menu';
import { ReportBackLink } from '@/components/reports/report-back-link';

// Relatório de Avaliação do Chamado (Bom/Ruim + comentário) — distinto do
// relatório de Satisfação (sobre a conversa de chat). Avaliação é por
// chamado, uma só, gravada pelo cliente depois de Concluído.

const REPORT_ENDPOINT = '/api/reports/ticket-evaluations';
const REPORT_ID = 'ticket-evaluations';
const REPORT_LABEL = 'Avaliação do Chamado';

type Rating = 'good' | 'bad';
type RatingFiltro = '' | Rating;

interface AvaliacaoRow {
  id: string;
  ticketId: string;
  ticketNumber: number;
  title: string;
  companyId: string | null;
  companyName: string | null;
  customerName: string | null;
  rating: Rating;
  comment: string | null;
  createdAt: string;
}

interface Report {
  kpis: { total: number; bons: number; ruins: number; percentualBom: number | null };
  avaliacoes: AvaliacaoRow[];
  opcoes: { empresas: { id: string; nome: string }[] };
}

const PERIOD_PRESETS: MetricsPeriodPreset[] = ['month', 'year', 'all', 'custom'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatNumero(n: number): string {
  return `#${String(n).padStart(4, '0')}`;
}

const EXPORT_COLUMNS: ReportExportConfig<AvaliacaoRow>['columns'] = [
  { key: 'ticketNumber', label: 'Chamado', format: (v) => formatNumero(v as number) },
  { key: 'title', label: 'Título' },
  { key: 'companyName', label: 'Empresa', format: (v) => (v as string) || '—' },
  { key: 'customerName', label: 'Avaliado por', format: (v) => (v as string) || '—' },
  { key: 'rating', label: 'Avaliação', format: (v) => (v === 'good' ? 'Bom' : 'Ruim') },
  { key: 'comment', label: 'Comentário', format: (v) => (v as string) || '—' },
  { key: 'createdAt', label: 'Data', format: (v) => formatDateTime(v as string) }
];

export default function ReportTicketEvaluationsPage() {
  const { hasPermission } = useApp();

  const [filter, setFilter] = useState<MetricsFilterState>(DEFAULT_METRICS_FILTER_STATE);
  const [companyId, setCompanyId] = useState('');
  const [rating, setRating] = useState<RatingFiltro>('');
  const [filterSummary, setFilterSummary] = useState('');
  const ready = isMetricsFilterReady(filter);

  const filterQs = useMemo(
    () => [
      metricsFilterToQueryString(filter),
      companyId ? `companyId=${encodeURIComponent(companyId)}` : '',
      rating ? `rating=${rating}` : ''
    ].filter(Boolean).join('&'),
    [filter, companyId, rating]
  );

  const report = useReportFetch<Report>(REPORT_ENDPOINT, 'overview', filterQs, ready);
  const data = report.data;
  const kpis = data?.kpis;
  const avaliacoes = data?.avaliacoes ?? [];

  const status: ReportSectionStatus = report.status === 'ready' && avaliacoes.length === 0 ? 'empty' : report.status;

  const exportConfig: ReportExportConfig<AvaliacaoRow> = { title: 'Avaliação do Chamado', columns: EXPORT_COLUMNS, rows: avaliacoes };

  const ratingLabel = rating === 'good' ? 'Bom' : rating === 'bad' ? 'Ruim' : '';
  const summaryComFiltro = ratingLabel ? `${filterSummary} · Avaliação: ${ratingLabel}` : filterSummary;

  if (!hasPermission(Permission.REPORTS_READ)) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <ThumbsUp size={26} className="text-[var(--accent-text)]" /> Avaliação do Chamado
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Bom ou Ruim + comentário, enviado pelo cliente depois que o chamado é Concluído. Uma avaliação por chamado.
          </p>
        </div>
        <PageExportPdfButton
          sections={[exportConfig]}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={summaryComFiltro}
        />
      </div>

      <MetricsFilterBar
        value={filter}
        onChange={setFilter}
        onFilterSummaryChange={setFilterSummary}
        showScopeFilters={false}
        periods={PERIOD_PRESETS}
      >
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Empresa</label>
          <StyledSelect
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="min-w-[200px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todas as empresas</option>
            {(data?.opcoes.empresas ?? []).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </StyledSelect>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Avaliação</label>
          <StyledSelect
            value={rating}
            onChange={(e) => setRating(e.target.value as RatingFiltro)}
            className="min-w-[160px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todas</option>
            <option value="good">Bom</option>
            <option value="bad">Ruim</option>
          </StyledSelect>
        </div>
      </MetricsFilterBar>

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Chamados avaliados" value={String(kpis.total)} hint="no período" icon={<MessageSquareText size={16} />} tone="neutral" />
          <Kpi
            label="% Bom"
            value={kpis.percentualBom === null ? '—' : `${Math.round(kpis.percentualBom * 100)}%`}
            hint={`${kpis.bons} de ${kpis.total}`}
            icon={<ThumbsUp size={16} />}
            tone={kpis.percentualBom !== null && kpis.percentualBom < 0.7 ? 'danger' : 'good'}
          />
          <Kpi label="Avaliações Bom" value={String(kpis.bons)} hint="chamados" icon={<ThumbsUp size={16} />} tone="good" />
          <Kpi label="Avaliações Ruim" value={String(kpis.ruins)} hint="chamados" icon={<ThumbsDown size={16} />} tone={kpis.ruins > 0 ? 'danger' : 'neutral'} />
        </div>
      )}

      <ReportSection
        title="Avaliações do período"
        subtitle="As Ruim aparecem primeiro — é o que pede ação."
        info="Uma avaliação por chamado, gravada pelo cliente depois que o chamado é Concluído. Não pode ser editada nem excluída."
        status={status}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum chamado avaliado no período selecionado."
        exportConfig={exportConfig}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={summaryComFiltro}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Chamado</th>
                <th className="text-left py-2 pr-3">Empresa</th>
                <th className="text-left py-2 pr-3">Avaliado por</th>
                <th className="text-left py-2 pr-3">Avaliação</th>
                <th className="text-left py-2 pr-3">Comentário</th>
                <th className="text-left py-2">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {avaliacoes.map(a => (
                <tr key={a.id} className="hover:bg-[var(--surface-pill)]/50 transition-colors">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className="text-[10px] font-black text-[var(--accent-text)] tracking-widest">{formatNumero(a.ticketNumber)}</span>
                    <span className="block text-xs font-bold text-[var(--text-primary)] max-w-xs truncate">{a.title}</span>
                  </td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)]">{a.companyName || '—'}</td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)]">{a.customerName || '—'}</td>
                  <td className="py-3 pr-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest',
                      a.rating === 'good'
                        ? 'bg-[var(--surface-success)] text-[var(--text-success)]'
                        : 'bg-[var(--surface-danger)] text-[var(--text-danger)]'
                    )}>
                      {a.rating === 'good' ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}
                      {a.rating === 'good' ? 'Bom' : 'Ruim'}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)] max-w-sm">{a.comment || '—'}</td>
                  <td className="py-3 text-[var(--text-secondary)] whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>
    </div>
  );
}

function Kpi({ label, value, hint, icon, tone }: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone: 'good' | 'danger' | 'neutral';
}) {
  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">
        {icon} {label}
      </div>
      <p className={cn(
        'text-2xl font-black mt-2 tabular-nums',
        tone === 'danger' ? 'text-[var(--text-danger)]' : tone === 'good' ? 'text-[var(--text-success)]' : 'text-[var(--text-primary)]'
      )}>
        {value}
      </p>
      <p className="text-[10px] text-[var(--text-tertiary)] font-medium mt-0.5">{hint}</p>
    </div>
  );
}
