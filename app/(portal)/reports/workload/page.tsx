'use client';

import React, { useMemo, useState } from 'react';
import { Lock, Gauge, AlertTriangle, Layers, Bug, Link2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApp } from '@/app/app-context';
import { Permission } from '@/lib/types';
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
import { UserAvatar } from '@/components/user-avatar';
import { useProfilesLiteQuery } from '@/lib/query-hooks';

// R7 — "Carga e Complexidade", sobre TICKETS INTERNOS (trabalho do time de
// desenvolvimento). Mesmo padrão estrutural dos R1-R6.
//
// A tese do relatório: contar ticket por cabeça é injusto e fácil de burlar
// (premia quem pega os fáceis). Aqui a carga é PONDERADA pelo esforço
// classificado, e a dificuldade é medida por um índice objetivo, calculado de
// sinais que o sistema já registra — ver lib/services/complexity-service.ts.

const REPORT_ENDPOINT = '/api/reports/workload';
const REPORT_ID = 'workload';
const REPORT_LABEL = 'Carga e Complexidade';

type Band = 'baixa' | 'media' | 'alta';

interface AssigneeRow {
  assigneeId: string | null;
  assigneeName: string;
  teamName: string | null;
  total: number;
  open: number;
  closed: number;
  weightedOpenLoad: number;
  avgComplexity: number | null;
  highComplexity: number;
  classificationRate: number;
  defects: number;
  slaBreached: number;
}

interface ComplexTicketRow {
  id: string;
  internalTicketNumber: number;
  title: string;
  status: string;
  isClosed: boolean;
  assigneeName: string | null;
  teamName: string | null;
  hotfixName: string | null;
  score: number;
  band: Band;
  messageCount: number;
  participantCount: number;
  linkedTicketCount: number;
  durationDays: number;
  slaBreached: boolean;
  effortLabel: string | null;
  outcomeLabel: string | null;
}

interface WorkloadReport {
  kpis: {
    total: number;
    open: number;
    closed: number;
    avgComplexity: number | null;
    highComplexity: number;
    slaBreached: number;
    classificationRate: number;
    defectRate: number | null;
    linkedTicketCount: number;
    teamMedianLoad: number | null;
    teamMedianComplexity: number | null;
    fallbackWeight: number;
  };
  assignees: AssigneeRow[];
  topComplex: ComplexTicketRow[];
  effortDistribution: { label: string; count: number }[];
  outcomeDistribution: { label: string; count: number }[];
}

const BAND_CLASSES: Record<Band, string> = {
  baixa: 'bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20',
  media: 'bg-[var(--surface-warning)] text-[var(--text-warning-strong)] border-[var(--text-warning-strong)]/20',
  alta: 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20'
};

const BAND_LABEL: Record<Band, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function num(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

const ASSIGNEE_EXPORT_COLUMNS: ReportExportConfig<AssigneeRow>['columns'] = [
  { key: 'assigneeName', label: 'Responsável' },
  { key: 'teamName', label: 'Equipe', format: (v) => (v as string) || '—' },
  { key: 'open', label: 'Em aberto' },
  { key: 'weightedOpenLoad', label: 'Carga ponderada' },
  { key: 'closed', label: 'Concluídos no período' },
  { key: 'avgComplexity', label: 'Complexidade média', format: (v) => num(v as number | null, 1) },
  { key: 'highComplexity', label: 'Tickets de alta complexidade' },
  { key: 'slaBreached', label: 'SLA estourado' },
  { key: 'defects', label: 'Defeitos de produto' },
  { key: 'classificationRate', label: 'Classificação preenchida', format: (v) => pct(v as number) }
];

const COMPLEX_EXPORT_COLUMNS: ReportExportConfig<ComplexTicketRow>['columns'] = [
  { key: 'internalTicketNumber', label: 'Ticket', format: (v) => `INT-${String(v).padStart(4, '0')}` },
  { key: 'title', label: 'Título' },
  { key: 'assigneeName', label: 'Responsável', format: (v) => (v as string) || 'Sem responsável' },
  { key: 'hotfixName', label: 'Hotfix', format: (v) => (v as string) || '—' },
  { key: 'score', label: 'Índice' },
  { key: 'messageCount', label: 'Mensagens' },
  { key: 'participantCount', label: 'Pessoas' },
  { key: 'linkedTicketCount', label: 'Chamados vinculados' },
  { key: 'durationDays', label: 'Dias em aberto' },
  { key: 'slaBreached', label: 'SLA estourado', format: (v) => (v ? 'Sim' : 'Não') },
  { key: 'effortLabel', label: 'Esforço declarado', format: (v) => (v as string) || 'Não classificado' },
  { key: 'outcomeLabel', label: 'Desfecho', format: (v) => (v as string) || 'Não classificado' }
];

export default function ReportWorkloadPage() {
  const { hasPermission } = useApp();
  const { data: profiles } = useProfilesLiteQuery();

  const [filter, setFilter] = useState<MetricsFilterState>(DEFAULT_METRICS_FILTER_STATE);
  const [filterSummary, setFilterSummary] = useState('');
  const ready = isMetricsFilterReady(filter);
  const filterQs = useMemo(() => metricsFilterToQueryString(filter), [filter]);

  // Uma busca alimenta as três seções: todas saem do mesmo cálculo de sinais
  // por ticket, e separar em actions faria o servidor refazer a mesma
  // varredura a cada carga de tela.
  const report = useReportFetch<WorkloadReport>(REPORT_ENDPOINT, 'overview', filterQs, ready);

  const kpis = report.data?.kpis;
  const assignees = report.data?.assignees ?? [];
  const topComplex = report.data?.topComplex ?? [];

  const thumbFor = (name: string) =>
    (profiles || []).find((p: any) => p.name === name)?.avatarThumbUrl || null;

  const assigneeStatus: ReportSectionStatus =
    report.status === 'ready' && assignees.length === 0 ? 'empty' : report.status;
  const complexStatus: ReportSectionStatus =
    report.status === 'ready' && topComplex.length === 0 ? 'empty' : report.status;

  const assigneeExport: ReportExportConfig<AssigneeRow> = {
    title: 'Carga por responsável',
    columns: ASSIGNEE_EXPORT_COLUMNS,
    rows: assignees
  };
  const complexExport: ReportExportConfig<ComplexTicketRow> = {
    title: 'Tickets internos mais complexos',
    columns: COMPLEX_EXPORT_COLUMNS,
    rows: topComplex
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
            <Gauge size={26} className="text-[var(--accent-text)]" /> Carga e Complexidade
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Tickets internos: quem está carregando mais trabalho — não mais linhas na tabela — e o que foi de fato difícil.
          </p>
          {kpis && kpis.classificationRate < 0.5 && kpis.total > 0 && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl text-xs font-bold border bg-[var(--surface-warning)] text-[var(--text-warning-strong)] border-[var(--text-warning-strong)]/20">
              <AlertTriangle size={14} />
              Só {pct(kpis.classificationRate)} dos tickets têm classificação — a carga ponderada ainda é
              majoritariamente estimada (peso {kpis.fallbackWeight} para o que está em branco)
            </div>
          )}
        </div>
        <PageExportPdfButton
          sections={[assigneeExport, complexExport]}
          reportId={REPORT_ID}
          reportLabel={REPORT_LABEL}
          filterSummary={filterSummary}
        />
      </div>

      <MetricsFilterBar value={filter} onChange={setFilter} onFilterSummaryChange={setFilterSummary} />

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Tickets no período" value={String(kpis.total)} hint={`${kpis.open} em aberto · ${kpis.closed} concluídos`} icon={<Layers size={16} />} />
          <Kpi
            label="Complexidade média"
            value={num(kpis.avgComplexity, 1)}
            hint={`${kpis.highComplexity} de alta complexidade`}
            icon={<Gauge size={16} />}
            tone={kpis.avgComplexity !== null && kpis.avgComplexity >= 60 ? 'danger' : 'neutral'}
          />
          <Kpi
            label="SLA estourado"
            value={String(kpis.slaBreached)}
            hint={`${kpis.linkedTicketCount} chamado(s) de cliente vinculado(s)`}
            icon={<Timer size={16} />}
            tone={kpis.slaBreached > 0 ? 'danger' : 'good'}
          />
          <Kpi
            label="Taxa de defeito"
            value={pct(kpis.defectRate)}
            hint="dos tickets com desfecho preenchido"
            icon={<Bug size={16} />}
            tone={kpis.defectRate !== null && kpis.defectRate > 0.3 ? 'danger' : 'neutral'}
          />
        </div>
      )}

      <ReportSection
        title="Carga por responsável"
        subtitle="Carga ponderada considera só o que está EM ABERTO — é a pergunta “quem está sobrecarregado agora”."
        info="A carga ponderada soma o peso do Esforço de cada ticket aberto da pessoa (Imediato 1 … Crítico 8, editável em Configurações). Ticket sem classificação entra com o peso mediano, por isso a coluna de classificação preenchida importa: quanto menor, mais a carga é estimativa. A referência é a MEDIANA do time, não uma meta absoluta."
        status={assigneeStatus}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum ticket interno no período selecionado."
        exportConfig={assigneeExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        {kpis && (kpis.teamMedianLoad !== null || kpis.teamMedianComplexity !== null) && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">
            Mediana do time — carga {num(kpis.teamMedianLoad, 1)} · complexidade {num(kpis.teamMedianComplexity, 1)}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Responsável</th>
                <th className="text-right py-2 pr-3">Em aberto</th>
                <th className="text-right py-2 pr-3">Carga ponderada</th>
                <th className="text-right py-2 pr-3">Concluídos</th>
                <th className="text-right py-2 pr-3">Complexidade média</th>
                <th className="text-right py-2 pr-3">Alta compl.</th>
                <th className="text-right py-2 pr-3">SLA</th>
                <th className="text-right py-2">Classificado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {assignees.map(a => {
                const aboveMedian =
                  kpis?.teamMedianLoad != null && a.assigneeId && a.weightedOpenLoad > kpis.teamMedianLoad * 1.5;
                return (
                  <tr key={a.assigneeId || 'none'} className="hover:bg-[var(--surface-pill)]/50 transition-colors">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2">
                        <UserAvatar name={a.assigneeName} thumbUrl={thumbFor(a.assigneeName)} size={22} />
                        <div className="min-w-0">
                          <p className={cn('font-bold truncate', a.assigneeId ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] italic')}>
                            {a.assigneeName}
                          </p>
                          {a.teamName && (
                            <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">{a.teamName}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{a.open}</td>
                    <td className={cn(
                      'py-3 pr-3 text-right tabular-nums font-black',
                      aboveMedian ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]'
                    )}>
                      {a.weightedOpenLoad.toFixed(1)}
                      {aboveMedian && <span className="ml-1 text-[9px] font-black uppercase">↑</span>}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{a.closed}</td>
                    <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{num(a.avgComplexity, 1)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{a.highComplexity}</td>
                    <td className={cn(
                      'py-3 pr-3 text-right tabular-nums',
                      a.slaBreached > 0 ? 'text-[var(--text-danger)] font-bold' : 'text-[var(--text-tertiary)]'
                    )}>
                      {a.slaBreached}
                    </td>
                    <td className="py-3 text-right tabular-nums text-[var(--text-tertiary)]">{pct(a.classificationRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ReportSection>

      <ReportSection
        title="Tickets internos mais complexos"
        subtitle="Índice 0-100 calculado por sinais objetivos, sem depender de ninguém preencher campo."
        info="Composição do índice: mensagens trocadas (25), pessoas distintas envolvidas (15), chamados de cliente vinculados (25), tempo em aberto (20) e SLA estourado (15). Cada sinal contínuo satura num teto para um caso extremo não achatar a escala. Ainda ficam de fora reatribuições e reaberturas — dependem de um histórico de eventos, que o banco não tem. O tempo em aberto usa a última alteração como aproximação da conclusão, já que não existe closed_at."
        status={complexStatus}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum ticket interno no período selecionado."
        exportConfig={complexExport}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Ticket</th>
                <th className="text-left py-2 pr-3">Responsável</th>
                <th className="text-right py-2 pr-3">Índice</th>
                <th className="text-right py-2 pr-3">Msgs</th>
                <th className="text-right py-2 pr-3">Pessoas</th>
                <th className="text-right py-2 pr-3">Chamados</th>
                <th className="text-right py-2 pr-3">Dias</th>
                <th className="text-left py-2">Classificação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {topComplex.map(t => (
                <tr key={t.id} className="hover:bg-[var(--surface-pill)]/50 transition-colors">
                  <td className="py-3 pr-3">
                    <p className="font-bold text-[var(--text-primary)]">
                      <span className="text-[var(--accent-text)] tabular-nums">INT-{String(t.internalTicketNumber).padStart(4, '0')}</span>{' '}
                      {t.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-widest">{t.status}</span>
                      {t.hotfixName && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[var(--surface-danger)] text-[var(--text-danger)]">
                          {t.hotfixName}
                        </span>
                      )}
                      {t.slaBreached && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[var(--surface-danger)] text-[var(--text-danger)]">
                          SLA estourado
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)]">{t.assigneeName || '—'}</td>
                  <td className="py-3 pr-3 text-right">
                    <span className={cn('inline-block px-2 py-1 rounded-full border text-[10px] font-black tabular-nums', BAND_CLASSES[t.band])}>
                      {t.score} · {BAND_LABEL[t.band]}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.messageCount}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.participantCount}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">
                    {t.linkedTicketCount > 0 ? (
                      <span className="inline-flex items-center gap-1"><Link2 size={11} /> {t.linkedTicketCount}</span>
                    ) : '—'}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{t.durationDays.toFixed(1)}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1">
                      {t.effortLabel && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--text-secondary)]">
                          {t.effortLabel}
                        </span>
                      )}
                      {t.outcomeLabel && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent-text)]">
                          {t.outcomeLabel}
                        </span>
                      )}
                      {!t.effortLabel && !t.outcomeLabel && (
                        <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] italic">
                          não classificado
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      <ReportSection
        title="Distribuição da classificação"
        subtitle="O que o time declarou sobre esforço e desfecho no período."
        info="Desfechos marcados como defeito em Configurações são os que alimentam a taxa de defeito. Uma fatia grande de “Orientação/dúvida” costuma indicar lacuna de documentação, não falha de produto."
        status={report.status === 'ready' && (report.data?.effortDistribution.length || 0) + (report.data?.outcomeDistribution.length || 0) === 0 ? 'empty' : report.status}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum ticket classificado no período — os dois campos são preenchidos na conclusão do ticket interno."
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={filterSummary}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Distribution title="Esforço" rows={report.data?.effortDistribution ?? []} />
          <Distribution title="Desfecho" rows={report.data?.outcomeDistribution ?? []} />
        </div>
      </ReportSection>
    </div>
  );
}

function Distribution({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] mb-3">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] italic">Nada classificado ainda.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="text-xs font-bold text-[var(--text-secondary)] w-44 truncate">{r.label}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--surface-pill)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full"
                  style={{ width: `${total ? (r.count / total) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs font-black tabular-nums text-[var(--text-primary)] w-8 text-right">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, icon, tone = 'neutral' }: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'good' | 'danger' | 'neutral';
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
