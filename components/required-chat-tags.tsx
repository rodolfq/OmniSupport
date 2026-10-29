'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Tag as TagIcon, Search } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn, normalizeString } from '@/lib/utils';
import { tagAccentBgClass } from '@/components/chat-tag-picker';

/**
 * Seletor de tags mostrado DENTRO dos modais que encerram a conversa, quando
 * ela ainda não satisfaz a regra de tag obrigatória (regra do servidor, action
 * 'close' de app/api/chat-sessions/route.ts). Desde 2026-10-21 as tags viraram
 * hierárquicas (tag principal → subtags, `parentTagId`) — este seletor passou
 * de "lista solta com todas as tags, até subtags" pra um fluxo em 2 passos:
 * (1) escolher UMA tag principal (single-select, nunca mais de uma — é o que
 * o usuário pediu), (2) se essa principal tiver subtags cadastradas, escolher
 * ao menos uma delas (multisseleção, em outro dropdown — "lista curta" valia
 * antes da reorganização de tags de 2026-10-28, quando uma principal passou a
 * ter até 15 subtags e os chips soltos tomavam a tela inteira, achado
 * 2026-10-29). Principal sem nenhuma subtag cadastrada fecha só com ela.
 * Trocar de principal descarta qualquer subtag de outra principal que
 * estivesse selecionada (não faz sentido misturar).
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
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [isSubtagOpen, setIsSubtagOpen] = useState(false);
  const [subtagSearch, setSubtagSearch] = useState('');
  const subtagContainerRef = useRef<HTMLDivElement>(null);
  const subtagSearchInputRef = useRef<HTMLInputElement>(null);

  const principals = tags.filter(t => !t.parentTagId);
  const subtagsOf = (principalId: string) => tags.filter(t => t.parentTagId === principalId);
  const filteredPrincipals = search.trim()
    ? principals.filter(t => normalizeString(t.label).includes(normalizeString(search.trim())))
    : principals;

  const selectedPrincipal = principals.find(p => selectedIds.includes(p.id)) || null;
  const availableSubtags = selectedPrincipal ? subtagsOf(selectedPrincipal.id) : [];
  const selectedSubtagIds = availableSubtags.filter(s => selectedIds.includes(s.id)).map(s => s.id);

  const needsSubtag = !!selectedPrincipal && availableSubtags.length > 0;
  const isComplete = !!selectedPrincipal && (!needsSubtag || selectedSubtagIds.length > 0);

  const filteredSubtags = subtagSearch.trim()
    ? availableSubtags.filter(t => normalizeString(t.label).includes(normalizeString(subtagSearch.trim())))
    : availableSubtags;

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

  // Mesmo padrão, pro dropdown de subtags.
  useEffect(() => {
    if (!isSubtagOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (subtagContainerRef.current && !subtagContainerRef.current.contains(e.target as Node)) setIsSubtagOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsSubtagOpen(false);
    }
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isSubtagOpen]);

  // Se o seletor ficar desabilitado (ex.: encerramento em andamento) enquanto
  // aberto, recolhe — senão o dropdown ficaria aberto sem poder mudar nada.
  useEffect(() => {
    if (disabled) { setIsOpen(false); setIsSubtagOpen(false); }
  }, [disabled]);

  // Busca some junto com o dropdown — reabrir sempre começa do zero.
  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
    else setSearch('');
  }, [isOpen]);

  useEffect(() => {
    if (isSubtagOpen) subtagSearchInputRef.current?.focus();
    else setSubtagSearch('');
  }, [isSubtagOpen]);

  // Trocar de principal muda o conjunto de subtags disponível — um dropdown
  // de subtags aberto da principal anterior não faz mais sentido aberto.
  useEffect(() => {
    setIsSubtagOpen(false);
  }, [selectedPrincipal?.id]);

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
                className="absolute left-0 right-0 top-full mt-2 z-30 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden flex flex-col"
              >
                {principals.length > 5 && (
                  <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-default)] shrink-0">
                    <Search size={11} className="text-[var(--text-tertiary)] shrink-0" />
                    <input
                      ref={searchInputRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Buscar tag principal..."
                      className="w-full bg-transparent text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
                    />
                  </div>
                )}
                <div role="listbox" className="py-1 max-h-56 overflow-y-auto">
                  {filteredPrincipals.length === 0 ? (
                    <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
                      Nenhuma tag encontrada.
                    </p>
                  ) : (
                    filteredPrincipals.map(tag => {
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
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {availableSubtags.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
                Subtag de {selectedPrincipal!.label}
              </p>
              <div ref={subtagContainerRef} className="relative">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={isSubtagOpen}
                  disabled={disabled}
                  onClick={() => setIsSubtagOpen(prev => !prev)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-left transition-all hover:border-[var(--accent)]/60 disabled:opacity-60"
                >
                  <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                    {selectedSubtagIds.length === 0 ? (
                      <span className="text-xs font-semibold text-[var(--text-tertiary)]">Selecionar subtags...</span>
                    ) : (
                      availableSubtags.filter(t => selectedSubtagIds.includes(t.id)).map(tag => (
                        <span
                          key={tag.id}
                          className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest pl-1.5 pr-1 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--accent-text)]"
                        >
                          {tag.label}
                        </span>
                      ))
                    )}
                  </span>
                  <ChevronDown size={14} className={cn('shrink-0 text-[var(--text-tertiary)] transition-transform', isSubtagOpen && 'rotate-180')} />
                </button>

                {isSubtagOpen && (
                  <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden flex flex-col">
                    {availableSubtags.length > 5 && (
                      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-default)] shrink-0">
                        <Search size={11} className="text-[var(--text-tertiary)] shrink-0" />
                        <input
                          ref={subtagSearchInputRef}
                          value={subtagSearch}
                          onChange={(e) => setSubtagSearch(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Buscar subtag..."
                          className="w-full bg-transparent text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
                        />
                      </div>
                    )}
                    <div role="listbox" aria-multiselectable="true" className="py-1 max-h-56 overflow-y-auto">
                      {filteredSubtags.length === 0 ? (
                        <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
                          Nenhuma subtag encontrada.
                        </p>
                      ) : (
                        filteredSubtags.map(tag => {
                          const active = selectedSubtagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              disabled={disabled}
                              onClick={() => toggleSubtag(tag.id)}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold transition-all disabled:opacity-60',
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
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
