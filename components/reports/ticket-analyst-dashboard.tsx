'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { Trophy, Target, RotateCcw, Inbox, Settings, CheckCircle2, AlertTriangle, MinusCircle, Timer, Repeat, Ticket, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TicketAnalystRow, TicketObjetivo, TicketTimeTotals } from '@/lib/types';
import { formatPercentage, formatMinutes, formatCount } from '@/lib/report-format';
import { formatSignedPointsBr } from '@/lib/analyst-points';
import { ReportSectionStatus } from '@/components/reports/report-section';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';
import { PodiumStage, PodiumItem } from '@/components/reports/podium-stage';

// Visão de CHAMADO do Desempenho por Analista. Cada indicador vira um card com meta, resultado,
// situação e a forma como é medido. Indicador sem amostra mínima aparece como "sem dado".

interface TicketDashboardProps {
  rows: TicketAnalystRow[];
  time: TicketTimeTotals | null;
  objetivos: TicketObjetivo[];
  pontos: Record<string, number>;
  amostraMinima: number;
  status: ReportSectionStatus;
  onRetry?: () => void;
  canConfig: boolean;
  periodTitle: string;
  filterSummary: string;
}

// Como cada objetivo é medido (texto dos cards).
const COMO_MEDIDO: Record<string, string> = {
  prazo: 'Chamados concluídos dentro do prazo de SLA da prioridade, contando só horas úteis (seg a sex, 8h às 18h). Chamado ainda aberto com prazo vencido conta como descumprido.',
  espera: 'Mediana do tempo entre o comentário do cliente e a primeira resposta visível da equipe. Chamado sem comentário do cliente não entra.',
  resolver: 'Chamados que nasceram já resolvidos, sobre os chamados criados a partir da data do histórico de status.',
  backlog: 'Chamados ainda abertos com mais de 48 horas úteis desde a criação. É uma foto do momento, não do período.',
  qualidade: 'Chamados reabertos depois de concluídos, sobre os chamados concluídos com histórico de status.',
};

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function valorObjetivo(o: TicketObjetivo): string {
  if (o.atual === null) return 'sem dado';
  if (o.unidade === '%') return `${Math.round(o.atual)}%`;
  if (o.unidade === 'min') return formatMinutes(o.atual);
  return formatCount(Math.round(o.atual));
}

function metaObjetivo(o: TicketObjetivo): string {
  const simbolo = o.sentido === '>=' ? '≥' : '≤';
  const sufixo = o.unidade === '%' ? '%' : o.unidade === 'min' ? ' min' : '';
  return `${simbolo} ${o.meta}${sufixo}`;
}

function gapObjetivo(o: TicketObjetivo): string {
  if (o.gap === null) return '—';
  const sinal = o.gap > 0 ? '+' : o.gap < 0 ? '−' : '';
  const abs = Math.abs(o.gap);
  if (o.unidade === '%') return `${sinal}${Math.round(abs)} p.p.`;
  if (o.unidade === 'min') return `${sinal}${Math.round(abs)} min`;
  return `${sinal}${Math.round(abs)}`;
}

// Quanto do caminho até a meta foi percorrido (100% = meta atingida).
function progresso(o: TicketObjetivo): number | null {
  if (o.atual === null) return null;
  if (o.sentido === '>=') return o.meta > 0 ? Math.min(100, (o.atual / o.meta) * 100) : 100;
  if (o.atual <= o.meta) return 100;
  return o.atual > 0 ? (o.meta / o.atual) * 100 : 100;
}

function ObjetivoCard({ o }: { o: TicketObjetivo }) {
  const pr = progresso(o);
  const situacao = o.atual === null
    ? { icone: MinusCircle, texto: 'Sem dado', cor: 'text-[var(--text-tertiary)]', fundo: 'bg-[var(--surface-pill)]' }
    : o.atingiu
      ? { icone: CheckCircle2, texto: 'Na meta', cor: 'text-[var(--text-success)]', fundo: 'bg-[var(--surface-success,var(--surface-pill))]' }
      : { icone: AlertTriangle, texto: 'Fora da meta', cor: 'text-[var(--text-danger)]', fundo: 'bg-[var(--surface-danger)]' };
  const Icone = situacao.icone;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-text)]">{o.objetivo}</p>
          <p className="text-xs text-[var(--text-secondary)]">{o.kpi}</p>
        </div>
        <span className={cn('inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', situacao.fundo, situacao.cor)}>
          <Icone size={11} aria-hidden /> {situacao.texto}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <p className={cn('text-3xl font-black tabular-nums leading-none', o.atual === null ? 'text-[var(--text-tertiary)] text-xl' : o.atingiu ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]')}>
          {valorObjetivo(o)}
        </p>
        <p className="text-right text-[11px] text-[var(--text-tertiary)]">
          meta <strong className="tabular-nums text-[var(--text-primary)]">{metaObjetivo(o)}</strong>
          <br />
          diferença <strong className={cn('tabular-nums', o.atingiu === null ? '' : o.atingiu ? 'text-[var(--text-success)]' : 'text-[var(--text-danger)]')}>{gapObjetivo(o)}</strong>
        </p>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-pill)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pr === null ? undefined : Math.round(pr)} aria-label={`Progresso até a meta de ${o.objetivo}`}>
        <div className={cn('h-full rounded-full transition-all', o.atingiu ? 'bg-[var(--text-success)]' : o.atual === null ? 'bg-[var(--text-tertiary)]' : 'bg-[var(--text-danger)]')} style={{ width: `${pr === null ? 0 : Math.round(pr)}%` }} />
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{COMO_MEDIDO[o.id] ?? ''}</p>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-3 text-[11px] text-[var(--text-tertiary)]">
        <span>Dono: <strong className="text-[var(--text-secondary)]">{o.dono}</strong></span>
        <span>Freq.: <strong className="text-[var(--text-secondary)]">{o.freq}</strong></span>
        <span>Base: <strong className="tabular-nums text-[var(--text-secondary)]">{formatCount(o.amostra)}</strong></span>
      </div>
    </article>
  );
}

function StatCard({ icone: Icone, titulo, valor, detalhe, tom }: { icone: React.ElementType; titulo: string; valor: string; detalhe: string; tom?: 'bom' | 'ruim' | 'neutro' }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
        <Icone size={13} aria-hidden /> {titulo}
      </div>
      <p className={cn('text-2xl font-black tabular-nums', tom === 'bom' ? 'text-[var(--text-success)]' : tom === 'ruim' ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]')}>{valor}</p>
      <p className="text-[11px] leading-snug text-[var(--text-tertiary)]">{detalhe}</p>
    </div>
  );
}

function Chip({ rotulo, pontos }: { rotulo: string; pontos: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]', pontos < 0 ? 'bg-[var(--surface-danger)] text-[var(--text-danger)]' : pontos > 0 ? 'bg-[var(--surface-pill)] text-[var(--text-success)]' : 'bg-[var(--surface-pill)] text-[var(--text-tertiary)]')}>
      <span className="text-[var(--text-secondary)]">{rotulo}</span>
      <strong className="tabular-nums">{formatSignedPointsBr(pontos)}</strong>
    </span>
  );
}

export function TicketAnalystDashboard({ rows, time, objetivos, pontos, amostraMinima, status, onRetry, canConfig, periodTitle, filterSummary }: TicketDashboardProps) {
  const ranked = useMemo(
    () => [...rows].sort((a, b) => b.points.total - a.points.total || b.chamados - a.chamados || a.analystName.localeCompare(b.analystName, 'pt-BR')),
    [rows]
  );
  const eligible = useMemo(() => ranked.filter(r => !r.amostraInsuficiente), [ranked]);

  // Composição: quanto cada item somou no time inteiro.
  const composicao = useMemo(() => {
    const soma = (f: (r: TicketAnalystRow) => number) => rows.reduce((acc, r) => acc + f(r), 0);
    return [
      { rotulo: 'SLA', valor: soma(r => r.points.sla) },
      { rotulo: '1ª resposta', valor: soma(r => r.points.primeiraResposta) },
      { rotulo: 'Nasce resolvido', valor: soma(r => r.points.resolvidoPrimeiroContato) },
      { rotulo: 'Backlog', valor: soma(r => r.points.backlog) },
      { rotulo: 'Reabertura', valor: soma(r => r.points.reabertura) },
    ];
  }, [rows]);
  const maxComposicao = Math.max(1, ...composicao.map(c => Math.abs(c.valor)));

  if (status === 'loading') {
    return <div className="h-72 animate-pulse rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)]" aria-busy="true" aria-label="Carregando chamados" />;
  }
  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível carregar a visão de chamados.</p>
        {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-text)]"><RotateCcw size={14} aria-hidden /> Tentar de novo</button>}
      </div>
    );
  }

  const t = time;
  const medidosSla = t ? t.slaOk + t.slaMiss : 0;
  const comHistoricoPct = t ? pct(t.comHistorico, t.chamados) : null;
  const comComentarioPct = t ? pct(t.frAmostra, t.chamados) : null;

  return (
    <div className="space-y-8">
      {/* 3. Pódio */}
      {eligible.length > 0 && (
        <PodiumStage
          titulo="Pódio de chamados"
          subtitulo="Ordenado pelos pontos de chamado no período (com amostra mínima)"
          items={eligible.slice(0, 3).map((r): PodiumItem => ({
            id: r.analystId,
            nome: r.analystName,
            avatarUrl: r.avatarUrl,
            principal: formatSignedPointsBr(r.points.total),
            principalRotulo: 'pontos de chamado',
            detalhes: [
              { rotulo: 'Chamados', valor: formatCount(r.chamados) },
              { rotulo: 'SLA', valor: r.slaPct === null ? 'sem dado' : formatPercentage(r.slaPct) },
              { rotulo: 'Espera', valor: r.frMedianaMin === null ? 'sem dado' : formatMinutes(r.frMedianaMin) },
            ],
            isSelf: r.isSelf,
          }))}
        />
      )}

      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent-text)]">Chamados · {periodTitle.replace(/^Chamados · /, '')}</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-[var(--text-primary)]">Avaliação de chamados</h2>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">{filterSummary || 'Período selecionado'} · pontuação pela configuração de chamados</p>
      </header>

      {/* 1. Objetivos da área, em cards */}
      <section aria-labelledby="ticket-objectives-title" className="space-y-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-[var(--accent-text)]" aria-hidden />
          <h3 id="ticket-objectives-title" className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Objetivos da área</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {objetivos.map(o => <ObjetivoCard key={o.id} o={o} />)}
        </div>
      </section>

      {/* 2. Base da avaliação */}
      <section aria-labelledby="ticket-base-title" className="space-y-3">
        <h3 id="ticket-base-title" className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Base da avaliação</h3>
        {t ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icone={Ticket} titulo="Chamados no período" valor={formatCount(t.chamados)} detalhe="criados no período, com responsável" />
            <StatCard icone={Inbox} titulo="Com histórico de status" valor={comHistoricoPct === null ? '—' : formatPercentage(comHistoricoPct)} detalhe={`${formatCount(t.comHistorico)} de ${formatCount(t.chamados)} têm histórico. Sem histórico, SLA e reabertura não são medidos.`} />
            <StatCard icone={Users} titulo="Com comentário do cliente" valor={comComentarioPct === null ? '—' : formatPercentage(comComentarioPct)} detalhe={`${formatCount(t.frAmostra)} medidos para 1ª resposta. ${formatCount(t.semInteracaoCliente)} sem comentário do cliente ficam de fora.`} />
            <StatCard icone={Timer} titulo="SLA medido" valor={medidosSla >= amostraMinima ? `${formatCount(t.slaOk)} de ${formatCount(medidosSla)}` : 'sem dado'} detalhe={medidosSla >= amostraMinima ? `${formatCount(t.slaOk)} cumpridos · ${formatCount(t.slaMiss)} descumpridos · ${formatCount(t.slaPendentes)} ainda dentro do prazo` : `amostra mínima de ${amostraMinima} chamados medidos; hoje há ${formatCount(medidosSla)}`} tom={medidosSla >= amostraMinima ? (t.slaOk / medidosSla >= 0.9 ? 'bom' : 'ruim') : 'neutro'} />
            <StatCard icone={Repeat} titulo="Chamados reabertos" valor={t.fechados >= amostraMinima ? `${formatCount(t.reabertos)} de ${formatCount(t.fechados)}` : 'sem dado'} detalhe={t.fechados >= amostraMinima ? 'concluídos com histórico que voltaram a ficar abertos' : `amostra mínima de ${amostraMinima} concluídos com histórico; hoje há ${formatCount(t.fechados)}`} tom={t.fechados >= amostraMinima ? (t.reabertos / t.fechados > 0.05 ? 'ruim' : 'neutro') : 'neutro'} />
            <StatCard icone={Trophy} titulo="Nascidos resolvidos" valor={`${formatCount(t.nasceram)}`} detalhe="chamados criados já concluídos (conta ponto)" tom="bom" />
            <StatCard icone={AlertTriangle} titulo="Backlog agora" valor={formatCount(t.backlog)} detalhe="abertos há mais de 48 h úteis, em qualquer período" tom={t.backlog > 20 ? 'ruim' : 'neutro'} />
            <StatCard icone={MinusCircle} titulo="Sem histórico" valor={formatCount(t.slaSemHistorico)} detalhe="concluídos antes do histórico começar; não entram em SLA nem reabertura" />
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">Sem dados de base no período.</p>
        )}
      </section>

      {/* 4. Detalhamento por analista */}
      <section aria-labelledby="ticket-detail-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-[var(--accent-text)]" aria-hidden />
            <h3 id="ticket-detail-title" className="text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Detalhamento por analista</h3>
          </div>
          {canConfig && (
            <Link href="/settings?tab=ranking-points" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline">
              <Settings size={13} aria-hidden /> Configurar pontos e metas
            </Link>
          )}
        </div>
        {ranked.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">Nenhum chamado com responsável no período.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ranked.map((r, i) => (
              <article key={r.analystId} className={cn('flex flex-col gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-sm', r.amostraInsuficiente && 'opacity-70')}>
                <header className="flex items-center gap-3">
                  <AnalystAvatar name={r.analystName} src={r.avatarUrl} className="h-11 w-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-[var(--text-primary)]">{r.analystName}{r.isSelf && <span className="ml-1 text-[9px] uppercase text-[var(--accent-text)]">você</span>}</p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      {r.amostraInsuficiente ? `Amostra baixa (${r.chamados} chamados)` : `${i + 1}º no ranking · ${formatCount(r.chamados)} chamados`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn('text-2xl font-black tabular-nums', r.points.total < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]')}>{formatSignedPointsBr(r.points.total)}</p>
                    <p className="text-[10px] text-[var(--text-tertiary)]">pontos</p>
                  </div>
                </header>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">SLA</dt>
                    <dd className="font-bold tabular-nums text-[var(--text-primary)]">{r.slaPct === null ? 'sem dado' : formatPercentage(r.slaPct)}</dd>
                    <dd className="text-[10px] text-[var(--text-tertiary)]">{r.slaOk} cumpridos · {r.slaMiss} descumpridos · {r.slaPendentes} pendentes</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">1ª resposta</dt>
                    <dd className="font-bold tabular-nums text-[var(--text-primary)]">{r.frMedianaMin === null ? 'sem dado' : formatMinutes(r.frMedianaMin)}</dd>
                    <dd className="text-[10px] text-[var(--text-tertiary)]">{r.frAmostra} medidos · {r.frNoPrazo} no prazo · {r.frForaPrazo} fora</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Nasce resolvido</dt>
                    <dd className="font-bold tabular-nums text-[var(--text-primary)]">{r.nasceramPct === null ? 'sem dado' : formatPercentage(r.nasceramPct)}</dd>
                    <dd className="text-[10px] text-[var(--text-tertiary)]">{r.nasceram} de {r.comHistorico} com histórico</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Reabertura</dt>
                    <dd className="font-bold tabular-nums text-[var(--text-primary)]">{r.reaberturaPct === null ? 'sem dado' : formatPercentage(r.reaberturaPct)}</dd>
                    <dd className="text-[10px] text-[var(--text-tertiary)]">{r.reabertos} reabertos de {r.fechados} concluídos · {r.reaberturas} eventos</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Backlog</dt>
                    <dd className="font-bold tabular-nums text-[var(--text-primary)]">{formatCount(r.backlog)}</dd>
                    <dd className="text-[10px] text-[var(--text-tertiary)]">abertos há mais de 48 h úteis</dd>
                  </div>
                </dl>

                <div className="border-t border-[var(--border-default)] pt-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">De onde vêm os pontos</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip rotulo="SLA" pontos={r.points.sla} />
                    <Chip rotulo="1ª resposta" pontos={r.points.primeiraResposta} />
                    <Chip rotulo="Nasce resolvido" pontos={r.points.resolvidoPrimeiroContato} />
                    <Chip rotulo="Backlog" pontos={r.points.backlog} />
                    <Chip rotulo="Reabertura" pontos={r.points.reabertura} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 5. Ranking */}
      <section aria-labelledby="ticket-ranking-title" className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Trophy size={18} className="text-[var(--accent-text)]" aria-hidden />
          <h3 id="ticket-ranking-title" className="text-lg font-bold text-[var(--text-primary)]">Ranking de chamados</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                <th className="py-2 text-left font-bold">#</th>
                <th className="py-2 text-left font-bold">Analista</th>
                <th className="py-2 text-right font-bold">Pontos</th>
                <th className="py-2 text-right font-bold">Chamados</th>
                <th className="py-2 text-right font-bold">SLA</th>
                <th className="py-2 text-right font-bold">1ª resposta</th>
                <th className="py-2 text-right font-bold">Nasce resolvido</th>
                <th className="py-2 text-right font-bold">Reabertos</th>
                <th className="py-2 text-right font-bold">Backlog</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {ranked.map((r, i) => (
                <tr key={r.analystId} className={cn(r.amostraInsuficiente && 'opacity-60')}>
                  <td className="py-2 font-bold text-[var(--text-tertiary)] tabular-nums">{r.amostraInsuficiente ? '—' : i + 1}</td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <AnalystAvatar name={r.analystName} src={r.avatarUrl} className="h-7 w-7 text-[10px]" />
                      <span className="font-semibold text-[var(--text-primary)]">{r.analystName}</span>
                    </span>
                  </td>
                  <td className={cn('py-2 text-right font-black tabular-nums', r.points.total < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]')}>{formatSignedPointsBr(r.points.total)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCount(r.chamados)}</td>
                  <td className="py-2 text-right tabular-nums">{r.slaPct === null ? '—' : formatPercentage(r.slaPct)}</td>
                  <td className="py-2 text-right tabular-nums">{r.frMedianaMin === null ? '—' : formatMinutes(r.frMedianaMin)}</td>
                  <td className="py-2 text-right tabular-nums">{r.nasceramPct === null ? '—' : formatPercentage(r.nasceramPct)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCount(r.reabertos)}</td>
                  <td className="py-2 text-right tabular-nums">{formatCount(r.backlog)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. Composição da pontuação do time */}
      <section aria-labelledby="ticket-composition-title" className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5 shadow-sm">
        <h3 id="ticket-composition-title" className="mb-1 text-sm font-black uppercase tracking-widest text-[var(--text-primary)]">Composição da pontuação do time</h3>
        <p className="mb-4 text-xs text-[var(--text-tertiary)]">Quanto cada item somou (ou descontou) no total de todos os analistas.</p>
        <ul className="space-y-3">
          {composicao.map(c => (
            <li key={c.rotulo} className="grid grid-cols-[120px_1fr_90px] items-center gap-3 text-xs">
              <span className="text-[var(--text-secondary)]">{c.rotulo}</span>
              <div className="relative h-3 rounded-full bg-[var(--surface-pill)]">
                <div
                  className={cn('absolute top-0 h-full rounded-full', c.valor < 0 ? 'bg-[var(--text-danger)] right-1/2' : 'bg-[var(--text-success)] left-1/2')}
                  style={{ width: `${(Math.abs(c.valor) / maxComposicao) * 50}%` }}
                />
                <span className="absolute left-1/2 top-[-2px] h-[16px] w-px bg-[var(--border-strong)]" aria-hidden />
              </div>
              <strong className={cn('text-right tabular-nums', c.valor < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-success)]')}>{formatSignedPointsBr(c.valor)}</strong>
            </li>
          ))}
        </ul>
      </section>

      {/* 7. Confiabilidade e método */}
      <section aria-labelledby="ticket-reliability-title" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5">
          <h4 id="ticket-reliability-title" className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]"><Inbox size={15} aria-hidden /> Confiabilidade dos dados</h4>
          {t ? (
            <ul className="space-y-2 text-xs text-[var(--text-secondary)]">
              <li><strong className="tabular-nums">{formatCount(t.semInteracaoCliente)}</strong> de {formatCount(t.chamados)} chamados sem comentário do cliente. Nesses, a 1ª resposta não é medida.</li>
              <li><strong className="tabular-nums">{formatCount(t.slaSemHistorico)}</strong> chamados concluídos sem histórico de status. SLA e reabertura desses não são medidos.</li>
              <li>Backlog agora: <strong className="tabular-nums">{formatCount(t.backlog)}</strong> chamados abertos há mais de 48 h úteis.</li>
            </ul>
          ) : <p className="text-xs text-[var(--text-tertiary)]">Sem dados de qualidade no período.</p>}
        </div>
        <div className="space-y-3 rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-5">
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]"><Target size={15} aria-hidden /> Como a pontuação é calculada</h4>
          <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
            <li className="flex justify-between gap-3"><span>SLA cumprido, por chamado</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.slaCumprido)}</strong></li>
            <li className="flex justify-between gap-3"><span>SLA descumprido, por chamado</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.slaDescumprido)}</strong></li>
            <li className="flex justify-between gap-3"><span>1ª resposta dentro da meta</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.primeiraRespostaNoPrazo)}</strong></li>
            <li className="flex justify-between gap-3"><span>1ª resposta fora da meta</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.primeiraRespostaForaPrazo)}</strong></li>
            <li className="flex justify-between gap-3"><span>Nasce resolvido</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.resolvidoPrimeiroContato)}</strong></li>
            <li className="flex justify-between gap-3"><span>Em backlog, por chamado</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.backlog)}</strong></li>
            <li className="flex justify-between gap-3"><span>Reaberto, por reabertura</span><strong className="tabular-nums">{formatSignedPointsBr(pontos.reabertura)}</strong></li>
          </ul>
          <p className="text-[11px] text-[var(--text-tertiary)]">Os valores são de exemplo, ajustáveis em Configurações &gt; Pontuação do Ranking &gt; Chamado.</p>
        </div>
      </section>
    </div>
  );
}
