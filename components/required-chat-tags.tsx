'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Tag as TagIcon, Search } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn, normalizeString } from '@/lib/utils';
import { tagAccentBgClass } from '@/components/chat-tag-picker';

/**
 * Seletor de tags mostrado DENTRO dos modais que encerram a conversa, quando
 * ela ainda não satisfaz a regra de tag obrigatória (regra do servidor, action
 * 'close' de app/api/chat-sessions/route.ts, `conversaTemTagParaEncerrar` —
 * já aceitava múltiplas principais desde sempre, só este seletor é que travava
 * em 1). Desde 2026-10-21 as tags são hierárquicas (tag principal → subtags,
 * `parentTagId`); desde 2026-11-03 (pedido do usuário) a tag PRINCIPAL virou
 * multisseleção — supersede o "single-select, nunca mais de uma" de antes,
 * que só existia aqui (o botãozinho de tags livre do chat, ChatTagPicker, já
 * permitia mais de uma principal). Cada principal escolhida que tiver subtag
 * cadastrada precisa de pelo menos 1 subtag SUA selecionada; principal sem
 * nenhuma subtag cadastrada fecha só com ela. Desmarcar uma principal também
 * descarta as subtags dela (não faz sentido uma subtag sobreviver sem o pai).
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

  const principals = tags.filter(t => !t.parentTagId);
  const subtagsOf = (principalId: string) => tags.filter(t => t.parentTagId === principalId);
  const filteredPrincipals = search.trim()
    ? principals.filter(t => normalizeString(t.label).includes(normalizeString(search.trim())))
    : principals;

  const selectedPrincipals = principals.filter(p => selectedIds.includes(p.id));
  // Entre as principais escolhidas, só as que TÊM subtag cadastrada exigem
  // uma selecionada — principal sem filho nenhum (ex.: "Dúvida") já fecha.
  const principalsNeedingSubtag = selectedPrincipals.filter(p => subtagsOf(p.id).length > 0);
  const principalsMissingSubtag = principalsNeedingSubtag.filter(
    p => !subtagsOf(p.id).some(s => selectedIds.includes(s.id))
  );
  const isComplete = selectedPrincipals.length > 0 && principalsMissingSubtag.length === 0;

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

  // Busca some junto com o dropdown — reabrir sempre começa do zero.
  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
    else setSearch('');
  }, [isOpen]);

  const togglePrincipal = (principalId: string) => {
    if (disabled) return;
    if (selectedIds.includes(principalId)) {
      // Desmarcar a principal descarta as subtags dela junto (filhas órfãs
      // não fazem sentido) — não mexe em subtag de OUTRA principal.
      const ownSubtagIds = new Set(subtagsOf(principalId).map(s => s.id));
      onChange(selectedIds.filter(id => id !== principalId && !ownSubtagIds.has(id)));
    } else {
      onChange([...selectedIds, principalId]);
    }
  };

  const statusTitle = isComplete
    ? 'Tag selecionada'
    : principalsMissingSubtag.length > 0
      ? 'Subtag obrigatória'
      : 'Tag obrigatória';

  const statusMessage = isComplete
    ? 'Tudo certo — você pode finalizar a conversa.'
    : principalsMissingSubtag.length > 0
      ? `Selecione também uma subtag de "${principalsMissingSubtag.map(p => p.label).join('", "')}" para finalizar.`
      : 'Selecione ao menos uma tag principal para poder finalizar esta conversa.';

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
            {statusTitle}
          </p>
          <p className={cn('text-[11px] font-medium leading-relaxed mt-0.5', isComplete ? 'text-[var(--text-success)]' : 'text-[var(--text-warning)]')}>
            {statusMessage}
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
              <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
                {selectedPrincipals.length === 0 ? (
                  <span className="text-xs font-semibold text-[var(--text-tertiary)]">Selecionar tag principal...</span>
                ) : (
                  selectedPrincipals.map(tag => (
                    <span
                      key={tag.id}
                      className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest pl-1.5 pr-1 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--accent-text)]"
                    >
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', tagAccentBgClass(tag))} />
                      {tag.label}
                    </span>
                  ))
                )}
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
                <div role="listbox" aria-multiselectable="true" className="py-1 max-h-56 overflow-y-auto">
                  {filteredPrincipals.length === 0 ? (
                    <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
                      Nenhuma tag encontrada.
                    </p>
                  ) : (
                    filteredPrincipals.map(tag => {
                      const active = selectedIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          disabled={disabled}
                          onClick={() => togglePrincipal(tag.id)}
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

          {/* Um bloco de subtag por principal escolhida que tiver subtag
              cadastrada — cada uma com seu próprio dropdown independente. */}
          {selectedPrincipals.filter(p => subtagsOf(p.id).length > 0).map(principal => (
            <SubtagPicker
              key={principal.id}
              principal={principal}
              subtags={subtagsOf(principal.id)}
              selectedIds={selectedIds}
              onChange={onChange}
              disabled={disabled}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Dropdown de subtags de UMA principal — extraído à parte porque agora pode
// existir mais de uma instância ao mesmo tempo (uma por principal escolhida),
// cada uma com seu próprio estado de aberto/busca.
function SubtagPicker({
  principal,
  subtags,
  selectedIds,
  onChange,
  disabled
}: {
  principal: TagConfig;
  subtags: TagConfig[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedSubtagIds = subtags.filter(s => selectedIds.includes(s.id)).map(s => s.id);
  const filteredSubtags = search.trim()
    ? subtags.filter(t => normalizeString(t.label).includes(normalizeString(search.trim())))
    : subtags;

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

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
    else setSearch('');
  }, [isOpen]);

  const toggleSubtag = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id) ? selectedIds.filter(t => t !== id) : [...selectedIds, id]);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest">
        Subtag de {principal.label}
      </p>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          disabled={disabled}
          onClick={() => setIsOpen(prev => !prev)}
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-left transition-all hover:border-[var(--accent)]/60 disabled:opacity-60"
        >
          <span className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
            {selectedSubtagIds.length === 0 ? (
              <span className="text-xs font-semibold text-[var(--text-tertiary)]">Selecionar subtags...</span>
            ) : (
              subtags.filter(t => selectedSubtagIds.includes(t.id)).map(tag => (
                <span
                  key={tag.id}
                  className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest pl-1.5 pr-1 py-0.5 rounded-full bg-[var(--surface-pill)] text-[var(--accent-text)]"
                >
                  {tag.label}
                </span>
              ))
            )}
          </span>
          <ChevronDown size={14} className={cn('shrink-0 text-[var(--text-tertiary)] transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden flex flex-col">
            {subtags.length > 5 && (
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-default)] shrink-0">
                <Search size={11} className="text-[var(--text-tertiary)] shrink-0" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
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
  );
}
