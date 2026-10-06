'use client';

import React, { useMemo, useState } from 'react';
import { Lock, Ticket, AlertTriangle, CheckCircle2, Clock, ShieldAlert, Bug, Timer, Users } from 'lucide-react';
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

// Relatório de Tickets Internos. A regra de 2 dias é calculada no servidor
// (app/api/reports/internal-tickets/route.ts): só sinaliza, não gera pontos.
// Entrega real e atraso vêm gravados no ticket (ao virar Resolvido); QA é manual.

const REPORT_ENDPOINT = '/api/reports/internal-tickets';
const REPORT_ID = 'internal-tickets';
const REPORT_LABEL = 'Tickets Internos';

type Situacao = 'nao_aplica' | 'em_prazo' | 'em_atencao' | 'cumpriu' | 'descumpriu' | 'encerrado';
type FiltroSituacao = '' | 'em_atencao' | 'descumpriu' | 'qa' | 'atrasado';

interface TicketRow {
  id: string;
  numero: number;
  titulo: string;
  status: string;
  subStatus: string | null;
  estrelas: number;
  equipe: string | null;
  responsavel: string | null;
  criadoEm: string;
  entregaReal: string | null;
  qaReprovado: boolean;
  atrasado: boolean;
  encerrado: boolean;
  minutosUteis: number;
  horasUteis: number | null;
  situacaoRegra: Situacao;
}

interface AnalystRow {
  responsavelId: string | null;
  responsavel: string;
  criados: number;
  resolvidos: number;
  noPrazo: number;
  atrasados: number;
  qaReprovados: number;
  emAberto: number;
  emAtencao: number;
  descumpriram: number;
  medianaHorasUteis: number | null;
}

interface InternalReport {
  regra: { estrelasMinimas: number; diasUteis: number; limiteMinutos: number };
  kpis: {
    criados: number;
    resolvidos: number;
    emAberto: number;
    noPrazo: number;
    noPrazoPct: number | null;
    atrasados: number;
    qaReprovados: number;
    emAtencao: number;
    descumpriram: number;
    medianaHorasUteis: number | null;
  };
  analistas: AnalystRow[];
  tickets: TicketRow[];
  opcoes: { equipes: { id: string; nome: string }[]; responsaveis: { id: string; nome: string }[] };
}

const PERIOD_PRESETS: MetricsPeriodPreset[] = ['month', 'year', 'all', 'custom'];

const SITUACAO_LABEL: Record<Situacao, string> = {
  nao_aplica: 'Fora da regra',
  em_prazo: 'Dentro do prazo',
  em_atencao: 'Em atenção: passou do prazo',
  cumpriu: 'Resolvido no prazo',
  descumpriu: 'Resolvido fora do prazo',
  encerrado: 'Encerrado sem Resolvido'
};

const SITUACAO_CLASS: Record<Situacao, string> = {
  nao_aplica: 'bg-[var(--surface-pill)] text-[var(--text-tertiary)] border-[var(--border-default)]',
  em_prazo: 'bg-[var(--surface-pill)] text-[var(--text-secondary)] border-[var(--border-default)]',
  em_atencao: 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20',
  cumpriu: 'bg-[var(--surface-success)] text-[var(--text-success)] border-[var(--text-success)]/20',
  descumpriu: 'bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20',
  encerrado: 'bg-[var(--surface-pill)] text-[var(--text-tertiary)] border-[var(--border-default)]'
};

const FILTRO_LABEL: Record<FiltroSituacao, string> = {
  '': 'Todos os chamados',
  em_atencao: 'Em atenção (passou do prazo)',
  descumpriu: 'Resolvido fora do prazo',
  qa: 'Reprovado em QA',
  atrasado: 'Com atraso na entrega'
};

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
}

function formatHoras(horas: number | null): string {
  return horas === null ? '—' : `${horas.toFixed(1).replace('.', ',')} h`;
}

function formatNumero(n: number): string {
  return `INT-${String(n).padStart(4, '0')}`;
}

function regraTexto(estrelas: number): string {
  return `${estrelas} ${estrelas === 1 ? 'estrela' : 'estrelas'} ou mais`;
}

const EXPORT_ANALISTAS: ReportExportConfig<AnalystRow>['columns'] = [
  { key: 'responsavel', label: 'Responsável' },
  { key: 'criados', label: 'Criados' },
  { key: 'resolvidos', label: 'Resolvidos' },
  { key: 'noPrazo', label: 'Resolvidos no prazo' },
  { key: 'atrasados', label: 'Com atraso' },
  { key: 'qaReprovados', label: 'Reprovados em QA' },
  { key: 'emAberto', label: 'Em aberto' },
  { key: 'emAtencao', label: 'Em atenção (regra 2 dias)' },
  { key: 'descumpriram', label: 'Resolvidos fora do prazo' },
  { key: 'medianaHorasUteis', label: 'Mediana até Resolvido (h úteis)', format: (v) => formatHoras(v as number | null) }
];

const EXPORT_TICKETS: ReportExportConfig<TicketRow>['columns'] = [
  { key: 'numero', label: 'Número', format: (v) => formatNumero(v as number) },
  { key: 'titulo', label: 'Título' },
  { key: 'status', label: 'Status' },
  { key: 'subStatus', label: 'Sub-status', format: (v) => (v as string) || '—' },
  { key: 'estrelas', label: 'Prioridade (estrelas)' },
  { key: 'equipe', label: 'Equipe', format: (v) => (v as string) || '—' },
  { key: 'responsavel', label: 'Responsável', format: (v) => (v as string) || 'Sem responsável' },
  { key: 'criadoEm', label: 'Criado em', format: (v) => formatDate(v as string) },
  { key: 'entregaReal', label: 'Entrega real', format: (v) => formatDate(v as string | null) },
  { key: 'qaReprovado', label: 'Reprovado em QA', format: (v) => (v ? 'Sim' : 'Não') },
  { key: 'atrasado', label: 'Com atraso', format: (v) => (v ? 'Sim' : 'Não') },
  { key: 'horasUteis', label: 'Horas úteis até Resolvido', format: (v) => formatHoras(v as number | null) },
  { key: 'situacaoRegra', label: 'Regra de 2 dias', format: (v) => SITUACAO_LABEL[v as Situacao] }
];

export default function ReportInternalTicketsPage() {
  const { hasPermission } = useApp();

  const [filter, setFilter] = useState<MetricsFilterState>(DEFAULT_METRICS_FILTER_STATE);
  const [teamId, setTeamId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [filtro, setFiltro] = useState<FiltroSituacao>('');
  const [filterSummary, setFilterSummary] = useState('');
  const ready = isMetricsFilterReady(filter);

  // Equipe e responsável entram na querystring: o servidor filtra e recalcula
  // KPIs e tabela. O filtro de situação é só visual (lista), não muda os números.
  const filterQs = useMemo(
    () => [
      metricsFilterToQueryString(filter),
      teamId ? `teamId=${encodeURIComponent(teamId)}` : '',
      assigneeId ? `assigneeId=${encodeURIComponent(assigneeId)}` : ''
    ].filter(Boolean).join('&'),
    [filter, teamId, assigneeId]
  );

  const report = useReportFetch<InternalReport>(REPORT_ENDPOINT, 'overview', filterQs, ready);
  const data = report.data;
  const kpis = data?.kpis;
  const analistas = data?.analistas ?? [];
  const tickets = data?.tickets ?? [];

  const ticketsFiltrados = useMemo(() => {
    switch (filtro) {
      case 'em_atencao': return tickets.filter(t => t.situacaoRegra === 'em_atencao');
      case 'descumpriu': return tickets.filter(t => t.situacaoRegra === 'descumpriu');
      case 'qa': return tickets.filter(t => t.qaReprovado);
      case 'atrasado': return tickets.filter(t => t.atrasado);
      default: return tickets;
    }
  }, [tickets, filtro]);

  const analistStatus: ReportSectionStatus = report.status === 'ready' && analistas.length === 0 ? 'empty' : report.status;
  const ticketStatus: ReportSectionStatus = report.status === 'ready' && ticketsFiltrados.length === 0 ? 'empty' : report.status;

  const exportAnalistas: ReportExportConfig<AnalystRow> = { title: 'Tickets internos por responsável', columns: EXPORT_ANALISTAS, rows: analistas };
  const exportTickets: ReportExportConfig<TicketRow> = { title: 'Tickets internos do período', columns: EXPORT_TICKETS, rows: ticketsFiltrados };

  const summaryComFiltro = filtro ? `${filterSummary} · Filtro: ${FILTRO_LABEL[filtro]}` : filterSummary;

  if (!hasPermission(Permission.REPORTS_INTERNAL)) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-[var(--surface-card)] rounded-2xl shadow-lg border border-[var(--border-default)]">
          <Lock size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-[var(--text-secondary)] mb-2">Acesso Negado</h2>
          <p className="text-[var(--text-tertiary)]">Você não tem permissão para ver o relatório de tickets internos.</p>
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
            <Ticket size={26} className="text-[var(--accent-text)]" /> Tickets Internos
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Entrega, atraso, reprovação de QA e a regra de 2 dias do time de desenvolvimento.
          </p>
          {data && kpis && kpis.emAtencao > 0 && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-xl text-xs font-bold border bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20">
              <AlertTriangle size={14} />
              {kpis.emAtencao} ticket{kpis.emAtencao === 1 ? '' : 's'} passou{kpis.emAtencao === 1 ? '' : 'aram'} do prazo da regra de 2 dias
            </div>
          )}
        </div>
        <PageExportPdfButton
          sections={[exportAnalistas, exportTickets]}
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
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Equipe</label>
          <StyledSelect
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todas as equipes</option>
            {(data?.opcoes.equipes ?? []).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </StyledSelect>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Responsável</label>
          <StyledSelect
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="min-w-[180px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            <option value="">Todos os responsáveis</option>
            {(data?.opcoes.responsaveis ?? []).map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </StyledSelect>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Lista de chamados</label>
          <StyledSelect
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroSituacao)}
            className="min-w-[220px] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-[var(--accent)]/20 outline-none"
          >
            {(Object.keys(FILTRO_LABEL) as FiltroSituacao[]).map(f => (
              <option key={f || 'todos'} value={f}>{FILTRO_LABEL[f]}</option>
            ))}
          </StyledSelect>
        </div>
      </MetricsFilterBar>

      {data && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
          <span className="font-black text-[var(--text-primary)]">Regra de 2 dias vigente:</span>{' '}
          tickets com prioridade de {regraTexto(data.regra.estrelasMinimas)} precisam virar <strong>Resolvido</strong> em até{' '}
          <strong>{data.regra.diasUteis} {data.regra.diasUteis === 1 ? 'dia útil' : 'dias úteis'}</strong> (08h às 18h, seg a sex).
          A regra só sinaliza: não gera pontos. Ajuste em Configurações &gt; Pontuação do Ranking &gt; Ticket interno.
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Criados" value={String(kpis.criados)} hint={`${kpis.emAberto} em aberto agora`} icon={<Ticket size={16} />} tone="neutral" />
          <Kpi label="Resolvidos" value={String(kpis.resolvidos)} hint={kpis.medianaHorasUteis === null ? 'sem resolvidos no período' : `mediana ${formatHoras(kpis.medianaHorasUteis)} úteis até Resolvido`} icon={<CheckCircle2 size={16} />} tone="neutral" />
          <Kpi
            label="Entregues no prazo"
            value={kpis.noPrazoPct === null ? '—' : `${Math.round(kpis.noPrazoPct * 100)}%`}
            hint={`${kpis.noPrazo} de ${kpis.resolvidos} resolvidos · ${kpis.atrasados} com atraso`}
            icon={<Clock size={16} />}
            tone={kpis.noPrazoPct !== null && kpis.noPrazoPct < 0.7 ? 'danger' : 'good'}
          />
          <Kpi label="Atrasos na entrega" value={String(kpis.atrasados)} hint="resolvidos depois do SLA" icon={<Timer size={16} />} tone={kpis.atrasados > 0 ? 'danger' : 'neutral'} />
          <Kpi label="Regra de 2 dias: em atenção" value={String(kpis.emAtencao)} hint="em aberto e já passou do prazo" icon={<ShieldAlert size={16} />} tone={kpis.emAtencao > 0 ? 'danger' : 'neutral'} />
          <Kpi label="Resolvidos fora do prazo" value={String(kpis.descumpriram)} hint="regra de 2 dias descumprida" icon={<AlertTriangle size={16} />} tone={kpis.descumpriram > 0 ? 'danger' : 'neutral'} />
          <Kpi label="Reprovados em QA" value={String(kpis.qaReprovados)} hint="indicativo, sem pontuação" icon={<Bug size={16} />} tone={kpis.qaReprovados > 0 ? 'danger' : 'neutral'} />
          <Kpi label="Responsáveis" value={String(analistas.filter(a => a.responsavelId).length)} hint="com ticket no período" icon={<Users size={16} />} tone="neutral" />
        </div>
      )}

      <ReportSection
        title="Por responsável"
        subtitle="Quem carrega o time: entregas, atrasos, QA e a regra de 2 dias."
        info="Mediana em horas úteis (08h às 18h, seg a sex) entre criação e o primeiro Resolvido. Responsável sem ticket no período não aparece."
        status={analistStatus}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum ticket interno criado no período selecionado."
        exportConfig={exportAnalistas}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={summaryComFiltro}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Responsável</th>
                <th className="text-right py-2 pr-3">Criados</th>
                <th className="text-right py-2 pr-3">Resolvidos</th>
                <th className="text-right py-2 pr-3">No prazo</th>
                <th className="text-right py-2 pr-3">Atrasos</th>
                <th className="text-right py-2 pr-3">QA reprovado</th>
                <th className="text-right py-2 pr-3">Em aberto</th>
                <th className="text-right py-2 pr-3">Em atenção</th>
                <th className="text-right py-2 pr-3">Fora do prazo</th>
                <th className="text-right py-2">Mediana (h úteis)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {analistas.map(a => (
                <tr key={a.responsavelId ?? 'sem'} className="hover:bg-[var(--surface-pill)]/50 transition-colors">
                  <td className="py-3 pr-3 font-bold text-[var(--text-primary)]">{a.responsavel}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{a.criados}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{a.resolvidos}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{a.noPrazo}</td>
                  <td className={cn('py-3 pr-3 text-right tabular-nums', a.atrasados > 0 && 'font-bold text-[var(--text-danger)]')}>{a.atrasados}</td>
                  <td className={cn('py-3 pr-3 text-right tabular-nums', a.qaReprovados > 0 && 'font-bold text-[var(--text-danger)]')}>{a.qaReprovados}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{a.emAberto}</td>
                  <td className={cn('py-3 pr-3 text-right tabular-nums', a.emAtencao > 0 && 'font-bold text-[var(--text-danger)]')}>{a.emAtencao}</td>
                  <td className={cn('py-3 pr-3 text-right tabular-nums', a.descumpriram > 0 && 'font-bold text-[var(--text-danger)]')}>{a.descumpriram}</td>
                  <td className="py-3 text-right tabular-nums text-[var(--text-secondary)]">{formatHoras(a.medianaHorasUteis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>

      <ReportSection
        title="Chamados do período"
        subtitle="Em atenção aparecem primeiro. Use a lista de chamados acima para filtrar."
        info="Horas úteis: tempo entre a criação e o primeiro Resolvido; para chamado ainda em aberto, conta até agora. QA reprovado é marcação manual, sem pontuação."
        status={ticketStatus}
        errorMessage={report.error || undefined}
        onRetry={report.retry}
        emptyMessage="Nenhum chamado corresponde ao filtro selecionado."
        exportConfig={exportTickets}
        reportId={REPORT_ID}
        reportLabel={REPORT_LABEL}
        filterSummary={summaryComFiltro}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                <th className="text-left py-2 pr-3">Número</th>
                <th className="text-left py-2 pr-3">Título</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2 pr-3">Prioridade</th>
                <th className="text-left py-2 pr-3">Responsável</th>
                <th className="text-left py-2 pr-3">Criado</th>
                <th className="text-left py-2 pr-3">Entrega real</th>
                <th className="text-left py-2 pr-3">QA</th>
                <th className="text-left py-2 pr-3">Atraso</th>
                <th className="text-right py-2 pr-3">Horas úteis</th>
                <th className="text-left py-2">Regra de 2 dias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {ticketsFiltrados.map(t => (
                <tr key={t.id} className="hover:bg-[var(--surface-pill)]/50 transition-colors">
                  <td className="py-3 pr-3 text-[10px] font-black text-[var(--accent-text)] tracking-widest whitespace-nowrap">{formatNumero(t.numero)}</td>
                  <td className="py-3 pr-3 font-bold text-[var(--text-primary)] max-w-xs truncate">{t.titulo}</td>
                  <td className="py-3 pr-3">
                    <span className="block text-xs font-bold text-[var(--text-secondary)]">{t.status}</span>
                    {t.subStatus && <span className="block text-[10px] text-[var(--text-tertiary)]">{t.subStatus}</span>}
                  </td>
                  <td className="py-3 pr-3 text-[var(--text-warning)] whitespace-nowrap" aria-label={`${t.estrelas} estrelas`}>{'★'.repeat(t.estrelas)}</td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)]">{t.responsavel || 'Sem responsável'}</td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)] whitespace-nowrap">{formatDate(t.criadoEm)}</td>
                  <td className="py-3 pr-3 text-[var(--text-secondary)] whitespace-nowrap">{formatDate(t.entregaReal)}</td>
                  <td className="py-3 pr-3">
                    {t.qaReprovado
                      ? <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest bg-[var(--surface-danger)] text-[var(--text-danger)]">Reprovado</span>
                      : <span className="text-[var(--text-tertiary)]">—</span>}
                  </td>
                  <td className="py-3 pr-3">
                    {!t.entregaReal
                      ? <span className="text-[var(--text-tertiary)]">—</span>
                      : t.atrasado
                        ? <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest bg-[var(--surface-danger)] text-[var(--text-danger)]">Com atraso</span>
                        : <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest bg-[var(--surface-success)] text-[var(--text-success)]">No prazo</span>}
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{formatHoras(t.horasUteis)}</td>
                  <td className="py-3">
                    <span className={cn('inline-block text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest whitespace-nowrap', SITUACAO_CLASS[t.situacaoRegra])}>
                      {SITUACAO_LABEL[t.situacaoRegra]}
                    </span>
                  </td>
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
