'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Tag as TagIcon } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import { tagAccentBgClass } from '@/components/chat-tag-picker';

/**
 * Seletor de tags mostrado DENTRO dos modais que encerram a conversa, quando
 * ela ainda não satisfaz a regra de tag obrigatória (regra do servidor, action
 * 'close' de app/api/chat-sessions/route.ts). Desde 2026-10-21 as tags viraram
 * hierárquicas (tag principal → subtags, `parentTagId`) — este seletor passou
 * de "lista solta com todas as tags, até subtags" pra um fluxo em 2 passos:
 * (1) escolher UMA tag principal (single-select, nunca mais de uma — é o que
 * o usuário pediu), (2) se essa principal tiver subtags cadastradas, escolher
 * ao menos uma delas (multisseleção, exibida inline — lista curta, não
 * justifica outro dropdown). Principal sem nenhuma subtag cadastrada fecha só
 * com ela. Trocar de principal descarta qualquer subtag de outra principal
 * que estivesse selecionada (não faz sentido misturar).
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

  const principals = tags.filter(t => !t.parentTagId);
  const subtagsOf = (principalId: string) => tags.filter(t => t.parentTagId === principalId);

  const selectedPrincipal = principals.find(p => selectedIds.includes(p.id)) || null;
  const availableSubtags = selectedPrincipal ? subtagsOf(selectedPrincipal.id) : [];
  const selectedSubtagIds = availableSubtags.filter(s => selectedIds.includes(s.id)).map(s => s.id);

  const needsSubtag = !!selectedPrincipal && availableSubtags.length > 0;
  const isComplete = !!selectedPrincipal && (!needsSubtag || selectedSubtagIds.length > 0);

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

  const pickPrincipal = (principalId: string) => {
    if (disabled) return;
    // Troca de principal descarta subtag de outra principal (filtra pelas
    // filhas da NOVA principal) e garante a nova principal no array.
    const keepSubtags = subtagsOf(principalId).map(s => s.id).filter(id => selectedIds.includes(id));
    onChange([principalId, ...keepSubtags]);
    setIsOpen(false);
  };

  const toggleSubtag = (id: string) => {
    if (disabled || !selectedPrincipal) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(t => t !== id) : [...selectedIds, id]);
  };

  return (
    <div
      role="group"
      aria-labelledby="required-tags-title"
      className={cn(
        'rounded-2xl border p-4 space-y-3 transition-colors',
        isComplete
          ? 'bg-[var(--surface-success)] border-[var(--text-success)]/25'
          : 'bg-[var(--surface-warning)] border-[var(--border-alert)]'
      )}
    >
      <div className="flex items-start gap-2.5">
        {isComplete
          ? <Check size={16} className="text-[var(--text-success)] shrink-0 mt-0.5" />
          : <AlertTriangle size={16} className="text-[var(--text-warning-strong)] shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p id="required-tags-title" className={cn('text-xs font-black uppercase tracking-wider', isComplete ? 'text-[var(--text-success)]' : 'text-[var(--text-warning)]')}>
            {isComplete ? 'Tag selecionada' : needsSubtag && !selectedSubtagIds.length ? 'Subtag obrigatória' : 'Tag obrigatória'}
          </p>
          <p className={cn('text-[11px] font-medium leading-relaxed mt-0.5', isComplete ? 'text-[var(--text-success)]' : 'text-[var(--text-warning)]')}>
            {isComplete
              ? 'Tudo certo — você pode finalizar a conversa.'
              : needsSubtag && !selectedSubtagIds.length
                ? `Selecione também uma subtag de "${selectedPrincipal!.label}" para finalizar.`
                : 'Selecione uma tag principal para poder finalizar esta conversa.'}
          </p>
        </div>
      </div>

      {principals.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
          <TagIcon size={11} /> Nenhuma tag de chat cadastrada
        </p>
      ) : (
        <>
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
                {selectedPrincipal && (
                  <span className={cn('w-2 h-2 rounded-full shrink-0', tagAccentBgClass(selectedPrincipal))} />
                )}
                <span className={cn('text-xs font-semibold truncate', selectedPrincipal ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                  {selectedPrincipal ? selectedPrincipal.label : 'Selecionar tag principal...'}
                </span>
              </span>
              <ChevronDown size={14} className={cn('shrink-0 text-[var(--text-tertiary)] transition-transform', isOpen && 'rotate-180')} />
            </button>

            {isOpen && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-full mt-2 z-30 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden py-1 max-h-64 overflow-y-auto"
              >
                {principals.map(tag => {
                  const active = selectedPrincipal?.id === tag.id;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pickPrincipal(tag.id)}
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

          {availableSubtags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                Subtag de {selectedPrincipal!.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {availableSubtags.map(tag => {
                  const active = selectedSubtagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={active}
                      disabled={disabled}
                      onClick={() => toggleSubtag(tag.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-all disabled:opacity-60',
                        active
                          ? 'border-[var(--accent)]/50 bg-[var(--surface-pill)] text-[var(--accent-text)]'
                          : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40'
                      )}
                    >
                      <span className={cn('w-2 h-2 rounded-full shrink-0', tagAccentBgClass(tag))} />
                      {tag.label}
                      {active && <Check size={12} className="text-[var(--accent-text)] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
