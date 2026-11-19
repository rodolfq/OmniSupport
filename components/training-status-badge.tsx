'use client';

import React from 'react';
import { GraduationCap, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CompanyTrainingStatus } from '@/lib/types';

// Badge do status de treinamento da empresa — reaproveitado em toda tela que
// mostra esse indicador (lista/detalhe de Empresas, página dedicada da
// empresa, cabeçalho do chat) pra não ficar um ícone/cor diferente pro mesmo
// dado. Substituiu o booleano "Cliente em Treinamento" (2026-11-19, pedido do
// usuário) — agora são 3 estados: null (sem badge nenhum), 'em_treinamento' e
// 'treinamento_concluido', cada um com ícone e cor próprios.
export function TrainingStatusBadge({
  status,
  size = 'md',
  title,
  className,
}: {
  status: CompanyTrainingStatus | undefined;
  size?: 'sm' | 'md';
  title?: string;
  className?: string;
}) {
  if (!status) return null;

  const isDone = status === 'treinamento_concluido';
  const Icon = isDone ? CheckCircle2 : GraduationCap;
  const label = isDone ? 'Treinamento concluído' : 'Em treinamento';
  const colorClass = isDone
    ? 'bg-[var(--surface-success)] text-[var(--text-success)]'
    : 'bg-[var(--surface-info)] text-[var(--text-info)]';

  return (
    <span
      title={title || `${label} — visível só pra equipe interna`}
      className={cn(
        'inline-flex items-center gap-1 font-black uppercase tracking-widest rounded',
        size === 'sm' ? 'text-[9px] px-1.5 py-0.5 gap-1' : 'text-[10px] px-2.5 py-1 rounded-lg gap-1.5',
        colorClass,
        className
      )}
    >
      <Icon size={size === 'sm' ? 10 : 12} /> {label}
    </span>
  );
}
