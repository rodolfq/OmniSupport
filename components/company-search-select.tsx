'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Search, ChevronDown, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompanyOption {
  id: string;
  name: string;
}

interface CompanySearchSelectProps {
  value: string;
  // Nome já conhecido da empresa selecionada (evita um round-trip quando quem
  // chama já sabe, ex.: acabou de escolher na própria lista). Se vier vazio
  // com `value` preenchido (ex.: filtro salvo/restaurado da URL), o
  // componente resolve sozinho via GET /api/companies?id=.
  selectedName?: string;
  onChange: (companyId: string, companyName: string) => void;
  placeholder?: string;
  className?: string;
}

const DEBOUNCE_MS = 300;

// Substitui, só neste filtro, o padrão de pré-carregar TODAS as empresas
// (useCompaniesQuery) — a lista completa inclui thumbnail de logo de cada
// uma e cresce com a base de clientes; um dropdown de filtro não precisa
// pagar esse payload. Busca sob demanda, com debounce, em
// GET /api/companies?search= (retorna só id+name, ver app/api/companies/route.ts).
export function CompanySearchSelect({ value, selectedName, onChange, placeholder = 'Qualquer Cliente', className }: CompanySearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedName, setResolvedName] = useState(selectedName || '');
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setMounted(true), []);

  // Filtro restaurado (visualização salva, URL) já vem com o id mas não com
  // o nome — resolve com uma única linha, não a lista inteira.
  useEffect(() => {
    if (!value) { setResolvedName(''); return; }
    if (selectedName) { setResolvedName(selectedName); return; }
    let cancelled = false;
    fetch(`/api/companies?id=${encodeURIComponent(value)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.name) setResolvedName(data.name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [value, selectedName]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) { setResults([]); setLoading(false); return; }

    setLoading(true);
    const handle = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(`/api/companies?search=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => setResults(Array.isArray(data) ? data : []))
        .catch(err => { if (err?.name !== 'AbortError') console.error('Erro ao buscar clientes:', err); })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 220) });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const openMenu = () => {
    setQuery('');
    setResults([]);
    setOpen(true);
  };

  const closeMenu = () => {
    abortRef.current?.abort();
    setOpen(false);
  };

  const selectOption = (option: CompanyOption) => {
    setResolvedName(option.name);
    onChange(option.id, option.name);
    closeMenu();
    triggerRef.current?.focus();
  };

  const clearSelection = () => {
    setResolvedName('');
    onChange('', '');
    closeMenu();
  };

  return (
    <div className={cn('relative inline-flex min-w-0', className?.includes('w-full') && 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(e) => { if (e.key === 'Escape') closeMenu(); }}
        className={cn(
          'flex min-h-9 min-w-0 items-center justify-between gap-2 text-left cursor-pointer',
          'focus-visible:ring-4 focus-visible:ring-[var(--accent)]/10 focus-visible:border-[var(--accent)]',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">{value ? (resolvedName || '...') : placeholder}</span>
        <ChevronDown size={15} className={cn('shrink-0 text-[var(--text-tertiary)] transition-transform duration-200', open && 'rotate-180 text-[var(--accent-text)]')} />
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0" style={{ zIndex: 2147483000 }} onMouseDown={closeMenu} />
              <motion.div
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="fixed flex flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-2xl shadow-slate-900/15"
                style={{ ...position, maxHeight: 280, zIndex: 2147483001 }}
              >
                <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-2.5 py-2 shrink-0">
                  {loading ? <Loader2 size={14} className="shrink-0 text-[var(--text-tertiary)] animate-spin" /> : <Search size={14} className="shrink-0 text-[var(--text-tertiary)]" />}
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { closeMenu(); triggerRef.current?.focus(); } }}
                    placeholder="Digite o nome do cliente..."
                    className="w-full min-w-0 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none"
                  />
                </div>
                <div className="overflow-y-auto p-1.5">
                  {value && (
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--text-tertiary)] hover:bg-[var(--surface-pill)] transition-colors"
                    >
                      Qualquer Cliente
                    </button>
                  )}
                  {!query.trim() ? (
                    <p className="px-3 py-2.5 text-sm text-[var(--text-tertiary)]">Digite para buscar um cliente</p>
                  ) : results.length === 0 && !loading ? (
                    <p className="px-3 py-2.5 text-sm text-[var(--text-tertiary)]">Nenhum cliente encontrado</p>
                  ) : (
                    results.map((option) => {
                      const selected = option.id === value;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => selectOption(option)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--surface-pill)]',
                            selected ? 'font-bold text-[var(--accent-text)]' : 'font-medium text-[var(--text-secondary)]',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{option.name}</span>
                          {selected && <Check size={15} className="shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
