'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag as TagIcon, Check, X, Search, ChevronRight } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn, normalizeString } from '@/lib/utils';

interface ChatTagPickerProps {
  availableTags: TagConfig[];
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  align?: 'left' | 'right';
}

// tag.color é um combo "bg-*-100 text-*-700" pensado pra chip (fundo claro +
// texto escuro, ver TAG_COLORS em tag-manager.tsx — é a única paleta que a
// tela de cadastro oferece, fixa em 15 cores). Pra um indicador sólido (barra
// lateral da lista, ponto do popover) precisamos da cor saturada como FUNDO,
// não como texto.
//
// NÃO dá pra construir isso com `.replace('text-', 'bg-')` em runtime: o
// Tailwind só gera CSS para classes que aparecem como texto literal em algum
// arquivo — "bg-rose-700" nunca existe como string no código-fonte (só
// "text-rose-700" existe, dentro de TAG_COLORS), então a classe montada na
// mão simplesmente não tem regra CSS por trás e não pinta nada. Por isso o
// mapa abaixo escreve cada classe por extenso: elas aparecem literalmente
// aqui no arquivo, então o Tailwind as gera; a escolha de qual usar continua
// dinâmica (a chave do objeto), só o VALOR precisa ser texto fixo.
const ACCENT_BG_BY_FAMILY: Record<string, string> = {
  slate: 'bg-slate-500 dark:bg-slate-400',
  indigo: 'bg-indigo-500 dark:bg-indigo-400',
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  rose: 'bg-rose-500 dark:bg-rose-400',
  cyan: 'bg-cyan-500 dark:bg-cyan-400',
  violet: 'bg-violet-500 dark:bg-violet-400',
  blue: 'bg-blue-500 dark:bg-blue-400',
  red: 'bg-red-500 dark:bg-red-400',
  orange: 'bg-orange-500 dark:bg-orange-400',
  purple: 'bg-purple-500 dark:bg-purple-400',
  teal: 'bg-teal-500 dark:bg-teal-400',
  lime: 'bg-lime-500 dark:bg-lime-400',
  fuchsia: 'bg-fuchsia-500 dark:bg-fuchsia-400',
  sky: 'bg-sky-500 dark:bg-sky-400'
};

export function tagAccentBgClass(tag: TagConfig): string {
  const match = tag.color.match(/text-(slate|indigo|emerald|amber|rose|cyan|violet|blue|red|orange|purple|teal|lime|fuchsia|sky)-700/);
  const family = match?.[1] || 'slate';
  return ACCENT_BG_BY_FAMILY[family];
}

const SUBMENU_WIDTH = 208;
const SUBMENU_MAX_HEIGHT = 260;

// Submenu das subtags de UM principal — portado pro <body> e posicionado em
// coordenadas fixas a partir da própria linha do principal (anchorRef), do
// lado com mais espaço livre. Achado 2026-10-29: antes as subtags
// expandiam INLINE dentro do popover principal (empurrando a lista inteira
// pra baixo) — com uma principal de 10+ subtags (ex.: "Dúvida", depois da
// reorganização de tags), o popover ficava enorme, "tudo jogado na tela".
// Como dropdown à parte, o popover principal nunca cresce: cada submenu é
// um painel próprio, do tamanho só do que cabe (com rolagem se precisar).
function SubtagSubmenu({
  kids, selectedTagIds, onToggle, anchorRef
}: {
  kids: TagConfig[];
  selectedTagIds: string[];
  onToggle: (tag: TagConfig) => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fitsRight = rect.right + 6 + SUBMENU_WIDTH <= window.innerWidth - 8;
    const left = fitsRight ? rect.right + 6 : Math.max(8, rect.left - SUBMENU_WIDTH - 6);
    const top = Math.min(rect.top, window.innerHeight - 8 - 40);
    setPos({ top, left });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      data-chat-tag-submenu
      className="fixed z-[999] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl py-1 overflow-y-auto"
      style={{ top: pos.top, left: pos.left, width: SUBMENU_WIDTH, maxHeight: SUBMENU_MAX_HEIGHT }}
    >
      {kids.map(child => {
        const childActive = selectedTagIds.includes(child.id);
        return (
          <button
            key={child.id}
            type="button"
            onClick={() => onToggle(child)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
          >
            <span className={cn('w-2 h-2 rounded-full shrink-0', tagAccentBgClass(child))} />
            <span className="flex-1 text-left truncate">{child.label}</span>
            {childActive && <Check size={13} className="text-[var(--accent-text)] shrink-0" />}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

function PrincipalMenuRow({
  principal, kids, active, expanded, selectedTagIds, onTogglePrincipal, onToggleExpanded, onToggleSubtag
}: {
  principal: TagConfig;
  kids: TagConfig[];
  active: boolean;
  expanded: boolean;
  selectedTagIds: string[];
  onTogglePrincipal: (p: TagConfig) => void;
  onToggleExpanded: (id: string) => void;
  onToggleSubtag: (t: TagConfig) => void;
}) {
  const hasKids = kids.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rowRef}>
      <div className="w-full flex items-center gap-1 px-2 hover:bg-[var(--surface-pill)] transition-all">
        {hasKids ? (
          <button
            type="button"
            onClick={() => onToggleExpanded(principal.id)}
            className={cn('p-1.5 shrink-0 transition-colors', expanded ? 'text-[var(--accent-text)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}
            title={expanded ? 'Fechar subtags' : 'Ver subtags'}
          >
            <ChevronRight size={12} />
          </button>
        ) : (
          <span className="w-[26px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onTogglePrincipal(principal)}
          className="flex-1 flex items-center gap-2.5 py-2.5 text-xs font-semibold text-[var(--text-secondary)] text-left min-w-0"
        >
          <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', tagAccentBgClass(principal))} />
          <span className="flex-1 text-left truncate">{principal.label}</span>
          {active && <Check size={14} className="text-[var(--accent-text)] shrink-0" />}
        </button>
      </div>
      {expanded && hasKids && (
        <SubtagSubmenu kids={kids} selectedTagIds={selectedTagIds} onToggle={onToggleSubtag} anchorRef={rowRef} />
      )}
    </div>
  );
}

// Chips das tags já aplicadas + popover hierárquico (principal -> submenu de
// subtags) para vincular/desvincular em tempo real durante o atendimento.
// `availableTags` já vem filtrado por domain==='chat' por quem usa este
// componente (chat-widget.tsx) e inclui os dois níveis juntos, flat.
//
// Selecionar uma subtag marca a principal dela junto (uma subtag solta, sem
// o contexto da principal, não faz sentido pra filtro/relatório); desmarcar a
// principal remove as subtags dela que estavam marcadas — mesma regra de
// RequiredChatTags, só que aqui vale pra VÁRIAS principais ao mesmo tempo
// (não é single-select: a conversa pode ter "Dúvida" + "Instabilidade" juntas).
export function ChatTagPicker({ availableTags, selectedTagIds, onChange, align = 'left' }: ChatTagPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function isInsideOwnUi(target: Node) {
      if (containerRef.current?.contains(target)) return true;
      // Submenu de subtags é portado pro <body> (fora da árvore deste
      // componente) — clique nele não pode contar como "clique fora".
      return !!(target as Element).closest?.('[data-chat-tag-submenu]');
    }
    function handleClickOutside(e: MouseEvent) {
      if (!isInsideOwnUi(e.target as Node)) setIsOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Um nível por vez: com algum submenu aberto, Esc fecha só ele.
      if (expandedIds.size > 0) { setExpandedIds(new Set()); return; }
      setIsOpen(false);
    }
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, expandedIds]);

  // Busca e submenus somem junto com o popover — reabrir sempre começa do zero.
  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
    else { setSearch(''); setExpandedIds(new Set()); }
  }, [isOpen]);

  const principals = availableTags.filter(t => !t.parentTagId);
  const childrenOf = (id: string) => availableTags.filter(t => t.parentTagId === id);

  const query = normalizeString(search.trim());
  const matchesQuery = (t: TagConfig) => !query || normalizeString(t.label).includes(query);
  const visiblePrincipals = principals.filter(p => matchesQuery(p) || childrenOf(p.id).some(matchesQuery));

  const selectedTags = availableTags.filter(t => selectedTagIds.includes(t.id));

  function togglePrincipal(principal: TagConfig) {
    if (selectedTagIds.includes(principal.id)) {
      const childIds = childrenOf(principal.id).map(c => c.id);
      onChange(selectedTagIds.filter(id => id !== principal.id && !childIds.includes(id)));
    } else {
      onChange([...selectedTagIds, principal.id]);
    }
  }

  function toggleSubtag(subtag: TagConfig) {
    if (selectedTagIds.includes(subtag.id)) {
      onChange(selectedTagIds.filter(id => id !== subtag.id));
    } else {
      const withParent = subtag.parentTagId && !selectedTagIds.includes(subtag.parentTagId)
        ? [...selectedTagIds, subtag.parentTagId]
        : selectedTagIds;
      onChange([...withParent, subtag.id]);
    }
  }

  function removeChip(tag: TagConfig) {
    if (!tag.parentTagId) {
      const childIds = childrenOf(tag.id).map(c => c.id);
      onChange(selectedTagIds.filter(id => id !== tag.id && !childIds.includes(id)));
    } else {
      onChange(selectedTagIds.filter(id => id !== tag.id));
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center flex-wrap gap-1">
        {selectedTags.map(tag => (
          <span
            key={tag.id}
            className={cn('text-[8px] font-black uppercase tracking-widest pl-1.5 pr-1 py-0.5 rounded-full flex items-center gap-1', tag.color)}
          >
            {tag.label}
            <button onClick={() => removeChip(tag)} className="hover:opacity-60 transition-opacity" title={`Remover marcador ${tag.label}`}>
              <X size={9} />
            </button>
          </span>
        ))}
        <button
          onClick={() => setIsOpen(prev => !prev)}
          className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-all flex items-center gap-1"
          title="Marcadores da conversa"
        >
          <TagIcon size={9} /> {selectedTags.length === 0 ? 'Marcar' : '+'}
        </button>
      </div>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full mt-2 z-30 w-60 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden flex flex-col',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {availableTags.length > 5 && (
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border-default)] shrink-0">
              <Search size={11} className="text-[var(--text-tertiary)] shrink-0" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Buscar marcador..."
                className="w-full bg-transparent text-[11px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
              />
            </div>
          )}
          <div className="py-1 max-h-64 overflow-y-auto">
          {availableTags.length === 0 ? (
            <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
              Nenhum marcador cadastrado para chats. Crie em Configurações {'>'} Gestão de Tags.
            </p>
          ) : visiblePrincipals.length === 0 ? (
            <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
              Nenhum marcador encontrado.
            </p>
          ) : (
            visiblePrincipals.map(principal => {
              const kids = childrenOf(principal.id);
              const hasKids = kids.length > 0;
              const active = selectedTagIds.includes(principal.id);
              const expanded = hasKids && (expandedIds.has(principal.id) || (!!query && kids.some(matchesQuery)));
              return (
                <PrincipalMenuRow
                  key={principal.id}
                  principal={principal}
                  kids={kids}
                  active={active}
                  expanded={expanded}
                  selectedTagIds={selectedTagIds}
                  onTogglePrincipal={togglePrincipal}
                  onToggleExpanded={toggleExpanded}
                  onToggleSubtag={toggleSubtag}
                />
              );
            })
          )}
          </div>
        </div>
      )}
    </div>
  );
}
