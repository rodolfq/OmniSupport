'use client';

import React from 'react';
import { cn } from '@/lib/utils';

// Avatar de analista: foto do perfil quando existe, iniciais quando não existe.
// `className` vale para os dois casos (tamanho, anel), então quem chama controla o
// visual e a regra de fallback fica num lugar só.

export function initialsOf(name: string): string {
  const numbered = name.match(/^Analista (\d+)$/);
  if (numbered) return `A${numbered[1]}`;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AnalystAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    // data URL vinda do banco: next/image não se aplica a ela.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={`Foto de ${name}`} className={cn('rounded-full object-cover', className)} loading="lazy" />;
  }
  return (
    <span
      className={cn('flex items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent-text)] font-black', className)}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
