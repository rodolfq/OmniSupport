'use client';

import React from 'react';
import { Crown, Medal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalystAvatar } from '@/components/reports/analyst-avatar';

// Pódio com coroa (1º) e medalhas (2º prata, 3º bronze). Usado no pódio geral e no de chamados,
// para as duas visões ficarem iguais. Os degraus têm a altura do lugar: 1º é o mais alto.

export interface PodiumItem {
  id: string;
  nome: string;
  avatarUrl: string | null;
  principal: string;       // número em destaque (ex.: "87" ou "180,50")
  principalRotulo: string; // ex.: "nota geral de 100" ou "pontos"
  detalhes: { rotulo: string; valor: string }[];
  isSelf?: boolean;
}

const COR = {
  1: { anel: '#f5c542', brilho: 'rgba(245,197,66,0.45)', degrau: 'from-[#f7d774] via-[#f5c542] to-[#c99a1e]', texto: 'text-[#c9980f]', titulo: 'Campeão' },
  2: { anel: '#c9d1db', brilho: 'rgba(201,209,219,0.35)', degrau: 'from-[#e5e9ef] via-[#c9d1db] to-[#8f9aa8]', texto: 'text-[#8e9aab]', titulo: '2º lugar' },
  3: { anel: '#c98a4b', brilho: 'rgba(201,138,75,0.35)', degrau: 'from-[#e7b48a] via-[#c98a4b] to-[#8a5a2b]', texto: 'text-[#b8743a]', titulo: '3º lugar' },
} as const;

export function PodiumStage({ items, titulo, subtitulo }: { items: PodiumItem[]; titulo: string; subtitulo?: string }) {
  if (items.length === 0) return null;
  // Ordem visual: 2º à esquerda, 1º no centro, 3º à direita.
  const ordem: { pos: 1 | 2 | 3; item: PodiumItem | undefined }[] = [
    { pos: 2, item: items[1] },
    { pos: 1, item: items[0] },
    { pos: 3, item: items[2] },
  ];

  return (
    <section aria-labelledby="podium-stage-title" className="relative overflow-hidden rounded-3xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-lg">
      {/* brilho de fundo */}
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(245,197,66,0.18),transparent)]" />
      <div className="relative px-6 pt-6 pb-6">
        <div className="flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5c542]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-[#c9980f]">
            <Crown size={12} aria-hidden /> {titulo}
          </span>
          <h3 id="podium-stage-title" className="sr-only">{titulo}</h3>
          {subtitulo && <p className="mt-2 text-xs text-[var(--text-tertiary)]">{subtitulo}</p>}
        </div>

        <div className="mt-6 flex items-end justify-center gap-3 sm:gap-6">
          {ordem.map(({ pos, item }) => {
            if (!item) return <div key={pos} className="w-1/3 max-w-[220px]" />;
            const c = COR[pos];
            const primeiro = pos === 1;
            return (
              <div
                key={item.id}
                className={cn(
                  'flex w-1/3 max-w-[220px] flex-col items-center',
                  pos === 1 && 'order-1 sm:order-none',
                  pos === 2 && 'order-2 sm:order-none',
                  pos === 3 && 'order-3 sm:order-none'
                )}
              >
                {/* coroa ou medalha */}
                {primeiro ? (
                  <Crown size={34} className="text-[#f5c542] drop-shadow-[0_2px_6px_rgba(245,197,66,0.6)] animate-pulse" aria-hidden />
                ) : (
                  <Medal size={32} strokeWidth={2.25} aria-hidden style={{ color: pos === 2 ? '#aeb8c4' : '#c98a4b' }} className="drop-shadow" />
                )}

                {/* avatar com anel metálico */}
                <div
                  className={cn('mt-2 rounded-full p-[3px]', primeiro ? 'h-[104px] w-[104px]' : 'h-[80px] w-[80px]')}
                  style={{ background: `conic-gradient(from 210deg, ${c.anel}, #ffffff80, ${c.anel}, #ffffff40, ${c.anel})`, boxShadow: `0 0 28px ${c.brilho}` }}
                >
                  <AnalystAvatar name={item.nome} src={item.avatarUrl} className={cn('h-full w-full bg-[var(--surface-card)] text-[var(--text-primary)]', primeiro ? 'text-2xl' : 'text-lg')} />
                </div>

                <p className="mt-3 max-w-full truncate text-sm font-bold text-[var(--text-primary)]">
                  {item.nome}{item.isSelf && <span className="ml-1 text-[9px] uppercase text-[var(--accent-text)]">você</span>}
                </p>
                <p className={cn('mt-0.5 text-[10px] font-black uppercase tracking-widest', c.texto)}>{c.titulo}</p>

                <p className={cn('mt-2 font-black tabular-nums leading-none', primeiro ? 'text-5xl' : 'text-3xl', c.texto)}>{item.principal}</p>
                <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{item.principalRotulo}</p>

                <dl className="mt-3 w-full space-y-1 text-[11px]">
                  {item.detalhes.map(d => (
                    <div key={d.rotulo} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-pill)] px-2 py-1">
                      <dt className="text-[var(--text-tertiary)]">{d.rotulo}</dt>
                      <dd className="font-bold tabular-nums text-[var(--text-primary)]">{d.valor}</dd>
                    </div>
                  ))}
                </dl>

                {/* degrau */}
                <div
                  className={cn(
                    'mt-4 flex w-full items-start justify-center rounded-2xl bg-gradient-to-b pt-2 text-2xl font-black text-white/90 shadow-inner',
                    c.degrau,
                    primeiro ? 'h-32' : pos === 2 ? 'h-24' : 'h-20'
                  )}
                  aria-hidden
                >
                  {pos}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
