'use client';

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Lock, ChevronDown, ChevronUp, AlertTriangle, Star, CheckCircle2, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/theme-provider';
import { useApp } from '@/app/app-context';
import { Permission, AccountSummaryRow, AccountTopContact, AccountMonthlyBucket, AccountRiskCriteria } from '@/lib/types';
import { formatCount } from '@/lib/report-format';
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

// R5 — "Conta/Cliente". Visão comercial da carteira (diretoria e CS): 1 linha por empresa, com as
// contas em risco sempre no topo. Ao expandir, mostra os critérios que definem o risco e o detalhe
// (top contatos e evolução mensal), sob demanda.

// Dois casas decimais após a vírgula em todo número decimal desta tela (padrão pt-BR).
const NF2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec2 = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '—' : NF2.format(n));
const pct2 = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${NF2.format(n)}%`);

function formatMinutosConsumidos(min: number | null): string {
  if (min === null || Number.isNaN(min)) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  return `${NF2.format(min / 60)} h`;
}

function formatPeriodo(startDate: string, endDate: string): string {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `${f(startDate)} a ${f(endDate)}`;
}

const REPORT_ENDPOINT = '/api/reports/accounts';
const REPORT_ID = 'accounts';
const REPORT_LABEL = 'Conta/Cliente';

const SUMMARY_EXPORT_COLUMNS: ReportExportConfig<any>['columns'] = [
  { key: 'companyName', label: 'Empresa' },
  { key: 'sinalRisco', label: 'Sinal de risco', format: (v) => (v ? 'Sim' : 'Não') },
  { key: 'risco', label: 'Critérios atendidos', format: (v) => `${(v as AccountRiskCriteria).criteriosAtendidos} de 2` },
  { key: 'volume', label: 'Volume' },
  { key: 'minutosConsumidos', label: 'Minutos consumidos', format: (v) => formatMinutosConsumidos(v as number | null) },
  { key: 'recorrenciaRate', label: 'Recorrência 72h', format: (v) => pct2(v as number | null) },
  { key: 'positiveRate', label: '% Satisfação', format: (v) => pct2(v as number | null) },
  { key: 'avaliacaoInternaMedia', label: 'Avaliação interna', format: (v) => dec2(v as number | null) },
];

// Ordem da tabela: contas em risco primeiro; depois quem atende mais critérios; depois o maior volume.
function ordenar(rows: AccountSummaryRow[]): AccountSummaryRow[] {
  return [...rows].sort((a, b) =>
    Number(b.sinalRisco) - Number(a.sinalRisco) ||
    (b.risco?.criteriosAtendidos ?? 0) - (a.risco?.criteriosAtendidos ?? 0) ||
    b.volume - a.volume ||
    a.companyName.localeCompare(b.companyName, 'pt-BR')
  );
}

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

  const summary = useReportFetch<{ rows: AccountSummaryRow[]; periodoAnterior: { startDate: string; endDate: string } }>(
    REPORT_ENDPOINT, 'summary', filterQs, ready
  );

  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const detailReady = ready && expandedCompanyId !== null;
  const detail = useReportFetch<{ topContacts: AccountTopContact[]; monthly: AccountMonthlyBucket[] }>(
    REPORT_ENDPOINT, 'detail', filterQs, detailReady, `companyId=${expandedCompanyId ?? ''}`
  );

  const rows = useMemo(() => ordenar(summary.data?.rows ?? []), [summary.data]);

  const summaryExport: ReportExportConfig = useMemo(() => ({
    title: 'Carteira de contas',
    columns: SUMMARY_EXPORT_COLUMNS,
    rows
  }), [rows]);

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

  const summaryEmpty = summary.data ? rows.length === 0 : false;
  const summaryStatus: ReportSectionStatus = summary.status === 'ready' && summaryEmpty ? 'empty' : summary.status;
  const risksCount = rows.filter(r => r.sinalRisco).length;
  const periodoAnterior = summary.data?.periodoAnterior ?? null;

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

      {periodoAnterior && (
        <p className="text-xs text-[var(--text-tertiary)] -mt-4">
          O sinal de risco compara a satisfação deste período com o período anterior de mesmo tamanho ({formatPeriodo(periodoAnterior.startDate, periodoAnterior.endDate)}).
        </p>
      )}

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
                <th className="text-left py-2 px-3">Risco</th>
                <th className="text-right py-2 px-3">Volume</th>
                <th className="text-right py-2 px-3">Minutos consumidos</th>
                <th className="text-right py-2 px-3">Recorrência 72h</th>
                <th className="text-right py-2 px-3">% Satisfação</th>
                <th className="text-right py-2 px-3">Avaliação interna</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const aberta = expandedCompanyId === row.companyId;
                const criterios = row.risco?.criteriosAtendidos ?? 0;
                return (
                  <React.Fragment key={row.companyId}>
                    <tr
                      className={cn(
                        'border-b border-[var(--border-default)] last:border-0 cursor-pointer hover:bg-[var(--surface-pill)]',
                        row.sinalRisco && 'bg-[var(--surface-danger)]/30'
                      )}
                      onClick={() => setExpandedCompanyId(aberta ? null : row.companyId)}
                    >
                      <td className="py-3 px-3 font-semibold text-[var(--text-primary)]">{row.companyName}</td>
                      <td className="py-3 px-3">
                        {row.sinalRisco ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-[var(--surface-danger)] text-[var(--text-danger)] border-[var(--text-danger)]/20">
                            <AlertTriangle size={11} /> Risco · 2 de 2
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{criterios} de 2 critérios</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{formatCount(row.volume)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{formatMinutosConsumidos(row.minutosConsumidos)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{pct2(row.recorrenciaRate)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{pct2(row.positiveRate)}</td>
                      <td className="py-3 px-3 text-right">
                        {row.avaliacaoInternaMedia !== null ? (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <Star size={12} fill="currentColor" />
                            <span className="text-[var(--text-secondary)] font-semibold tabular-nums">{dec2(row.avaliacaoInternaMedia)}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-3 text-[var(--text-tertiary)]">
                        {aberta ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={8} className="bg-[var(--surface-pill)]/50 px-3 py-4">
                          <AccountDrillDown
                            row={row}
                            periodoAnterior={periodoAnterior}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </ReportSection>
    </div>
  );
}

// Explica o sinal de risco com os valores que o definiram: os dois critérios e o período de comparação.
function RiscoPanel({ row, periodoAnterior }: { row: AccountSummaryRow; periodoAnterior: { startDate: string; endDate: string } | null }) {
  const r = row.risco;
  if (!r) return null;
  const { queda, recorrencia } = r;

  const estado = (atende: boolean | null) => {
    if (atende === null) return { icone: MinusCircle, texto: 'sem dado', cor: 'text-[var(--text-tertiary)]' };
    return atende
      ? { icone: AlertTriangle, texto: 'atende', cor: 'text-[var(--text-danger)]' }
      : { icone: CheckCircle2, texto: 'não atende', cor: 'text-[var(--text-success)]' };
  };
  const estadoQueda = estado(queda.atende);
  const estadoRecorrencia = estado(recorrencia.atende);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)]">Por que esta conta {row.sinalRisco ? 'está' : 'não está'} em risco</p>
        <span className={cn('text-xs font-bold', row.sinalRisco ? 'text-[var(--text-danger)]' : 'text-[var(--text-secondary)]')}>
          {r.criteriosAtendidos} de 2 critérios atendidos · sinal de risco exige os 2
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-[var(--text-primary)]">1. Queda de satisfação</p>
            <span className={cn('inline-flex items-center gap-1 text-xs font-bold', estadoQueda.cor)}>
              <estadoQueda.icone size={13} /> {estadoQueda.texto}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-[var(--text-tertiary)]">Período anterior</dt>
            <dd className="text-right tabular-nums font-semibold">{pct2(queda.satisfacaoAnterior)}</dd>
            <dt className="text-[var(--text-tertiary)]">Este período</dt>
            <dd className="text-right tabular-nums font-semibold">{pct2(queda.satisfacaoAtual)}</dd>
            <dt className="text-[var(--text-tertiary)]">Queda</dt>
            <dd className="text-right tabular-nums font-semibold">{queda.quedaPontos === null ? '—' : `${dec2(queda.quedaPontos)} pontos`}</dd>
            <dt className="text-[var(--text-tertiary)]">Limite para o sinal</dt>
            <dd className="text-right tabular-nums font-semibold">mais de {dec2(queda.limitePontos)} pontos</dd>
          </dl>
          {queda.atende === null && (
            <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Sem avaliação no período anterior: não dá para comparar.</p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-[var(--text-primary)]">2. Recorrência em 72 h</p>
            <span className={cn('inline-flex items-center gap-1 text-xs font-bold', estadoRecorrencia.cor)}>
              <estadoRecorrencia.icone size={13} /> {estadoRecorrencia.texto}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-[var(--text-tertiary)]">Chats que voltaram em até 72 h</dt>
            <dd className="text-right tabular-nums font-semibold">{pct2(recorrencia.atual)}</dd>
            <dt className="text-[var(--text-tertiary)]">Limite para o sinal</dt>
            <dd className="text-right tabular-nums font-semibold">mais de {dec2(recorrencia.limite)}%</dd>
          </dl>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            Recontato do mesmo cliente em até 72 horas depois de um chat.
          </p>
        </div>
      </div>

      {periodoAnterior && (
        <p className="text-[11px] text-[var(--text-tertiary)]">Período anterior de comparação: {formatPeriodo(periodoAnterior.startDate, periodoAnterior.endDate)}.</p>
      )}
    </div>
  );
}

function AccountDrillDown({
  row,
  periodoAnterior,
  status,
  topContacts,
  monthly,
  onRetry,
  axisColor,
  tooltipStyle
}: {
  row: AccountSummaryRow;
  periodoAnterior: { startDate: string; endDate: string } | null;
  status: ReportSectionStatus;
  topContacts: AccountTopContact[];
  monthly: AccountMonthlyBucket[];
  onRetry: () => void;
  axisColor: string;
  tooltipStyle: React.CSSProperties;
}) {
  const rotuloMes = (v: string) => new Date(v).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });
  const tituloMes = (v: string) => new Date(v).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  return (
    <div className="space-y-6">
      <RiscoPanel row={row} periodoAnterior={periodoAnterior} />

      {status === 'loading' && <p className="text-xs text-[var(--text-tertiary)]">Carregando detalhe da conta...</p>}
      {status === 'error' && (
        <p className="text-xs text-[var(--text-danger)]">
          Não foi possível carregar o detalhe.{' '}
          <button onClick={onRetry} className="underline font-bold">Tentar de novo</button>
        </p>
      )}

      {status !== 'loading' && status !== 'error' && (
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
                      <td className="py-1.5 px-2 text-right tabular-nums">{c.volume}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatMinutosConsumidos(c.minutosConsumidos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Chats por mês</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthly}>
                    <XAxis dataKey="monthStart" tickFormatter={rotuloMes} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tituloMes(String(v))} formatter={(v: number) => [formatCount(v), 'Chats']} />
                    <Bar dataKey="volume" name="Chats" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] mb-2">Satisfação e recorrência (%)</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthly}>
                    <XAxis dataKey="monthStart" tickFormatter={rotuloMes} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: axisColor }} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => tituloMes(String(v))} formatter={(v: number, nome: string) => [pct2(v), nome]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="positiveRate" name="% Satisfação" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="recorrenciaRate" name="% Recorrência 72h" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
