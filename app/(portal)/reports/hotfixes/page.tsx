'use client';

import React, { useMemo, useState } from 'react';
import { Lock, ChevronDown, ChevronRight, Rocket, AlertTriangle, CheckCircle2, Clock, Package, Link2 } from 'lucide-react';
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

// R6 — "Hotfixes". Mesmo padrão estrutural dos R1-R5.
//
// A tabela é uma linha por hotfix, com drill-down que abre os tickets internos
// e, dentro deles, os chamados de cliente que aquele ticket resolveu. Esse
// aninhamento espelha o caminho real do dado (ver comentário na rota de API):
// o chamado não aponta pro hotfix, ele chega lá pelo ticket interno. Mostrar
// tudo achatado esconderia por qual ticket cada chamado entrou na release.

const REPORT_ENDPOINT = '/api/reports/hotfixes';
const REPORT_ID = 'hotfixes';
const REPORT_LABEL = 'Hotfixes';

type HotfixStatus = 'no_prazo' | 'com_atraso' | 'pendente' | 'pendente_atrasado';

interface LinkedTicket {
  id: string;
  ticketNumber: number;
  title: string;
  status: string;
  isClosed: boolean;
  companyName: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LinkedInternalTicket {
  id: string;
  internalTicketNumber: number;
  title: string;
  status: string;
  isClosed: boolean;
  slaLimit: string | null;
  slaBreached: boolean;
  assigneeName: string | null;
  creatorName: string | null;
  teamName: string | null;
  updatedAt: string;
  tickets: LinkedTicket[];
}

interface HotfixRow {
  id: string;
  name: string;
  description: string | null;
  responsibleName: string | null;
  createdByName: string | null;
  productLabel: string | null;
  expectedDate: string;
  publishedAt: string | null;
  status: HotfixStatus;
  delayDays: number;
  internalTicketCount: number;
  ticketCount: number;
  openTicketCount: number;
  slaBreachedCount: number;
  internalTickets: LinkedInternalTicket[];
}

interface HotfixReport {
  kpis: {
    total: number;
    published: number;
    onTime: number;
    late: number;
    pending: number;
    pendingLate: number;
    onTimeRate: number | null;
    avgDelayDays: number | null;
    maxDelayDays: number | null;
    internalTicketCount: number;
    ticketCount: number;
    slaBreachedCount: number;
  };
  hotfixes: HotfixRow[];
}

// Hotfix é planejamento de release, não histórico de atendimento: faz sentido
// olhar o ano inteiro ou tudo. Fila/instância/empresa não existem nesta
// dimensão, então a barra sobe sem os seletores de escopo.
const PERIOD_PRESETS: MetricsPeriodPreset[] = ['month', 'year', 'all', 'custom'];

const STATUS_LABEL: Record<HotfixStatus, string> = {
  no_prazo: 'Publicado no prazo',
  com_atraso: 'Publicado com atraso',
  pendente: 'Pendente',
  pendente_atrasado: 'Atrasado, não publicado'
};

const STATUS_CLASSES: Record<HotfixStatus, string> = {
  no_prazo: 'bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20',
  com_atraso: 'bg-[var(--surface-warning)] text-[var(--text-warning-strong)] border-[var(--text-warning-strong)]/20',
  pendente: 'bg-[var(--surface-pill)] text-[var(--text-secondary)] border-[var(--border-default)]',
  pendente_atrasado: 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20'
};

function formatDate(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toLocaleDateString('pt-BR');
}

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

// O número de atraso só faz sentido junto do status: 3 dias num publicado é
// "saiu 3 dias depois"; num pendente é "já passou 3 dias da data e não saiu".
function formatDelay(row: HotfixRow): string {
  if (row.status === 'no_prazo') {
    return row.delayDays === 0 ? 'No dia' : `${Math.abs(row.delayDays)}d adiantado`;
  }
  if (row.status === 'com_atraso') return `+${row.delayDays}d`;
  if (row.status === 'pendente_atrasado') return `${row.delayDays}d vencido`;
  return `faltam ${Math.abs(row.delayDays)}d`;
}

const EXPORT_COLUMNS: ReportExportConfig<HotfixRow>['columns'] = [
  { key: 'name', label: 'Hotfix' },
  { key: 'productLabel', label: 'Produto', format: (v) => (v as string) || '—' },
  { key: 'responsibleName', label: 'Responsável', format: (v) => (v as string) || 'Sem responsável' },
  { key: 'expectedDate', label: 'Previsto', format: (v) => formatDate(v as string) },
  { key: 'publishedAt', label: 'Publicado', format: (v) => formatDateTime(v as string | null) },
  { key: 'status', label: 'Situação', format: (v) => STATUS_LABEL[v as HotfixStatus] },
  { key: 'delayDays', label: 'Atraso (dias)' },
  { key: 'internalTicketCount', label: 'Tickets internos' },
  { key: 'ticketCount', label: 'Chamados' },
  { key: 'openTicketCount', label: 'Chamados em aberto' },
  { key: 'slaBreachedCount', label: 'Tickets com SLA estourado' },
  { key: 'description', label: 'Anotações', format: (v) => (v as string) || '—' }
];

export default function ReportHotfixesPage() {
  const { hasPermission } = useApp();

  const [filter, setFilter] = useState<MetricsFilterState>(DEFAULT_METRICS_FILTER_STATE);
  const [situation, setSituation] = useState<'' | HotfixStatus>('');
  const [filterSummary, setFilterSummary] = useState('');
  const ready = isMetricsFilterReady(filter);
  // A situação entra na querystring junto do período — assim ela também
  // recarrega os dados e entra no cabeçalho do PDF exportado.
  const filterQs = useMemo(
    () => `${metricsFilterToQueryString(filter)}${situation ? `&situation=${encodeURIComponent(situation)}` : ''}`,
    [filter, situation]
  );
  const summaryWithSituation = situation
    ? `${filterSummary} · Situação: ${STATUS_LABEL[situation]}`
    : filterSummary;

  // Uma busca só alimenta KPIs e tabela: os dois saem do mesmo encadeamento
  // (hotfix -> ticket interno -> chamado) e separar em duas actions faria o
  // servidor percorrer a mesma junção duas vezes por carga de tela.
  const report = useReportFetch<HotfixReport>(REPORT_ENDPOINT, 'overview', filterQs, ready);

  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = report.data?.hotfixes ?? [];
  const kpis = report.data?.kpis;

  const status: ReportSectionStatus = report.status === 'ready' && rows.length === 0 ? 'empty' : report.status;

  const exportConfig: ReportExportConfig<HotfixRow> = {
    title: 'Hotfixes',
    columns: EXPORT_COLUMNS,
    rows
  };

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
            <Rocket size={26} className="text-[var(--accent-text)]" /> Hotfixes
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Janela de release: o que saiu no prazo, o que atrasou e quais chamados de cliente cada hotfix carregava.
          </p>
          {kpis && kpis.pendingLate > 0 && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl text-xs font-bold border bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20">
              <AlertTriangle size={14} />
              {kpis.pendingLate} hotfix{kpis.pendingLate === 1 ? '' : 'es'} com a data vencida e ainda sem publicação
            </div>
          )}
        </div>
        <PageExportPdfButton
          sections={[exportConfig]}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={summaryWithSituation}
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
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Situação</label>
          <StyledSelect
            value={situation}
            onChange={(e) => setSituation(e.target.value as '' | HotfixStatus)}
            className="min-w-[200px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todas as situações</option>
            {(Object.keys(STATUS_LABEL) as HotfixStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </StyledSelect>
        </div>
      </MetricsFilterBar>

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            label="Publicados no prazo"
            value={kpis.onTimeRate === null ? '—' : `${Math.round(kpis.onTimeRate * 100)}%`}
            hint={`${kpis.onTime} de ${kpis.published} publicados`}
            icon={<CheckCircle2 size={16} />}
            tone={kpis.onTimeRate !== null && kpis.onTimeRate < 0.7 ? 'danger' : 'good'}
          />
          <Kpi
            label="Atraso médio"
            value={kpis.avgDelayDays === null ? '—' : `${kpis.avgDelayDays.toFixed(1)}d`}
            hint={kpis.maxDelayDays !== null ? `pior caso: ${kpis.maxDelayDays}d` : 'nenhum atraso no período'}
            icon={<Clock size={16} />}
            tone={kpis.avgDelayDays !== null && kpis.avgDelayDays > 3 ? 'danger' : 'neutral'}
          />
          <Kpi
            label="Chamados impactados"
            value={String(kpis.ticketCount)}
            hint={`${kpis.internalTicketCount} ticket(s) interno(s) na janela`}
            icon={<Link2 size={16} />}
            tone="neutral"
          />
          <Kpi
            label="Pendentes"
            value={String(kpis.pending)}
            hint={kpis.pendingLate > 0 ? `${kpis.pendingLate} já vencido(s)` : 'nenhum vencido'}
            icon={<Rocket size={16} />}
            tone={kpis.pendingLate > 0 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      <ReportSection
        title="Hotfixes do período"
        subtitle="Clique numa linha para ver os tickets internos e os chamados de cliente vinculados."
        info="O período filtra pela DATA PREVISTA de publicação, não pela data em que saiu — senão um hotfix previsto e nunca publicado desapareceria justamente do relatório que deveria cobrá-lo. Um hotfix aparece com zero chamados quando nenhum ticket interno foi vinculado a ele."
        status={status}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum hotfix com data prevista no período selecionado."
        exportConfig={exportConfig}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={summaryWithSituation}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3 w-6"></th>
                <th className="text-left py-2 pr-3">Hotfix</th>
                <th className="text-left py-2 pr-3">Responsável</th>
                <th className="text-left py-2 pr-3">Previsto</th>
                <th className="text-left py-2 pr-3">Publicado</th>
                <th className="text-left py-2 pr-3">Situação</th>
                <th className="text-right py-2 pr-3">Atraso</th>
                <th className="text-right py-2 pr-3">Internos</th>
                <th className="text-right py-2">Chamados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {rows.map(row => {
                const isOpen = expanded === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : row.id)}
                      className="cursor-pointer hover:bg-[var(--surface-pill)]/50 transition-colors"
                    >
                      <td className="py-3 pr-3 text-[var(--text-tertiary)]">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="py-3 pr-3">
                        <p className="font-bold text-[var(--text-primary)]">{row.name}</p>
                        {row.productLabel && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest mt-0.5">
                            <Package size={10} /> {row.productLabel}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{row.responsibleName || '—'}</td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{formatDate(row.expectedDate)}</td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{formatDateTime(row.publishedAt)}</td>
                      <td className="py-3 pr-3">
                        <span className={cn('inline-block px-2 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest', STATUS_CLASSES[row.status])}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className={cn(
                        'py-3 pr-3 text-right font-bold tabular-nums',
                        row.status === 'com_atraso' || row.status === 'pendente_atrasado'
                          ? 'text-[var(--text-danger)]'
                          : 'text-[var(--text-tertiary)]'
                      )}>
                        {formatDelay(row)}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{row.internalTicketCount}</td>
                      <td className="py-3 text-right tabular-nums font-bold text-[var(--text-primary)]">{row.ticketCount}</td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="bg-[var(--surface-pill)]/30 px-4 py-4">
                          {row.description && (
                            <div className="mb-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-1">Anotações</p>
                              <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{row.description}</p>
                            </div>
                          )}
                          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-2">
                            Tickets internos e chamados vinculados
                          </p>
                          {row.internalTickets.length === 0 ? (
                            <p className="text-xs text-[var(--text-tertiary)] italic">
                              Nenhum ticket interno aponta para este hotfix — sem vínculo, não há como saber quais chamados ele resolveu.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {row.internalTickets.map(it => (
                                <div key={it.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-black text-[var(--accent-text)] uppercase tracking-widest">
                                      INT-{String(it.internalTicketNumber).padStart(4, '0')}
                                    </span>
                                    <span className="text-xs font-bold text-[var(--text-primary)]">{it.title}</span>
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-[var(--border-default)] text-[var(--text-secondary)] uppercase tracking-widest">
                                      {it.status}
                                    </span>
                                    {it.slaBreached && (
                                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-[var(--surface-danger)] text-[var(--text-danger)] uppercase tracking-widest">
                                        SLA estourado
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-widest mt-1">
                                    {it.assigneeName || 'Sem responsável'}
                                    {it.teamName && ` · ${it.teamName}`}
                                    {it.creatorName && ` · Criado por ${it.creatorName}`}
                                  </p>

                                  {it.tickets.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-[var(--border-default)] space-y-1.5">
                                      {it.tickets.map(t => (
                                        <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
                                          <span className="font-black text-[var(--text-tertiary)] tabular-nums">
                                            #{String(t.ticketNumber).padStart(4, '0')}
                                          </span>
                                          <span className="text-[var(--text-secondary)] font-medium">{t.title}</span>
                                          {t.companyName && (
                                            <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">
                                              {t.companyName}
                                            </span>
                                          )}
                                          <span className={cn(
                                            'text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border',
                                            t.isClosed
                                              ? 'bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20'
                                              : 'bg-[var(--surface-warning)] text-[var(--text-warning-strong)] border-[var(--text-warning-strong)]/20'
                                          )}>
                                            {t.status}
                                          </span>
                                          {t.assigneeName && (
                                            <span className="text-[10px] text-[var(--text-tertiary)] font-bold">{t.assigneeName}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
