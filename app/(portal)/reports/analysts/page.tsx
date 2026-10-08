'use client';

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lock, User, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, AnalystPerformanceRow, AnalystAbsenceBreakdown, TeamMedians, MIN_ANALYST_SAMPLE, TicketAnalystRow, TicketObjetivo, TicketTimeTotals } from '@/lib/types';
import { formatSeconds, formatPercentage, formatMinutes, formatCount, formatAverage, formatHours } from '@/lib/report-format';
import {
  MetricsPeriodPreset,
  MetricsFilterBar,
  MetricsFilterState,
  DEFAULT_METRICS_FILTER_STATE,
  isMetricsFilterReady,
  metricsFilterToQueryString
} from '@/components/reports/metrics-filter-bar';
import { ReportSection, ReportSectionStatus } from '@/components/reports/report-section';
import { useReportFetch } from '@/components/reports/use-report-fetch';
import { ReportExportConfig, PageExportPdfButton, SectionExportButton } from '@/components/reports/export-menu';
import { ReportBackLink } from '@/components/reports/report-back-link';
import { AnalystDashboard } from '@/components/reports/analyst-dashboard';
import { AnalystViewSwitch, AnalystView } from '@/components/reports/analyst-view-switch';
import { TicketAnalystDashboard } from '@/components/reports/ticket-analyst-dashboard';
import { GeneralAnalystDashboard } from '@/components/reports/general-analyst-dashboard';
import { AnalystPresencePanel, PresenceAnalyst } from '@/components/reports/analyst-presence-panel';
import { DEFAULT_POINTS_WEIGHTS, PointsWeights, PointsDataQuality, rankPoints, formatPointsBr } from '@/lib/analyst-points';
import { MultiSelectFilter } from '@/components/multi-select-filter';

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
  { key: 'simultaneidadePico', label: 'Pico', format: (v) => formatAverage(v as number | null, 0) },
  { key: 'intervaloRespostaMedianSeconds', label: 'Intervalo cliente → resposta (s)', format: (v) => formatSeconds(v as number | null) }
];

// Ranking por pontos, na ordem do pódio. Os pontos saem com os pesos vigentes (mesma conta da tela).
const RANKING_EXPORT_COLUMNS: ReportExportConfig<any>['columns'] = [
  { key: 'posicao', label: 'Posição' },
  { key: 'analista', label: 'Analista' },
  { key: 'noRanking', label: 'No ranking' },
  { key: 'pontos', label: 'Pontos', format: (v) => formatPointsBr(v as number) },
  { key: 'pontosVolume', label: 'Pontos de volume', format: (v) => formatPointsBr(v as number) },
  { key: 'good', label: 'Good' },
  { key: 'bad', label: 'Bad' },
  { key: 'lt1', label: 'Resposta < 1 min' },
  { key: 'lt3', label: 'Resposta 1 a 3 min' },
  { key: 'gt3', label: 'Resposta > 3 min' },
  { key: 'chats', label: 'Chats atendidos' },
  { key: 'avaliadas', label: 'Chats avaliados' },
  { key: 'satisfacao', label: '% Satisfação', format: (v) => formatPercentage(v as number | null) },
  { key: 'primeiraResposta', label: '1ª resposta mediana (s)', format: (v) => formatSeconds(v as number | null) },
  { key: 'intervalo', label: 'Intervalo cliente → resposta (s)', format: (v) => formatSeconds(v as number | null) },
  { key: 'horas', label: 'Horas online', format: (v) => formatHours(v as number | null) },
  { key: 'chatsH', label: 'Chats/h online', format: (v) => formatAverage(v as number | null, 2) }
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
  const [view, setView] = useState<AnalystView>('chat');
  // "Apenas analistas selecionados" (pedido do usuário, 2026-10-08) — pra
  // comparar só quem interessa, sem o resto do time "poluindo" pódio/
  // ranking/tabela. Puramente client-side (filtra as linhas já carregadas,
  // não refaz a consulta): os agregados de time inteiro (Mediana do time,
  // Objetivos da área/Base da avaliação da visão Chamado) continuam sobre
  // TODO o time mesmo com seleção ativa — são medianas/percentuais vindos
  // prontos do servidor, recalcular só pro subconjunto exigiria outra
  // consulta. Um aviso abaixo do filtro deixa isso explícito.
  const [selectedAnalystIds, setSelectedAnalystIds] = useState<string[]>([]);
  const ready = isMetricsFilterReady(filter);
  const filterQs = useMemo(() => metricsFilterToQueryString(filter), [filter]);

  const performance = useReportFetch<{
    rows: PerformanceRow[];
    teamMedians: TeamMedians;
    pointsWeights: PointsWeights;
    pointsConfigUpdatedAt: string | null;
    pointsConfigIsDefault: boolean;
    pointsDataQuality: PointsDataQuality;
  }>(REPORT_ENDPOINT, 'performance', filterQs, ready);
  const absences = useReportFetch<{ rows: AbsenceRow[] }>(REPORT_ENDPOINT, 'absences', filterQs, ready);
  // Visão de chamado: só busca quando a tela está nela (ou na geral, que usa os dois).
  const tickets = useReportFetch<{ rows: TicketAnalystRow[]; time: TicketTimeTotals | null; objetivos: TicketObjetivo[]; config: { pontos: Record<string, number>; regras?: { amostraMinima: number } }; configIsDefault: boolean }>(REPORT_ENDPOINT, 'tickets', filterQs, ready && view !== 'chat');

  const hasAnalystFilter = selectedAnalystIds.length > 0;
  const matchesAnalystFilter = (analystId: string) => !hasAnalystFilter || selectedAnalystIds.includes(analystId);

  const rows = useMemo(() => {
    const list = performance.data?.rows ?? [];
    return [...list]
      .filter(r => matchesAnalystFilter(r.analystId))
      .sort((a, b) => (b.chatsPorHoraOnline ?? -1) - (a.chatsPorHoraOnline ?? -1));
  }, [performance.data, selectedAnalystIds]);

  // Lista de opções do filtro: união dos analistas vistos em Chat e em
  // Chamado (nomes podem divergir de anonimização — ver canSeeIndividual no
  // servidor —, mas o id é sempre o mesmo real).
  const analystOptions = useMemo(() => {
    const map = new Map<string, string>();
    (performance.data?.rows ?? []).forEach(r => map.set(r.analystId, r.analystName));
    (tickets.data?.rows ?? []).forEach(r => { if (!map.has(r.analystId)) map.set(r.analystId, r.analystName); });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [performance.data, tickets.data]);

  const absenceReasons = useMemo(() => {
    const set = new Set<string>();
    (absences.data?.rows ?? []).forEach(r => { if (matchesAnalystFilter(r.analystId)) set.add(r.reason); });
    return Array.from(set);
  }, [absences.data, selectedAnalystIds]);

  const absenceChartData = useMemo(() => {
    const byAnalyst = new Map<string, Record<string, any>>();
    (absences.data?.rows ?? []).forEach(r => {
      if (!matchesAnalystFilter(r.analystId)) return;
      const entry = byAnalyst.get(r.analystId) ?? { analystName: r.analystName };
      entry[r.reason] = r.hours;
      byAnalyst.set(r.analystId, entry);
    });
    return Array.from(byAnalyst.values());
  }, [absences.data, selectedAnalystIds]);

  // Analistas do detalhe de presença: junta quem aparece em desempenho (com foto) e em ausência.
  const presenceAnalysts = useMemo<PresenceAnalyst[]>(() => {
    const map = new Map<string, PresenceAnalyst>();
    (performance.data?.rows ?? []).filter(r => matchesAnalystFilter(r.analystId)).forEach(r => map.set(r.analystId, { id: r.analystId, name: r.analystName, avatarUrl: r.analystAvatarUrl ?? null }));
    (absences.data?.rows ?? []).filter(r => matchesAnalystFilter(r.analystId)).forEach(r => {
      if (!map.has(r.analystId)) map.set(r.analystId, { id: r.analystId, name: r.analystName, avatarUrl: null });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [performance.data, absences.data, selectedAnalystIds]);

  // Visão Chamado: mesma filtragem client-side das linhas individuais.
  const ticketRows = useMemo(() => {
    return (tickets.data?.rows ?? []).filter(r => matchesAnalystFilter(r.analystId));
  }, [tickets.data, selectedAnalystIds]);

  const rankingExport: ReportExportConfig = useMemo(() => {
    const weights = performance.data?.pointsWeights ?? DEFAULT_POINTS_WEIGHTS;
    const ranked = rankPoints(rows, weights);
    return {
      title: 'Ranking por pontos',
      columns: RANKING_EXPORT_COLUMNS,
      rows: ranked.map((p, i) => ({
        posicao: i + 1,
        analista: p.row.analystName,
        noRanking: p.eligible ? 'Sim' : 'Não (abaixo do mínimo de chats)',
        pontos: p.breakdown.total,
        pontosVolume: p.breakdown.volume,
        good: p.row.points?.good ?? 0,
        bad: p.row.points?.bad ?? 0,
        lt1: p.row.points?.lt1 ?? 0,
        lt3: p.row.points?.lt3 ?? 0,
        gt3: p.row.points?.gt3 ?? 0,
        chats: p.row.chatsAtendidos,
        avaliadas: p.row.avaliacoes ?? 0,
        satisfacao: p.row.satisfactionPositiveRate,
        primeiraResposta: p.row.firstResponseMedianSeconds,
        intervalo: p.row.intervaloRespostaMedianSeconds ?? null,
        horas: p.row.horasOnline,
        chatsH: p.row.chatsPorHoraOnline,
      })),
    };
  }, [rows, performance.data]);

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
  const allSections = [rankingExport, performanceExport, absencesExport];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ReportBackLink />
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Desempenho por Analista</h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            Ranking e pódio pelo índice provisório de desempenho. A tabela detalhada compara cada linha com a mediana do time. Analistas com menos de {MIN_ANALYST_SAMPLE} chats no período ficam de fora do ranking.
          </p>
        </div>
        <PageExportPdfButton sections={allSections} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
      </div>

      {/* Instância WhatsApp e Empresa removidas (pedido do usuário, 2026-10-08):
          além de a tela ficar mais enxuta, nenhuma das 3 visões (Chat/Chamado/
          Geral) deste relatório de fato filtra por elas — Chamado e Geral nem
          chegam a usar instanceId/companyId na consulta (achado nesta mesma
          mudança); Fila continua (a visão Chat filtra de verdade por ela). */}
      <MetricsFilterBar
        value={filter}
        onChange={setFilter}
        onFilterSummaryChange={setFilterSummary}
        periods={ANALYST_PERIODS}
        showInstanceFilter={false}
        showCompanyFilter={false}
      >
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase text-[var(--text-tertiary)] tracking-widest ml-1">Analistas</label>
          <MultiSelectFilter
            options={analystOptions}
            selected={selectedAnalystIds}
            onChange={setSelectedAnalystIds}
            allLabel="Todos os analistas"
            itemLabelPlural="analistas"
            searchPlaceholder="Buscar analista..."
            className="min-w-[180px]"
          />
        </div>
      </MetricsFilterBar>

      {hasAnalystFilter && (
        <p className="text-xs text-[var(--text-tertiary)] -mt-4 px-1">
          Comparando só os analistas selecionados: pódio, ranking, composição e as tabelas abaixo refletem a seleção.
          A Mediana do time (visão Chat) e os cards de Objetivos da área/Base da avaliação (visão Chamado) continuam sobre o time inteiro.
        </p>
      )}

      <div className="flex justify-end">
        <AnalystViewSwitch view={view} onChange={setView} />
      </div>

      {view === 'chamado' && (
        <TicketAnalystDashboard
          rows={ticketRows}
          time={tickets.data?.time ?? null}
          objetivos={tickets.data?.objetivos ?? []}
          pontos={tickets.data?.config?.pontos ?? {}}
          amostraMinima={tickets.data?.config?.regras?.amostraMinima ?? 10}
          status={tickets.status}
          onRetry={tickets.retry}
          canConfig={currentUser?.role === 'Administrador' || hasPermission(Permission.REPORTS_RANKING_CONFIG)}
          periodTitle={`Chamados · ${PERIOD_LABEL[filter.period] ?? 'Período'}`}
          filterSummary={filterSummary}
        />
      )}

      {view === 'geral' && (
        <GeneralAnalystDashboard
          chatRows={rows}
          weights={performance.data?.pointsWeights ?? DEFAULT_POINTS_WEIGHTS}
          ticketRows={ticketRows}
          status={performance.status === 'ready' && tickets.status === 'ready' ? 'ready' : (performance.status === 'error' || tickets.status === 'error' ? 'error' : 'loading')}
          onRetry={() => { performance.retry(); tickets.retry(); }}
          periodTitle={`Geral · ${PERIOD_LABEL[filter.period] ?? 'Período'}`}
          filterSummary={filterSummary}
        />
      )}

      {view === 'chat' && (<>

      <AnalystDashboard
        rows={rows}
        teamMedians={medians ?? null}
        status={performanceStatus}
        onRetry={performance.retry}
        periodTitle={PODIUM_TITLES[filter.period] ?? 'Pódio do período'}
        filterSummary={filterSummary}
        theme={theme}
        weights={performance.data?.pointsWeights ?? DEFAULT_POINTS_WEIGHTS}
        weightsIsDefault={performance.data?.pointsConfigIsDefault ?? true}
        dataQuality={performance.data?.pointsDataQuality ?? null}
        canConfigRanking={currentUser?.role === 'Administrador' || hasPermission(Permission.REPORTS_RANKING_CONFIG)}
        rankingActions={
          <SectionExportButton config={rankingExport} reportId={REPORT_ID} reportLabel={REPORT_LABEL} filterSummary={filterSummary} />
        }
      />

      <ReportSection
        title="Tabela detalhada — chats por hora online"
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

      <AnalystPresencePanel analysts={presenceAnalysts} filterQs={filterQs} ready={ready} />
      </>)}
    </div>
  );
}

const ABSENCE_COLORS = ['#f59e0b', '#ef4444', '#6366f1', '#22c55e', '#0ea5e9', '#a855f7'];

// Presets oferecidos nesta tela. Ficam explícitos porque 'ano' e 'todos' não entram no
// padrão dos relatórios de chat (varrem muitos dados). Testar o tempo de resposta com 'ano'.
const ANALYST_PERIODS: MetricsPeriodPreset[] = ['today', 'week', 'month', 'last_month', 'year', 'custom'];

// Nome curto do período, usado nos cabeçalhos das visões de chamado e geral.
const PERIOD_LABEL: Partial<Record<MetricsPeriodPreset, string>> = {
  today: "Hoje",
  week: "Esta semana",
  month: "Este mês",
  last_month: "Mês passado",
  year: "Este ano",
};

// Título do pódio por período. Períodos não listados caem no genérico.
const PODIUM_TITLES: Partial<Record<MetricsPeriodPreset, string>> = {
  today: 'Pódio de hoje',
  week: 'Pódio da semana',
  month: 'Pódio do mês',
  last_month: 'Pódio do mês passado',
  year: 'Pódio do ano',
};
