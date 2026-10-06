'use client';

import React, { useState } from 'react';
import { MessageSquare, Ticket } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RankingPointsSettings } from '@/components/ranking-points-settings';
import { TicketPointsSettings } from '@/components/ticket-points-settings';

// Configurações > Pontuação do Ranking. Uma tela só, com as duas avaliações separadas:
// Chat (pontos da conversa) e Chamado (metas e pontos dos chamados).
type Aba = 'chat' | 'chamado';

const ABAS: { id: Aba; label: string; descricao: string; icone: React.ElementType }[] = [
  { id: 'chat', label: 'Chat', descricao: 'Pontos de conversa: volume, good, bad e tempo de primeira resposta.', icone: MessageSquare },
  { id: 'chamado', label: 'Chamado', descricao: 'Metas da área e pontos de SLA, primeira resposta, resolução, backlog e reabertura.', icone: Ticket },
];

export function RankingSettingsHub() {
  const [aba, setAba] = useState<Aba>('chat');
  const atual = ABAS.find(a => a.id === aba) ?? ABAS[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Avaliação" className="inline-flex w-fit rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-sm">
          {ABAS.map(a => {
            const Icone = a.icone;
            const ativa = aba === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => setAba(a.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors',
                  ativa ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icone size={15} aria-hidden /> {a.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">{atual.descricao}</p>
      </div>

      <div role="tabpanel">
        {aba === 'chat' ? <RankingPointsSettings /> : <TicketPointsSettings />}
      </div>
    </div>
  );
}
