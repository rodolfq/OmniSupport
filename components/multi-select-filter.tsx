'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn, normalizeString } from '@/lib/utils';

/**
 * Filtro de múltipla escolha para a barra de filtros das listas.
 *
 * Existe porque o <select> comum só deixa escolher UM valor: filtrar por
 * "Desenvolvimento e Infraestrutura" exigia duas passadas na tela. Onde a
 * lista é de equipes isso é o caso comum, não a exceção.
 *
 * O painel é renderizado em PORTAL, e não no fluxo normal: a área de filtros
 * avançados abre com `overflow-hidden` (é a animação de altura do motion),
 * então um dropdown absoluto ali dentro seria cortado na borda inferior.
 * Mesma razão do painel de InlineAssigneePicker.
 */

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Rótulo quando nada está selecionado — ex.: "Todas Equipes". */
  allLabel: string;
  /** Substantivo plural usado no resumo "3 equipes". */
  itemLabelPlural: string;
  searchPlaceholder?: string;
  /** Campo de busca some abaixo deste número de opções (ruído puro). */
  searchThreshold?: number;
  className?: string;
}

export function MultiSelectFilter({
  options,
  selected,
  onChange,
  allLabel,
  itemLabelPlural,
  searchPlaceholder = 'Buscar...',
  searchThreshold = 8,
  className
}: MultiSelectFilterProps) {
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState('');
  const [posicao, setPosicao] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const botaoRef = React.useRef<HTMLButtonElement>(null);
  const painelRef = React.useRef<HTMLDivElement>(null);

  const abrir = () => {
    const r = botaoRef.current?.getBoundingClientRect();
    if (!r) return;
    const alturaPainel = 300;
    const abreParaCima = r.bottom + alturaPainel > window.innerHeight && r.top > alturaPainel;
    setPosicao({
      top: abreParaCima ? r.top - alturaPainel - 4 : r.bottom + 4,
      // Acompanha a largura do próprio campo (mínimo de 220px) — na grade de
      // filtros o campo é estreito, e um painel muito mais largo que ele
      // desalinha visualmente.
      width: Math.max(r.width, 220),
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8)
    });
    setBusca('');
    setAberto(true);
  };

  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (painelRef.current?.contains(e.target as Node)) return;
      if (botaoRef.current?.contains(e.target as Node)) return;
      setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    // O painel está em coordenadas de tela: rolar a página o deixaria solto,
    // longe do campo de origem.
    const rolou = () => setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', rolou);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', rolou);
    };
  }, [aberto]);

  const filtradas = React.useMemo(() => {
    const q = normalizeString(busca);
    if (!q) return options;
    return options.filter(o => normalizeString(o.label).includes(q));
  }, [options, busca]);

  const alternar = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };

  // Um item só aparece pelo nome; vários viram contagem, senão o campo cresce
  // sem controle dentro da grade.
  const resumo = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label || selected[0])
      : `${selected.length} ${itemLabelPlural}`;

  return (
    <>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        className={cn(
          'px-3 py-2 rounded-lg border text-sm font-medium bg-[var(--surface-card)] text-left',
          'flex items-center justify-between gap-2 transition-colors',
          selected.length > 0
            ? 'border-[var(--accent)] text-[var(--text-primary)]'
            : 'border-[var(--border-default)] text-[var(--text-secondary)]',
          className
        )}
      >
        <span className="truncate">{resumo}</span>
        <ChevronDown size={14} className={cn('shrink-0 transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && posicao && createPortal(
        <div
          ref={painelRef}
          style={{ top: posicao.top, left: posicao.left, width: posicao.width }}
          className="fixed z-[100] bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl shadow-xl overflow-hidden"
        >
          {options.length > searchThreshold && (
            <div className="p-2 border-b border-[var(--border-default)]">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full bg-[var(--surface-pill)] rounded-lg pl-8 pr-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto p-1.5">
            {filtradas.map(o => {
              const marcada = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => alternar(o.value)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-[var(--surface-pill)] transition-colors"
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                      marcada
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                        : 'border-[var(--border-default)]'
                    )}
                  >
                    {marcada && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{o.label}</span>
                </button>
              );
            })}

            {filtradas.length === 0 && (
              <p className="text-[11px] text-[var(--text-tertiary)] text-center py-4">Nada encontrado.</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-[var(--border-default)]">
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-40 px-1.5 py-1"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="text-[10px] font-bold uppercase tracking-wide text-[var(--accent-text)] px-1.5 py-1"
            >
              Pronto
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
