'use client';

import React from 'react';
import {
  XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  BarChart, Bar, Cell, LabelList, Legend,
} from 'recharts';
import { AnalystPerformanceRow } from '@/lib/types';
import { PointsBreakdown, formatPointsBr } from '@/lib/analyst-points';
import { formatSeconds } from '@/lib/report-format';

// Gráficos do dashboard de analistas. Regras seguidas (skill dataviz):
// - uma série por gráfico quando possível; cor de destaque só para quem importa
//   (pódio), o resto em cinza. Sem legenda para série única, com legenda para 2+.
// - Bom e ruim usam a paleta de status fixa (verde e vermelho), sempre com legenda
//   textual, para o significado não depender só da cor.
// - Marcas finas, cantos arredondados só na ponta do dado, gap de 2px entre
//   segmentos empilhados, hairlines sólidas na grade, sem eixo duplo.
// - Texto usa tokens de texto, nunca a cor da marca.

// Entrada mínima de um analista para os gráficos (o ranking por pontos satisfaz isso).
export interface ChartEntry {
  row: AnalystPerformanceRow;
  eligible: boolean;
}

export interface ChartColors {
  accent: string;
  accentStrong: string;
  muted: string;
  grid: string;
  axis: string;
  text: string;
  textSecondary: string;
  surface: string;
  good: string;
  critical: string;
  median: string;
  tooltipBg: string;
  tooltipBorder: string;
}

export function chartColors(theme: 'light' | 'dark'): ChartColors {
  if (theme === 'dark') {
    return {
      accent: '#26D9BB', accentStrong: '#55E7CF', muted: '#475569', grid: '#2B3A4F', axis: '#94A3B8',
      text: '#E2E8F0', textSecondary: '#CBD5E1', surface: '#1C293B', good: '#0CA30C', critical: '#E66767',
      median: '#64748B', tooltipBg: '#2A3A52', tooltipBorder: '#3B4D66',
    };
  }
  return {
    accent: '#0FA694', accentStrong: '#026357', muted: '#CBD5E1', grid: '#E2E7EE', axis: '#64748B',
    text: '#0B1220', textSecondary: '#33475B', surface: '#FFFFFF', good: '#0CA30C', critical: '#D03B3B',
    median: '#94A3B8', tooltipBg: '#FFFFFF', tooltipBorder: '#E2E7EE',
  };
}

export function tooltipStyle(c: ChartColors) {
  return {
    borderRadius: 12,
    border: `1px solid ${c.tooltipBorder}`,
    background: c.tooltipBg,
    color: c.text,
    fontSize: 12,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.12)',
  };
}

// O Recharts pinta cada linha do tooltip com a cor da série. Nas barras "neutras" (cinza
// escuro no tema escuro) isso deixava o texto quase invisível sobre o fundo do tooltip.
// Por isso o texto do item e do rótulo ficam sempre com a cor de texto do tema.
export function tooltipTextStyle(c: ChartColors) {
  return { color: c.text, fontWeight: 600 };
}

// ---------------------------------------------------------------------------
// 1) Tempo de primeira resposta por analista (barras horizontais, série única).
// Ordem: mais rápido em cima. Linha vertical = mediana do time. Menor é melhor.
// ---------------------------------------------------------------------------
export function FirstResponseBars({
  scored, emphasizedIds, selectedId, onSelect, medianSeconds, colors,
}: {
  scored: ChartEntry[];
  emphasizedIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  medianSeconds: number | null;
  colors: ChartColors;
}) {
  // Só analistas do ranking: quem tem amostra insuficiente não entra na comparação.
  const data = scored
    .filter(s => s.eligible && s.row.firstResponseMedianSeconds !== null)
    .sort((a, b) => (a.row.firstResponseMedianSeconds as number) - (b.row.firstResponseMedianSeconds as number))
    .map(s => ({
      id: s.row.analystId,
      name: s.row.analystName,
      minutes: Math.round(((s.row.firstResponseMedianSeconds as number) / 60) * 10) / 10,
      emphasized: emphasizedIds.includes(s.row.analystId),
      selected: s.row.analystId === selectedId,
    }));

  if (data.length === 0) return <EmptyChart message="Nenhum analista do ranking com primeira resposta medida no período." />;

  const height = Math.max(220, data.length * 34 + 40);
  const maxMinutes = Math.max(...data.map(d => d.minutes), (medianSeconds ?? 0) / 60);
  const domainMax = Math.max(2, Math.ceil(maxMinutes * 1.25));
  // Mesma regra de formatSeconds: abaixo de 60 s, só segundos ("24s"); depois, "1m 16s".
  const minLabel = (m: number) => formatSeconds(m * 60);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 22, right: 40, bottom: 4, left: 0 }}>
        <XAxis type="number" domain={[0, domainMax]} hide />
        <YAxis
          type="category" dataKey="name" width={130} axisLine={false} tickLine={false}
          tick={{ fontSize: 12, fill: colors.textSecondary }}
        />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} contentStyle={tooltipStyle(colors)}
          itemStyle={tooltipTextStyle(colors)} labelStyle={tooltipTextStyle(colors)}
          formatter={(v: number) => [minLabel(v), '1ª resposta mediana']} labelFormatter={() => ''} />
        {medianSeconds !== null && (
          <ReferenceLine
            x={medianSeconds / 60}
            stroke={colors.axis}
            strokeWidth={1}
            label={{ value: `mediana do time: ${minLabel(medianSeconds / 60)}`, position: 'top', fontSize: 11, fill: colors.axis }}
          />
        )}
        <Bar dataKey="minutes" barSize={16} radius={[0, 4, 4, 0]} cursor="pointer"
          onClick={(d: any) => d?.id && onSelect(d.id)}>
          {data.map(d => (
            <Cell key={d.id} fill={d.emphasized || d.selected ? colors.accent : colors.muted} />
          ))}
          <LabelList dataKey="minutes" position="right" formatter={(v: number) => minLabel(v)}
            style={{ fontSize: 12, fill: colors.text, fontWeight: 600, paintOrder: 'stroke', stroke: colors.surface, strokeWidth: 3 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// 2) Chats atendidos por analista (barras horizontais, série única)
// ---------------------------------------------------------------------------
export function ChatsBars({
  scored, emphasizedIds, selectedId, onSelect, colors,
}: {
  scored: ChartEntry[];
  emphasizedIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  colors: ChartColors;
}) {
  const data = [...scored]
    .sort((a, b) => b.row.chatsAtendidos - a.row.chatsAtendidos)
    .map(s => ({
      id: s.row.analystId,
      name: s.row.analystName,
      chats: s.row.chatsAtendidos,
      emphasized: emphasizedIds.includes(s.row.analystId),
      selected: s.row.analystId === selectedId,
    }));

  if (data.length === 0) return <EmptyChart message="Nenhum atendimento no período." />;

  const height = Math.max(220, data.length * 34 + 24);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category" dataKey="name" width={130} axisLine={false} tickLine={false}
          tick={{ fontSize: 12, fill: colors.textSecondary }}
        />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} contentStyle={tooltipStyle(colors)}
          itemStyle={tooltipTextStyle(colors)} labelStyle={tooltipTextStyle(colors)}
          formatter={(v: number) => [`${v} chats`, 'Atendidos']} labelFormatter={() => ''} />
        <Bar
          dataKey="chats" barSize={16} radius={[0, 4, 4, 0]} cursor="pointer"
          onClick={(d: any) => d?.id && onSelect(d.id)}
        >
          {data.map(d => (
            <Cell key={d.id} fill={d.emphasized || d.selected ? colors.accent : colors.muted} />
          ))}
          <LabelList dataKey="chats" position="right" style={{ fontSize: 12, fill: colors.text, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// 3) Goods × Bads por analista (barras empilhadas, duas séries com legenda)
// ---------------------------------------------------------------------------
export function GoodsBadsBars({
  scored, onSelect, colors,
}: {
  scored: ChartEntry[];
  onSelect: (id: string) => void;
  colors: ChartColors;
}) {
  const data = scored
    .filter(s => (s.row.avaliacoes ?? 0) > 0)
    .sort((a, b) => (b.row.avaliacoes ?? 0) - (a.row.avaliacoes ?? 0))
    .map(s => ({
      id: s.row.analystId,
      name: s.row.analystName,
      Goods: s.row.positivas ?? 0,
      Bads: s.row.negativas ?? 0,
    }));

  if (data.length === 0) return <EmptyChart message="Nenhuma avaliação de cliente no período." />;

  const height = Math.max(220, data.length * 34 + 56);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 28, right: 24, bottom: 4, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category" dataKey="name" width={130} axisLine={false} tickLine={false}
          tick={{ fontSize: 12, fill: colors.textSecondary }}
        />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} contentStyle={tooltipStyle(colors)}
          itemStyle={tooltipTextStyle(colors)} labelStyle={tooltipTextStyle(colors)}
          formatter={(v: number, key: string) => [`${v}`, key === 'Goods' ? 'Goods (bom)' : 'Bads (ruim)']}
          labelFormatter={() => ''} />
        <Legend verticalAlign="top" align="left" iconType="circle" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
          formatter={(value: string) => <span style={{ color: colors.textSecondary }}>{value === 'Goods' ? 'Goods (bom)' : 'Bads (ruim)'}</span>} />
        <Bar dataKey="Goods" stackId="sat" fill={colors.good} stroke={colors.surface} strokeWidth={2} barSize={16} cursor="pointer"
          onClick={(d: any) => d?.id && onSelect(d.id)} />
        <Bar dataKey="Bads" stackId="sat" fill={colors.critical} stroke={colors.surface} strokeWidth={2} barSize={16} radius={[0, 4, 4, 0]} cursor="pointer"
          onClick={(d: any) => d?.id && onSelect(d.id)}>
          <LabelList dataKey="Bads" position="right" style={{ fontSize: 11, fill: colors.textSecondary }} formatter={(v: number) => (v > 0 ? v : '')} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// 4) Composição da pontuação do analista selecionado (barras com sinal)
// Positivo em verde-teal, negativo em vermelho, linha zero como referência.
// ---------------------------------------------------------------------------
export function PointsBreakdownChart({
  breakdown, colors,
}: {
  breakdown: PointsBreakdown;
  colors: ChartColors;
}) {
  const data = [
    { item: 'Volume', pts: breakdown.volume },
    { item: 'Good', pts: breakdown.good },
    { item: 'Bad', pts: breakdown.bad },
    { item: '< 1 min', pts: breakdown.lt1 },
    { item: '1 a 3 min', pts: breakdown.lt3 },
    { item: '> 3 min', pts: breakdown.gt3 },
  ];

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: 0 }}>
        <XAxis dataKey="item" axisLine={{ stroke: colors.grid }} tickLine={false}
          tick={{ fontSize: 11, fill: colors.textSecondary }} interval={0} />
        <YAxis hide />
        <ReferenceLine y={0} stroke={colors.axis} strokeWidth={1} />
        <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} contentStyle={tooltipStyle(colors)}
          itemStyle={tooltipTextStyle(colors)} labelStyle={tooltipTextStyle(colors)}
          formatter={(v: number) => [`${v > 0 ? '+' : ''}${formatPointsBr(v)} pts`, 'Pontos']} labelFormatter={(label) => String(label)} />
        <Bar dataKey="pts" barSize={22} radius={[4, 4, 4, 4]}>
          {data.map(d => (
            <Cell key={d.item} fill={d.pts >= 0 ? colors.accent : colors.critical} />
          ))}
          <LabelList dataKey="pts" position="top" formatter={(v: number) => `${v > 0 ? '+' : ''}${formatPointsBr(v)}`}
            style={{ fontSize: 11, fill: colors.text, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-tertiary)] text-center px-6">
      {message}
    </div>
  );
}
