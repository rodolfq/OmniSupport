'use client';

import React, { useState } from 'react';
import { MessageSquare, Ticket, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RankingPointsSettings } from '@/components/ranking-points-settings';
import { TicketPointsSettings } from '@/components/ticket-points-settings';
import { InternalRuleSettings } from '@/components/internal-rule-settings';

// Configurações > Pontuação do Ranking. Uma tela só, com as avaliações separadas:
// Chat e Chamado (pontos e metas), e Ticket interno (regra de 2 dias). Cada aba aparece só
// para quem tem a permissão dela.
type Aba = 'chat' | 'chamado' | 'interno';

interface HubProps {
  canRanking: boolean;   // reports:ranking_config (Chat e Chamado)
  canInternal: boolean;  // internal:rules_config (Ticket interno, editar; ver a regra exige também o acesso à tela)
}

export function RankingSettingsHub({ canRanking, canInternal }: HubProps) {
  const abas: { id: Aba; label: string; descricao: string; icone: React.ElementType }[] = [
    ...(canRanking ? [
      { id: 'chat' as Aba, label: 'Chat', descricao: 'Pontos de conversa: volume, good, bad e tempo de primeira resposta.', icone: MessageSquare },
      { id: 'chamado' as Aba, label: 'Chamado', descricao: 'Metas da área e pontos de SLA, primeira resposta, resolução, backlog e reabertura.', icone: Ticket },
    ] : []),
    ...(canInternal ? [
      { id: 'interno' as Aba, label: 'Ticket interno', descricao: 'Regra de 2 dias: estrelas mínimas e dias úteis até o ticket ser marcado Resolvido.', icone: Flag },
    ] : []),
  ];
  const [aba, setAba] = useState<Aba>(abas[0]?.id ?? 'interno');
  const atual = abas.find(a => a.id === aba) ?? abas[0];

  if (abas.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Avaliação" className="inline-flex w-fit flex-wrap rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-1 shadow-sm">
          {abas.map(a => {
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
        {atual && <p className="text-xs text-[var(--text-tertiary)]">{atual.descricao}</p>}
      </div>

      <div role="tabpanel">
        {aba === 'chat' && canRanking && <RankingPointsSettings />}
        {aba === 'chamado' && canRanking && <TicketPointsSettings />}
        {aba === 'interno' && <InternalRuleSettings podeEditar={canInternal} />}
      </div>
    </div>
  );
}
