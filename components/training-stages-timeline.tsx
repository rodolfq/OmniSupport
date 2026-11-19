'use client';

import React from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Linha do tempo vertical das Etapas de Treinamento — reformulação pedida
// pelo usuário (2026-11-19) no lugar da grade de cartões de antes. Usado nos
// dois lugares que mostram a mesma trilha (mesmo componente, pra não ficar
// um padrão visual diferente pro mesmo dado): o painel de edição da empresa
// em Empresas (app/(portal)/customers/page.tsx) e a página dedicada da
// empresa (app/(portal)/customers/[id]/page.tsx).
//
// 'Erro' é tratado aqui (bolinha vermelha com X) mas NÃO é um status que o
// banco aceita hoje — a trava em `training_stages_status_check` só libera
// 'Não concluído' / 'Em andamento' / 'Concluído', e a API externa de
// integração (única escritora desta trilha) valida contra essa mesma lista.
// Decisão do usuário: deixar o componente pronto pra esse status sem mexer
// no banco/API agora — por isso `status` aqui é string solta, não a união
// fechada de 3 valores de TrainingStage['status'] (que continua a de verdade
// em lib/services/company-service.ts).
interface TrainingStageLike {
  id: string;
  name: string;
  status: string;
  notes?: string | null;
}

const STATUS_META: Record<string, { label: string; chip: string }> = {
  'Concluído': { label: 'Concluído', chip: 'bg-[var(--surface-success)] text-[var(--text-success)]' },
  'Em andamento': { label: 'Em andamento', chip: 'bg-[var(--surface-warning)] text-[var(--text-warning)]' },
  'Não concluído': { label: 'Não concluído', chip: 'bg-[var(--surface-pill)] text-[var(--text-tertiary)]' },
  'Erro': { label: 'Erro', chip: 'bg-[var(--surface-danger)] text-[var(--text-danger)]' },
};

function statusMeta(status: string) {
  return STATUS_META[status] || STATUS_META['Não concluído'];
}

function StageMarker({ status }: { status: string }) {
  if (status === 'Concluído') {
    return (
      <span className="relative z-10 w-6 h-6 rounded-full bg-[var(--text-success)] text-white flex items-center justify-center shrink-0 shadow-sm">
        <Check size={14} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'Erro') {
    return (
      <span className="relative z-10 w-6 h-6 rounded-full bg-[var(--text-danger)] text-white flex items-center justify-center shrink-0 shadow-sm">
        <X size={14} strokeWidth={3} />
      </span>
    );
  }
  if (status === 'Em andamento') {
    return (
      <span className="relative z-10 w-6 h-6 rounded-full border-2 border-[var(--text-warning)] bg-[var(--surface-card)] flex items-center justify-center shrink-0">
        <Loader2 size={12} className="text-[var(--text-warning)] animate-spin" strokeWidth={3} />
      </span>
    );
  }
  // Não concluído — bolinha neutra: só um pontinho cinza, sem preenchimento forte.
  return (
    <span className="relative z-10 w-6 h-6 rounded-full border-2 border-[var(--border-strong)] bg-[var(--surface-card)] flex items-center justify-center shrink-0">
      <span className="w-2 h-2 rounded-full bg-[var(--text-tertiary)]/50" />
    </span>
  );
}

export function TrainingStagesTimeline({ stages, className }: { stages: TrainingStageLike[]; className?: string }) {
  if (stages.length === 0) return null;
  return (
    <ol className={cn('relative', className)}>
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        const meta = statusMeta(stage.status);
        // O trecho da linha entre esta etapa e a próxima fica verde só
        // quando ESTA já foi concluída — lê como "progresso", não como
        // adorno: o olho segue o verde até onde o treinamento realmente
        // chegou.
        const connectorDone = stage.status === 'Concluído';
        return (
          <li key={stage.id} className={cn('relative pl-9', !isLast && 'pb-5')}>
            {!isLast && (
              <span
                className={cn(
                  'absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full',
                  connectorDone ? 'bg-[var(--text-success)]' : 'bg-[var(--border-default)]'
                )}
              />
            )}
            <span className="absolute left-0 top-0">
              <StageMarker status={stage.status} />
            </span>
            <div className="flex items-center justify-between gap-2 min-h-6">
              <span className="text-sm font-bold text-[var(--text-primary)] truncate">{stage.name}</span>
              <span className={cn('shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg', meta.chip)}>
                {meta.label}
              </span>
            </div>
            {stage.notes && (
              <p className="text-xs text-[var(--text-tertiary)] font-medium mt-1">{stage.notes}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
