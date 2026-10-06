'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Users, MessageSquare, Clock, Smile, ThumbsUp, ThumbsDown, RefreshCw, Info, Sparkles, TrendingUp, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalystPerformanceRow, TeamMedians, MIN_ANALYST_SAMPLE } from '@/lib/types';
import {
  PointsWeights, PointsRow, PointsDataQuality, rankPoints, formatPointsBr, formatSignedPointsBr,
} from '@/lib/analyst-points';
import { formatSeconds, formatPercentage, formatAverage, formatCount, formatDecimalBr } from '@/lib/report-format';
import { ReportSectionStatus } from '@/components/reports/report-section';
import { AnalystPodium } from '@/components/reports/analyst-podium';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';
import {
  chartColors, FirstResponseBars, ChatsBars, GoodsBadsBars, PointsBreakdownChart, EmptyChart,
} from '@/components/reports/analyst-dashboard-charts';

// Dashboard do Desempenho por Analista, pelo ranking de pontos. Os pesos vêm da configuração
// salva (Configurações > Pontuação do Ranking). A tabela detalhada continua abaixo, como versão
// textual dos gráficos.

interface AnalystDashboardProps {
  rows: AnalystPerformanceRow[];
  teamMedians: TeamMedians | null;
  status: ReportSectionStatus;
  onRetry?: () => void;
  periodTitle: string;
  filterSummary: string;
  theme: 'light' | 'dark';
  weights: PointsWeights;
  weightsIsDefault: boolean;
  dataQuality: PointsDataQuality | null;
  canConfigRanking: boolean;
  // Ações do cartão do ranking (ex.: exportar CSV/PDF), montadas pela página que tem o export.
  rankingActions?: React.ReactNode;
}

export function AnalystDashboard({
  rows, teamMedians, status, onRetry, periodTitle, filterSummary, theme,
  weights, weightsIsDefault, dataQuality, canConfigRanking, rankingActions,
}: AnalystDashboardProps) {
  const colors = useMemo(() => chartColors(theme), [theme]);

  const ranked = useMemo<PointsRow[]>(() => rankPoints(rows, weights), [rows, weights]);
  const eligibleRanking = useMemo(() => ranked.filter(r => r.eligible), [ranked]);
  const formingRanking = useMemo(() => ranked.filter(r => !r.eligible).sort((a, b) => b.row.chatsAtendidos - a.row.chatsAtendidos), [ranked]);
  const podium = useMemo(() => eligibleRanking.slice(0, 3), [eligibleRanking]);
  const maxTotal = useMemo(() => Math.max(0, ...eligibleRanking.map(r => r.breakdown.total)), [eligibleRanking]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveSelectedId = selectedId ?? podium[0]?.row.analystId ?? eligibleRanking[0]?.row.analystId ?? null;
  const selected = ranked.find(s => s.row.analystId === effectiveSelectedId) ?? null;

  // Totais do time (pooled), para os indicadores do topo.
  const totals = useMemo(() => {
    const chats = rows.reduce((acc, r) => acc + r.chatsAtendidos, 0);
    const positivas = rows.reduce((acc, r) => acc + (r.positivas ?? 0), 0);
    const negativas = rows.reduce((acc, r) => acc + (r.negativas ?? 0), 0);
    const avaliacoes = rows.reduce((acc, r) => acc + (r.avaliacoes ?? 0), 0);
    return {
      chats,
      positivas,
      negativas,
      avaliacoes,
      satisfactionRate: avaliacoes > 0 ? (positivas / avaliacoes) * 100 : null,
    };
  }, [rows]);

  const emphasizedIds = useMemo(() => podium.map(p => p.row.analystId), [podium]);

  if (status === 'loading') {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Carregando dashboard">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] animate-pulse" />)}
        </div>
        <div className="h-80 rounded-3xl bg-[var(--surface-card)] border border-[var(--border-default)] animate-pulse" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar o dashboard.</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-pill)]">
            <RefreshCw size={14} aria-hidden /> Tentar de novo
          </button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyChart message="Nenhum atendimento de analista no período selecionado." />;
  }

  const semNotaPct = dataQuality && dataQuality.conversas > 0 ? (dataQuality.semNota / dataQuality.conversas) * 100 : null;

  return (
    <div className="space-y-8">
      {/* Indicadores do time */}
      <section aria-label="Indicadores do time" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiTile icon={Users} label="No ranking" value={`${eligibleRanking.length}`} hint={`de ${rows.length} analistas · mín. ${MIN_ANALYST_SAMPLE} chats`} />
        <KpiTile icon={MessageSquare} label="Chats atendidos" value={formatCount(totals.chats)} hint={rows.length > 0 ? `média de ${formatAverage(totals.chats / rows.length, 0)} por analista` : undefined} />
        <KpiTile icon={Clock} label="1ª resposta (time)" value={formatSeconds(teamMedians?.firstResponseMedianSeconds ?? null)} />
        <KpiTile icon={Smile} label="Satisfação positiva" value={formatPercentage(totals.satisfactionRate)} hint={`${formatCount(totals.avaliacoes)} de ${formatCount(totals.chats)} chats avaliados`} />
        <KpiTile icon={ThumbsUp} label="Goods" value={formatCount(totals.positivas)} hint="avaliações positivas" tone="good" />
        <KpiTile icon={ThumbsDown} label="Bads" value={formatCount(totals.negativas)} hint="avaliações negativas" tone="bad" />
      </section>

      {/* Pódio */}
      <AnalystPodium
        podium={podium}
        title={periodTitle}
        subtitle={`${filterSummary || 'Período selecionado'} · pontuação pela configuração do ranking`}
      />

      {/* Ranking + detalhe do analista selecionado */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <section aria-labelledby="ranking-title" className="lg:col-span-3 rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5">
          <header className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 id="ranking-title" className="text-lg font-bold text-[var(--text-primary)]">Ranking do período</h2>
              <p className="text-xs text-[var(--text-tertiary)]">Clique em um analista para ver de onde vêm os pontos.</p>
            </div>
            {rankingActions}
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-pill)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Sparkles size={12} aria-hidden /> Pontuação
            </span>
          </header>

          <ol className="divide-y divide-[var(--border-default)]">
            {eligibleRanking.map((entry, i) => (
              <RankingRow
                key={entry.row.analystId}
                position={i + 1}
                entry={entry}
                maxTotal={maxTotal}
                selected={entry.row.analystId === effectiveSelectedId}
                onSelect={() => setSelectedId(entry.row.analystId)}
              />
            ))}
          </ol>

          {formingRanking.length > 0 && (
            <div className="mt-4 rounded-xl bg-[var(--surface-pill)] p-3">
              <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Em formação (menos de {MIN_ANALYST_SAMPLE} chats, fora do ranking)</p>
              <ul className="flex flex-wrap gap-2">
                {formingRanking.map(s => (
                  <li key={s.row.analystId}>
                    <button type="button" onClick={() => setSelectedId(s.row.analystId)}
                      className={cn('rounded-full border px-3 py-1 text-xs text-[var(--text-secondary)] bg-[var(--surface-card)] hover:border-[var(--accent)]',
                        s.row.analystId === effectiveSelectedId ? 'border-[var(--accent)]' : 'border-[var(--border-default)]')}>
                      {s.row.analystName} · {s.row.chatsAtendidos} chat{s.row.chatsAtendidos === 1 ? '' : 's'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Perfil do analista selecionado" className="lg:col-span-2">
          {selected ? (
            <AnalystProfile entry={selected} />
          ) : (
            <EmptyChart message="Selecione um analista no ranking." />
          )}
        </section>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartCard title="Tempo de primeira resposta" subtitle="Mediana por analista do ranking, do mais rápido ao mais lento. Linha = mediana do time. Menor é melhor.">
          <FirstResponseBars
            scored={ranked}
            emphasizedIds={emphasizedIds}
            selectedId={effectiveSelectedId}
            onSelect={setSelectedId}
            medianSeconds={teamMedians?.firstResponseMedianSeconds ?? null}
            colors={colors}
          />
        </ChartCard>

        <ChartCard title="Chats atendidos" subtitle="Volume no período. Destaque para o pódio; clique para ver o perfil.">
          <ChatsBars
            scored={ranked}
            emphasizedIds={emphasizedIds}
            selectedId={effectiveSelectedId}
            onSelect={setSelectedId}
            colors={colors}
          />
        </ChartCard>

        <ChartCard title="Goods × Bads" subtitle="Avaliações de clientes por analista. Verde = bom, vermelho = ruim.">
          <GoodsBadsBars scored={ranked} onSelect={setSelectedId} colors={colors} />
        </ChartCard>

        <ChartCard
          title={selected ? `Composição: ${selected.row.analystName}` : 'Composição da pontuação'}
          subtitle="Quanto cada item somou (ou tirou) do total do analista, com os pesos vigentes."
        >
          {selected ? (
            <PointsBreakdownChart breakdown={selected.breakdown} colors={colors} />
          ) : (
            <EmptyChart message="Selecione um analista para ver a composição." />
          )}
        </ChartCard>
      </div>

      {/* Notas de método, qualidade dos dados e métricas em formação */}
      <section aria-label="Notas de método" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Info size={16} className="text-[var(--accent-text)]" aria-hidden />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Como a pontuação é calculada</h3>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            Cada conversa vale o peso da sua tag (vale o maior, sem somar), ou o peso base. O valor é dividido entre os analistas pela participação nas mensagens.
            Cada avaliação good e bad soma o seu peso. Cada conversa cai numa faixa de 1ª resposta. Só entra no ranking quem tem {MIN_ANALYST_SAMPLE} chats ou mais.
          </p>
          <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
            Pesos atuais: volume {formatDecimalBr(weights.volume, 1)} · good {formatDecimalBr(weights.good, 0)} · bad {formatDecimalBr(weights.bad, 0)} · &lt;1 min {formatDecimalBr(weights.lt1, 1)} · 1 a 3 min {formatDecimalBr(weights.lt3, 1)} · &gt;3 min {formatDecimalBr(weights.gt3, 1)}.
            {weightsIsDefault && ' Valores padrão.'}
          </p>
          {canConfigRanking ? (
            <Link href="/settings" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline">
              <Settings size={12} aria-hidden /> Alterar pesos em Configurações
            </Link>
          ) : (
            <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">Quem altera os pesos é o administrador ou quem tem a permissão de configurar o ranking.</p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5">
          <div className="flex items-center gap-2 mb-2">
            <Smile size={16} className="text-[var(--text-tertiary)]" aria-hidden />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Confiabilidade dos dados</h3>
          </div>
          {dataQuality ? (
            <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
              <li><strong>{formatCount(dataQuality.conversas)}</strong> conversas no período.</li>
              <li><strong>{formatCount(dataQuality.semNota)}</strong> sem avaliação do cliente{semNotaPct !== null ? ` (${formatDecimalBr(semNotaPct, 0)}%)` : ''}. Essas não entram em good nem em bad.</li>
              <li><strong>{formatCount(dataQuality.semRespostaEquipe)}</strong> sem nenhuma resposta da equipe. Essas não ganham volume.</li>
              <li><strong>{formatCount(dataQuality.semPrimeiraResposta)}</strong> sem 1ª resposta medida. Essas não entram em nenhuma faixa de tempo.</li>
            </ul>
          ) : (
            <p className="text-xs text-[var(--text-tertiary)]">Sem dados de qualidade neste período.</p>
          )}
          <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">Quanto mais conversas sem nota, menos firme é o ranking de good e bad.</p>
        </div>

        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-card)] p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-[var(--text-tertiary)]" aria-hidden />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Métricas em formação</h3>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            <strong>Intervalo entre o cliente e o analista</strong> e <strong>turnos sem resposta</strong> ainda não entram na pontuação.
            O histórico de atribuição começou em 05/10/2026, e essas métricas precisam de dados acumulados e de um agendador para gravar os valores.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiTile({ icon: Icon, label, value, hint, tone }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] p-4 shadow-sm min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-tertiary)]">
        <Icon size={14} aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn(
        'mt-2 text-2xl font-black tracking-tight text-[var(--text-primary)] truncate',
        tone === 'good' && 'text-[var(--text-success)]',
        tone === 'bad' && 'text-[var(--text-danger)]'
      )}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-[var(--text-tertiary)] truncate">{hint}</p>}
    </div>
  );
}

function RankingRow({ position, entry, maxTotal, selected, onSelect }: {
  position: number;
  entry: PointsRow;
  maxTotal: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, breakdown } = entry;
  const width = maxTotal > 0 && breakdown.total > 0 ? (breakdown.total / maxTotal) * 100 : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2.25rem_minmax(0,1.5fr)_minmax(0,1.2fr)_auto_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
          selected ? 'bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40' : 'hover:bg-[var(--surface-pill)]'
        )}
      >
        <span className={cn('text-sm font-black tabular-nums', position <= 3 ? 'text-[var(--accent-text)]' : 'text-[var(--text-tertiary)]')}>{position}º</span>

        <span className="flex items-center gap-2.5 min-w-0">
          <AnalystAvatar name={row.analystName} src={row.analystAvatarUrl} className="h-8 w-8 flex-shrink-0 text-[11px]" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
              {row.analystName}
              {row.isSelf && <span className="ml-1 text-[9px] font-bold uppercase tracking-widest text-[var(--accent-text)]">você</span>}
            </span>
            <span className="block text-[11px] text-[var(--text-tertiary)] tabular-nums">{formatCount(row.chatsAtendidos)} chats</span>
          </span>
        </span>

        <span className="hidden md:flex items-center gap-2 min-w-0">
          <span className="h-2 flex-1 rounded-full bg-[var(--surface-pill)] overflow-hidden" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, width))}%` }} />
          </span>
        </span>

        <span className="text-right">
          <span className={cn('block text-base font-black tabular-nums', breakdown.total < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]')}>
            {formatPointsBr(breakdown.total)}
          </span>
          <span className="hidden md:block text-[11px] text-[var(--text-tertiary)] tabular-nums">{formatSeconds(row.firstResponseMedianSeconds)} · {formatPercentage(row.satisfactionPositiveRate)} · {formatCount(row.avaliacoes ?? 0)} de {formatCount(row.chatsAtendidos)} avaliadas</span>
        </span>

        <span className="hidden md:flex flex-col items-end gap-0.5 text-[11px] tabular-nums">
          <span className="flex items-center gap-1 text-[var(--text-success)]"><ThumbsUp size={11} aria-hidden />{formatCount(row.positivas ?? 0)}</span>
          <span className="flex items-center gap-1 text-[var(--text-danger)]"><ThumbsDown size={11} aria-hidden />{formatCount(row.negativas ?? 0)}</span>
        </span>
      </button>
    </li>
  );
}

function AnalystProfile({ entry }: { entry: PointsRow }) {
  const { row, breakdown } = entry;
  const counts = row.points ?? { volume: 0, volumePoints: 0, good: 0, bad: 0, lt1: 0, lt3: 0, gt3: 0 };
  const items: { label: string; count: number; points: number; detail: string }[] = [
    { label: 'Volume', count: counts.volume, points: breakdown.volume, detail: 'conversas (com peso da tag)' },
    { label: 'Good', count: counts.good, points: breakdown.good, detail: 'avaliações positivas' },
    { label: 'Bad', count: counts.bad, points: breakdown.bad, detail: 'avaliações negativas' },
    { label: 'Resposta < 1 min', count: counts.lt1, points: breakdown.lt1, detail: 'conversas' },
    { label: 'Resposta 1 a 3 min', count: counts.lt3, points: breakdown.lt3, detail: 'conversas' },
    { label: 'Resposta > 3 min', count: counts.gt3, points: breakdown.gt3, detail: 'conversas' },
  ];

  return (
    <div className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 h-full">
      <div className="flex items-center gap-4">
        <AnalystAvatar name={row.analystName} src={row.analystAvatarUrl} className="h-14 w-14 flex-shrink-0 text-lg ring-2 ring-[var(--accent)]/30" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-[var(--text-primary)]">
            {row.analystName}
            {row.isSelf && <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-[var(--accent-text)]">você</span>}
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">{formatCount(row.chatsAtendidos)} chats · {formatDecimalBr(row.horasOnline, 1)}h online</p>
        </div>
        <div className="ml-auto text-right">
          <p className={cn('text-3xl font-black tabular-nums leading-none', breakdown.total < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]')}>
            {formatPointsBr(breakdown.total)}
          </p>
          <p className="text-[11px] text-[var(--text-tertiary)]">pontos</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <Metric icon={Clock} label="1ª resposta mediana" value={formatSeconds(row.firstResponseMedianSeconds)} />
        <Metric icon={Smile} label="Satisfação positiva" value={formatPercentage(row.satisfactionPositiveRate)} />
        <Metric icon={MessageSquare} label="Mensagens enviadas" value={formatAverage(row.msgsEnviadas, 0)} />
        <Metric icon={ThumbsUp} label="Chats avaliados" value={`${formatCount(row.avaliacoes ?? 0)} de ${formatCount(row.chatsAtendidos)}`} />
        <Metric icon={Clock} label="Cliente → resposta (informativo)" value={formatSeconds(row.intervaloRespostaMedianSeconds ?? null)} />
      </dl>

      <div className="mt-6">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">De onde vêm os pontos</p>
        <ul className="divide-y divide-[var(--border-default)]">
          {items.map(item => (
            <li key={item.label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-[var(--text-primary)]">{item.label}</span>
                <span className="block text-[11px] text-[var(--text-tertiary)] tabular-nums">{formatCount(item.count)} {item.detail}</span>
              </span>
              <span className={cn('font-bold tabular-nums', item.points < 0 ? 'text-[var(--text-danger)]' : item.points > 0 ? 'text-[var(--text-success)]' : 'text-[var(--text-tertiary)]')}>
                {formatSignedPointsBr(item.points)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: {
  icon: React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-[var(--surface-pill)] p-3">
      <dt className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"><Icon size={12} aria-hidden />{label}</dt>
      <dd className="mt-1 text-base font-bold tabular-nums text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5 min-w-0">
      <header className="mb-4">
        <h2 className="text-base font-bold text-[var(--text-primary)]">{title}</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}
