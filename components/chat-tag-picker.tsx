'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Tag as TagIcon, Check, X } from 'lucide-react';
import { TagConfig } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ChatTagPickerProps {
  availableTags: TagConfig[];
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  align?: 'left' | 'right';
}

// tag.color é um combo "bg-*-100 text-*-700" pensado pra chip (fundo claro +
// texto escuro, ver TAG_COLORS em tag-manager.tsx — é a única paleta que a
// tela de cadastro oferece, fixa em 7 cores). Pra um indicador sólido (barra
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
  violet: 'bg-violet-500 dark:bg-violet-400'
};

export function tagAccentBgClass(tag: TagConfig): string {
  const match = tag.color.match(/text-(slate|indigo|emerald|amber|rose|cyan|violet)-700/);
  const family = match?.[1] || 'slate';
  return ACCENT_BG_BY_FAMILY[family];
}

// Chips das tags já aplicadas + popover para vincular/desvincular em tempo
// real durante o atendimento. `availableTags` já vem filtrado por
// domain==='chat' por quem usa este componente (chat-widget.tsx).
export function ChatTagPicker({ availableTags, selectedTagIds, onChange, align = 'left' }: ChatTagPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const selectedTags = availableTags.filter(t => selectedTagIds.includes(t.id));

  function toggleTag(id: string) {
    onChange(selectedTagIds.includes(id) ? selectedTagIds.filter(t => t !== id) : [...selectedTagIds, id]);
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
            <button onClick={() => toggleTag(tag.id)} className="hover:opacity-60 transition-opacity" title={`Remover marcador ${tag.label}`}>
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
            'absolute top-full mt-2 z-30 w-52 bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden py-1 max-h-64 overflow-y-auto',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {availableTags.length === 0 ? (
            <p className="px-4 py-3 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-widest leading-relaxed">
              Nenhum marcador cadastrado para chats. Crie em Configurações {'>'} Gestão de Tags.
            </p>
          ) : (
            availableTags.map(tag => {
              const active = selectedTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-pill)] transition-all"
                >
                  <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', tagAccentBgClass(tag))} />
                  <span className="flex-1 text-left truncate">{tag.label}</span>
                  {active && <Check size={14} className="text-[var(--accent-text)] shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
