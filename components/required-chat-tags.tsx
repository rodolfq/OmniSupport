'use client';

import React from 'react';
import { AlertTriangle, Check, Tag as TagIcon } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import { tagAccentBgClass } from '@/components/chat-tag-picker';

/**
 * Seletor de tags mostrado DENTRO dos modais que encerram a conversa, quando
 * ela ainda não tem nenhuma: encerrar exige ao menos 1 tag (regra do servidor,
 * action 'close' de app/api/chat-sessions/route.ts). Lista todas as tags de chat
 * direto no modal (sem popover, que seria cortado pelo painel arredondado) e
 * avisa enquanto não houver seleção; ao marcar a primeira, o aviso vira
 * confirmação e o botão de encerrar destrava (quem usa controla o `disabled`).
 */
export function RequiredChatTags({
  tags,
  selectedIds,
  onChange,
  disabled = false
}: {
  tags: TagConfig[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const hasTag = selectedIds.some(id => tags.some(t => t.id === id));

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(t => t !== id) : [...selectedIds, id]);
  };

  return (
    <div
      role="group"
      aria-labelledby="required-tags-title"
      className={cn(
        'rounded-2xl border p-4 space-y-3 transition-colors',
        hasTag
          ? 'bg-[var(--surface-success)] border-[var(--text-success)]/25'
          : 'bg-[var(--surface-warning)] border-[var(--border-alert)]'
      )}
    >
      <div className="flex items-start gap-2.5">
        {hasTag
          ? <Check size={16} className="text-[var(--text-success)] shrink-0 mt-0.5" />
          : <AlertTriangle size={16} className="text-[var(--text-warning-strong)] shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p id="required-tags-title" className={cn('text-xs font-black uppercase tracking-wider', hasTag ? 'text-[var(--text-success)]' : 'text-[var(--text-warning)]')}>
            {hasTag ? 'Tag selecionada' : 'Tag obrigatória'}
          </p>
          <p className={cn('text-[11px] font-medium leading-relaxed mt-0.5', hasTag ? 'text-[var(--text-success)]' : 'text-[var(--text-warning)]')}>
            {hasTag
              ? 'Tudo certo — você pode finalizar a conversa.'
              : 'Selecione ao menos 1 tag para poder finalizar esta conversa.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.map(tag => {
          const active = selectedIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => toggle(tag.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60',
                active
                  ? 'bg-[var(--surface-card)] border-[var(--accent)] text-[var(--accent-text)] shadow-sm'
                  : 'bg-[var(--surface-card)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent)]/60'
              )}
            >
              <span className={cn('w-2 h-2 rounded-full shrink-0', tagAccentBgClass(tag))} />
              {tag.label}
              {active && <Check size={11} className="shrink-0" />}
            </button>
          );
        })}
        {tags.length === 0 && (
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
            <TagIcon size={11} /> Nenhuma tag de chat cadastrada
          </p>
        )}
      </div>
    </div>
  );
}
