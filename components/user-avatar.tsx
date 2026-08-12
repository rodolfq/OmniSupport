'use client';

import React from 'react';
import { cn } from '@/lib/utils';

// Avatar de pessoa em tamanho pequeno (card, linha de lista, campo de
// formulário). Existe pra que o enquadramento seja o mesmo em todo lugar:
// antes cada tela repetia o mesmo <img class="w-5 h-5 rounded-full"> na mão e
// bastava uma esquecer o object-cover pra foto sair esticada.
//
// Duas regras que a implementação garante:
//
// 1. A imagem ocupa exatamente o quadro pedido. `width`/`height` vão em pixel
//    (não em classe utilitária) e o CSS repete o mesmo valor, então o espaço
//    reservado no layout é o espaço final — a lista não "pula" quando a
//    imagem termina de carregar.
// 2. Foto retangular não distorce. `object-cover` recorta pelo centro em vez
//    de espremer; a miniatura já é gerada quadrada (48x48, fit cover, ver
//    lib/services/avatar-thumb-service.ts), mas a foto cheia usada como
//    fallback não é.
//
// Sempre prefira `thumbUrl`: são ~1,3kB contra até 2,7MB da foto cheia, que é
// a mesma imagem base64 guardada em profiles.avatar_url. `url` só entra como
// reserva pra quem ainda não teve miniatura gerada.

interface UserAvatarProps {
  name?: string | null;
  thumbUrl?: string | null;
  url?: string | null;
  /** Lado do quadro em pixels. O padrão 20 equivale ao antigo w-5 h-5. */
  size?: number;
  /**
   * Formato do quadro, em classe utilitária. A foto herda exatamente o mesmo
   * recorte da caixa que ela substitui — num lugar onde o espaço reservado é
   * `rounded-lg`, uma foto circular quebraria o alinhamento com os vizinhos.
   */
  rounded?: string;
  /**
   * Aparência do quadro quando NÃO há foto. Cada tela tem a sua (fundo accent
   * com texto branco no dashboard, pill acinzentado nas listas), e trocar isso
   * por um padrão único mudaria o visual de telas que ninguém pediu pra mexer.
   */
  fallbackClassName?: string;
  title?: string;
  className?: string;
}

export function UserAvatar({
  name,
  thumbUrl,
  url,
  size = 20,
  rounded = 'rounded-full',
  fallbackClassName,
  title,
  className
}: UserAvatarProps) {
  const source = thumbUrl || url || null;
  const dimension = { width: size, height: size } as const;

  if (source) {
    return (
      <img
        src={source}
        alt={name || ''}
        title={title ?? name ?? undefined}
        width={size}
        height={size}
        style={dimension}
        className={cn(rounded, 'object-cover shrink-0', className)}
      />
    );
  }

  // Sem foto: inicial do nome no mesmo quadro, pra não desalinhar a linha.
  // A fonte acompanha o tamanho do quadro em vez de ser fixa, senão a letra
  // vaza no avatar pequeno e fica perdida no grande.
  return (
    <div
      title={title ?? name ?? undefined}
      style={{ ...dimension, fontSize: Math.max(7, Math.round(size * 0.42)) }}
      className={cn(
        rounded,
        'flex items-center justify-center shrink-0 select-none uppercase leading-none font-semibold',
        fallbackClassName || 'bg-[var(--border-default)] text-[var(--text-secondary)]',
        className
      )}
    >
      {(name || '?').charAt(0)}
    </div>
  );
}
