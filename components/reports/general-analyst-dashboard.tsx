'use client';

import React, { useMemo } from 'react';
import { Trophy, RotateCcw, Layers, Info } from 'lucide-react';
import { PodiumStage } from '@/components/reports/podium-stage';
import { AnalystPerformanceRow, TicketAnalystRow } from '@/lib/types';
import { PointsWeights, rankPoints, formatPointsBr, formatSignedPointsBr } from '@/lib/analyst-points';

import { ReportSectionStatus } from '@/components/reports/report-section';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';

// Visão GERAL: junta o ranking de chat e o de chamado. Cada visão é normalizada de 0 a 100 dentro
// do time (menor = 0, maior = 100) e a nota geral é a média das visões em que o analista tem amostra.
// É a sugestão inicial do usuário ("vamos tentar, podemos mudar depois").

interface GeneralDashboardProps {
  chatRows: AnalystPerformanceRow[];
  weights: PointsWeights;
  ticketRows: TicketAnalystRow[];
  status: ReportSectionStatus;
  onRetry?: () => void;
  periodTitle: string;
  filterSummary: string;
}

interface GeneralEntry {
  id: string;
  nome: string;
  avatarUrl: string | null;
  chatPontos: number | null;
  chatNota: number | null;
  chamadoPontos: number | null;
  chamadoNota: number | null;
  geral: number;
  visoes: number;
}

// Min-max por time. Quem não tem amostra numa visão fica de fora dela (não recebe nota 0 por falta de dado).
function normalizar(valores: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (valores.size === 0) return out;
  const nums = Array.from(valores.values());
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  for (const [id, v] of valores) out.set(id, max === min ? 100 : ((v - min) / (max - min)) * 100);
  return out;
}

export function GeneralAnalystDashboard({ chatRows, weights, ticketRows, status, onRetry, periodTitle, filterSummary }: GeneralDashboardProps) {
  const entries = useMemo<GeneralEntry[]>(() => {
    const chatElegiveis = rankPoints(chatRows, weights).filter(r => r.eligible);
    const chatPontos = new Map(chatElegiveis.map(r => [r.row.analystId, r.breakdown.total]));
    const ticketElegiveis = ticketRows.filter(r => !r.amostraInsuficiente);
    const ticketPontos = new Map(ticketElegiveis.map(r => [r.analystId, r.points.total]));
    const chatNota = normalizar(chatPontos);
    const ticketNota = normalizar(ticketPontos);

    const ids = new Set<string>([...chatPontos.keys(), ...ticketPontos.keys()]);
    const chatInfo = new Map(chatRows.map(r => [r.analystId, r]));
    const ticketInfo = new Map(ticketRows.map(r => [r.analystId, r]));

    const lista: GeneralEntry[] = [];
    for (const id of ids) {
      const cNota = chatNota.get(id) ?? null;
      const tNota = ticketNota.get(id) ?? null;
      const notas = [cNota, tNota].filter((n): n is number => n !== null);
      const info = ticketInfo.get(id) ?? chatInfo.get(id);
      lista.push({
        id,
        nome: info?.analystName ?? 'Analista',
        avatarUrl: (info as any)?.avatarUrl ?? (info as any)?.analystAvatarUrl ?? null,
        chatPontos: chatPontos.get(id) ?? null,
        chatNota: cNota,
        chamadoPontos: ticketPontos.get(id) ?? null,
        chamadoNota: tNota,
        geral: notas.reduce((a, b) => a + b, 0) / notas.length,
        visoes: notas.length,
      });
    }
    return lista.sort((a, b) => b.geral - a.geral || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [chatRows, weights, ticketRows]);

  if (status === 'loading') {
    return <div className="h-72 animate-pulse rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)]" aria-busy="true" aria-label="Carregando visão geral" />;
  }
  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-[var(--border-alert)] bg-[var(--surface-warning)] p-5 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">Não foi possível montar a visão geral.</p>
        {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-text)]"><RotateCcw size={14} aria-hidden /> Tentar de novo</button>}
      </div>
    );
  }

  const podio = entries.slice(0, 3);

  return (
    <div className="space-y-6">
      {entries.length > 0 && (
            <PodiumStage
              titulo="Pódio geral"
              subtitulo="Nota de 0 a 100 em cada visão, média entre chat e chamado"
              items={podio.map(e => ({
                id: e.id,
                nome: e.nome,
                avatarUrl: e.avatarUrl,
                principal: e.geral.toFixed(0),
                principalRotulo: 'nota geral de 100',
                detalhes: [
                  { rotulo: 'Chat', valor: e.chatNota === null ? 'sem amostra' : `${e.chatNota.toFixed(0)} · ${formatPointsBr(e.chatPontos ?? 0)} pts` },
                  { rotulo: 'Chamado', valor: e.chamadoNota === null ? 'sem amostra' : `${e.chamadoNota.toFixed(0)} · ${formatSignedPointsBr(e.chamadoPontos ?? 0)} pts` },
                  { rotulo: 'Visões', valor: `${e.visoes} de 2` },
                ],
              }))}
            />
      )}

      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent-text)]">{periodTitle}</p>
        <h2 className="mt-1 text-2xl font-black text-[var(--text-primary)] tracking-tight">Desempenho geral: chat e chamado juntos</h2>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">{filterSummary || 'Período selecionado'} · nota de 0 a 100 por visão, média entre as visões</p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-tertiary)]">
          Nenhum analista atingiu a amostra mínima em chat ou em chamado no período.
        </div>
      ) : (
        <>
          {/* Ranking geral */}
          <section aria-labelledby="general-ranking-title" className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={18} className="text-[var(--accent-text)]" aria-hidden />
              <h3 id="general-ranking-title" className="text-lg font-bold text-[var(--text-primary)]">Ranking geral</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-default)]">
                    <th className="py-2 text-left font-bold">#</th>
                    <th className="py-2 text-left font-bold">Analista</th>
                    <th className="py-2 text-right font-bold">Geral</th>
                    <th className="py-2 text-right font-bold">Chat (pontos · nota)</th>
                    <th className="py-2 text-right font-bold">Chamado (pontos · nota)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-default)]">
                  {entries.map((e, i) => (
                    <tr key={e.id}>
                      <td className="py-2 font-bold text-[var(--text-tertiary)] tabular-nums">{i + 1}</td>
                      <td className="py-2">
                        <span className="inline-flex items-center gap-2">
                          <AnalystAvatar name={e.nome} src={e.avatarUrl} className="h-7 w-7 text-[10px]" />
                          <span className="font-semibold text-[var(--text-primary)]">{e.nome}</span>
                          {e.visoes === 1 && <span className="text-[10px] text-[var(--text-tertiary)]">(uma visão)</span>}
                        </span>
                      </td>
                      <td className="py-2 text-right font-black tabular-nums text-[var(--accent-text)]">{e.geral.toFixed(0)}</td>
                      <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                        {e.chatPontos === null ? '—' : `${formatPointsBr(e.chatPontos)} · ${e.chatNota!.toFixed(0)}`}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                        {e.chamadoPontos === null ? '—' : `${formatSignedPointsBr(e.chamadoPontos)} · ${e.chamadoNota!.toFixed(0)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] p-5 text-xs text-[var(--text-secondary)] space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]"><Info size={15} aria-hidden /> Como a nota geral é formada</h4>
        <p>Cada visão (chat e chamado) vira uma nota de 0 a 100: o menor ponto do time vale 0 e o maior vale 100. A nota geral é a média das visões em que o analista tem amostra. Quem tem amostra em só uma visão aparece marcado como “uma visão”.</p>
        <p className="flex items-center gap-1.5"><Layers size={13} aria-hidden /> Como a nota depende do time, ela muda quando o time muda. Por isso é uma referência de ordem, não uma medida absoluta.</p>
      </section>
    </div>
  );
}
