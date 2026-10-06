'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Tag as TagIcon } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import { tagAccentBgClass } from '@/components/chat-tag-picker';

/**
 * Seletor de tags mostrado DENTRO dos modais que encerram a conversa, quando
 * ela ainda não tem nenhuma: encerrar exige ao menos 1 tag (regra do servidor,
 * action 'close' de app/api/chat-sessions/route.ts). A lista de tags fica num
 * dropdown que só abre ao clicar (antes eram todas as tags em chips, ocupando
 * espaço do modal conforme o cadastro cresce). Multisseleção: o dropdown
 * continua aberto enquanto se marca várias; fecha ao clicar fora ou com Esc.
 * Avisa enquanto não houver seleção; ao marcar a primeira, o aviso vira
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedTags = tags.filter(t => selectedIds.includes(t.id));
  const hasTag = selectedTags.length > 0;

  // Mesmo padrão de ChatTagPicker (chat-tag-picker.tsx): fecha ao clicar fora e
  // com Esc, só enquanto aberto.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Se o seletor ficar desabilitado (ex.: encerramento em andamento) enquanto
  // aberto, recolhe — senão o dropdown ficaria aberto sem poder mudar nada.
  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(t => t !== id) : [...selectedIds, id]);
  };

  const triggerLabel = hasTag
    ? selectedTags.map(t => t.label).join(', ')
    : 'Selecionar tags...';

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

      {tags.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
          <TagIcon size={11} /> Nenhuma tag de chat cadastrada
        </p>
      ) : (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            disabled={disabled}
            onClick={() => setIsOpen(prev => !prev)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-left transition-all hover:border-[var(--accent)]/60 disabled:opacity-60"
          >
            <span className="flex items-center gap-2 min-w-0">
              {selectedTags.slice(0, 3).map(tag => (
                <span key={tag.id} className={cn('w-2 h-2 rounded-full shrink-0', tagAccentBgClass(tag))} />
              ))}
              <span className={cn('text-xs font-semibold truncate', hasTag ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                {triggerLabel}
              </span>
            </span>
            <ChevronDown size={14} className={cn('shrink-0 text-[var(--text-tertiary)] transition-transform', isOpen && 'rotate-180')} />
          </button>

          {isOpen && (
            <div
              role="listbox"
              aria-multiselectable="true"
              className="absolute left-0 right-0 top-full mt-2 z-30 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden py-1 max-h-64 overflow-y-auto"
            >
              {tags.map(tag => {
                const active = selectedIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(tag.id)}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold transition-all',
                      active
                        ? 'text-[var(--accent-text)] bg-[var(--surface-pill)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]'
                    )}
                  >
                    <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', tagAccentBgClass(tag))} />
                    <span className="flex-1 text-left truncate">{tag.label}</span>
                    {active && <Check size={14} className="text-[var(--accent-text)] shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
