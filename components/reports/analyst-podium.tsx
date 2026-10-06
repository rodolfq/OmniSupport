'use client';

import React from 'react';
import { Crown, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PointsRow, formatPointsBr } from '@/lib/analyst-points';
import { formatSeconds, formatPercentage, formatDecimalBr } from '@/lib/report-format';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';

// Pódio do período, pela pontuação.
// - Em tela larga (sm+): três colunas, com o 1º no centro, um pouco mais alto, o 2º à
//   esquerda e o 3º à direita, com bases de altura proporcional.
// - Em celular: os três cards empilhados na ordem 1º, 2º, 3º, sem bases e com nome
//   completo. Três colunas não cabem em 390 px sem cortar nome e estatística.
// Mostra a pontuação e as três métricas de apoio, para o número não aparecer sem explicação.

interface AnalystPodiumProps {
  podium: PointsRow[];
  title: string;
  subtitle: string;
}

// Ordem visual em tela larga: 2º, 1º, 3º. A ordem do celular vem de `mobileOrder`.
const SLOTS = [
  { place: 2, base: 'h-16', ring: 'ring-slate-300 dark:ring-slate-500', baseTone: 'bg-slate-200 dark:bg-slate-700', medal: 'text-slate-500 dark:text-slate-300', label: 'Prata', mobileOrder: 'order-2 sm:order-none' },
  { place: 1, base: 'h-24', ring: 'ring-amber-400 dark:ring-amber-300', baseTone: 'bg-amber-300/80 dark:bg-amber-400/70', medal: 'text-amber-500 dark:text-amber-300', label: 'Ouro', mobileOrder: 'order-1 sm:order-none' },
  { place: 3, base: 'h-10', ring: 'ring-orange-300 dark:ring-orange-400', baseTone: 'bg-orange-200 dark:bg-orange-400/60', medal: 'text-orange-500 dark:text-orange-300', label: 'Bronze', mobileOrder: 'order-3 sm:order-none' },
] as const;

function PodiumCard({ entry, slot }: { entry: PointsRow | undefined; slot: typeof SLOTS[number] }) {
  if (!entry) {
    return (
      <div className={cn('flex flex-col items-center justify-end min-w-0', slot.mobileOrder)}>
        <div className="w-full rounded-2xl border border-dashed border-[var(--border-strong)] p-4 text-center mb-3 min-h-[7rem] sm:min-h-[11rem] flex flex-col items-center justify-center gap-2">
          <Medal size={22} className="text-[var(--text-tertiary)]" aria-hidden />
          <p className="text-xs text-[var(--text-tertiary)]">Aguardando analista com amostra suficiente</p>
        </div>
        <div className={cn('hidden sm:block w-full rounded-t-xl bg-[var(--surface-pill)]', slot.base)} aria-hidden />
      </div>
    );
  }

  const { row, breakdown } = entry;
  const isFirst = slot.place === 1;

  return (
    <div className={cn('flex flex-col items-center justify-end min-w-0', slot.mobileOrder)}>
      <div
        className={cn(
          'w-full rounded-2xl bg-[var(--surface-card)] border border-[var(--border-default)] shadow-sm p-4 text-center mb-3 transition-transform duration-300 hover:-translate-y-0.5',
          isFirst && 'shadow-lg ring-1 ring-[var(--accent)]/30'
        )}
      >
        <div className="flex justify-center mb-2">
          {isFirst ? <Crown size={22} className={slot.medal} aria-hidden /> : <Medal size={20} className={slot.medal} aria-hidden />}
        </div>
        <AnalystAvatar
          name={row.analystName}
          src={row.analystAvatarUrl}
          className={cn(
            'mx-auto mb-2 ring-2 ring-offset-2 ring-offset-[var(--surface-card)]',
            isFirst ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-sm',
            slot.ring
          )}
        />
        <p className="text-sm font-bold text-[var(--text-primary)] leading-snug break-words" title={row.analystName}>
          {row.analystName}
          {row.isSelf && <span className="ml-1 text-[9px] font-bold uppercase tracking-widest text-[var(--accent-text)]">você</span>}
        </p>
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">{slot.label} do período</p>

        <p className="mt-2 leading-none">
          <span className={cn('font-black tabular-nums', breakdown.total < 0 ? 'text-[var(--text-danger)]' : 'text-[var(--text-primary)]', isFirst ? 'text-4xl' : 'text-3xl')}>
            {formatPointsBr(breakdown.total)}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]"> pts</span>
        </p>

        <dl className="mt-3 grid grid-cols-3 gap-1 text-[10px] text-[var(--text-secondary)]">
          <div className="flex flex-col items-center">
            <dt className="text-[var(--text-tertiary)]">1ª resp.</dt>
            <dd className="font-semibold text-[var(--text-primary)] tabular-nums">{formatSeconds(row.firstResponseMedianSeconds)}</dd>
          </div>
          <div className="flex flex-col items-center">
            <dt className="text-[var(--text-tertiary)]">Satisf.</dt>
            <dd className="font-semibold text-[var(--text-primary)] tabular-nums">{formatPercentage(row.satisfactionPositiveRate)}</dd>
          </div>
          <div className="flex flex-col items-center">
            <dt className="text-[var(--text-tertiary)]">Chats/h</dt>
            <dd className="font-semibold text-[var(--text-primary)] tabular-nums">{formatDecimalBr(row.chatsPorHoraOnline, 1)}</dd>
          </div>
        </dl>
      </div>
      <div className={cn('hidden sm:block w-full rounded-t-xl', slot.baseTone, slot.base)} aria-hidden />
    </div>
  );
}

export function AnalystPodium({ podium, title, subtitle }: AnalystPodiumProps) {
  // Ordem visual em tela larga 2º · 1º · 3º. Em celular a ordem é controlada pelas classes `order-*`.
  const bySlot = (place: number) => podium.find((_, i) => i + 1 === place);

  return (
    <section aria-labelledby="podium-title" className="rounded-3xl bg-[var(--surface-card)] border border-[var(--border-default)] p-5 sm:p-6 md:p-8 shadow-sm overflow-hidden relative">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[var(--accent)]/10 blur-3xl pointer-events-none" aria-hidden />
      <header className="relative mb-6">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent-text)]">Ranking</p>
        <h2 id="podium-title" className="text-2xl font-black tracking-tight text-[var(--text-primary)]">{title}</h2>
        <p className="text-sm text-[var(--text-tertiary)]">{subtitle}</p>
      </header>
      <div className="relative flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:gap-6 sm:items-end sm:max-w-3xl sm:mx-auto">
        {SLOTS.map(slot => (
          <PodiumCard key={slot.place} slot={slot} entry={bySlot(slot.place)} />
        ))}
      </div>
    </section>
  );
}
