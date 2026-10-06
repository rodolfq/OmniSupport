'use client';

import React from 'react';
import { cn } from '@/lib/utils';

// Seletor de visão do Desempenho por Analista: Chat, Chamado ou Geral. Só troca o conteúdo da página.
export type AnalystView = 'chat' | 'chamado' | 'geral';

const OPCOES: { id: AnalystView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'chamado', label: 'Chamado' },
  { id: 'geral', label: 'Geral' },
];

export function AnalystViewSwitch({ view, onChange }: { view: AnalystView; onChange: (v: AnalystView) => void }) {
  return (
    <div role="group" aria-label="Visão da avaliação" className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-sm">
      {OPCOES.map(o => {
        const ativo = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-bold transition-colors',
              ativo ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] hover:text-[var(--text-primary)]'
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
