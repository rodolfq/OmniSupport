'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, CornerDownLeft, Plus, Loader2, Check } from 'lucide-react';
import { cn, normalizeString } from '@/lib/utils';
import type { QuickNote } from '@/lib/types';

interface QuickRepliesPanelProps {
  notes: QuickNote[];
  onSelect: (note: QuickNote) => void;
  onClose: () => void;
  // Cadastra uma resposta nova (a tela de quem chama grava e recarrega a lista).
  // Sem isso, o painel não mostra o botão "Nova".
  onCreate?: (data: { title: string; content: string }) => Promise<void>;
}

// O título das respostas importadas é só o começo do próprio texto (ver
// migrations/quick_notes_respostas_prontas.sql) — mostrá-lo de novo em cima do
// conteúdo seria repetir a mesma frase duas vezes.
function titleRepeatsContent(note: QuickNote): boolean {
  const flat = normalizeString(note.content.replace(/\s+/g, ' ').trim());
  const title = normalizeString(note.shortcut.replace(/\s*\(\d+\)$/, '').replace(/…$/, '').trim());
  return !!title && flat.startsWith(title);
}

// Corta na última palavra inteira.
function cutAtWord(text: string): string {
  const i = text.lastIndexOf(' ');
  return i > 0 ? text.slice(0, i) : text;
}

// O título (quick_notes.shortcut) é obrigatório e ÚNICO no banco. Quando a
// pessoa não digita um, usa o começo do texto (mesma regra da importação) e,
// se já existir igual, acrescenta " (2)", " (3)"...
export function buildReplyTitle(typedTitle: string, content: string, existingTitles: string[]): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  let base = typedTitle.trim().replace(/^\/+/, '');
  if (!base) {
    base = flat;
    if (base.length > 80) {
      const cut = cutAtWord(base.slice(0, 80));
      base = (cut.length >= 30 ? cut : base.slice(0, 80)).replace(/[ ,;:-]+$/, '') + '…';
    }
  }
  const used = new Set(existingTitles.map(t => t.toLowerCase()));
  let title = base;
  let n = 2;
  while (used.has(title.toLowerCase())) {
    title = `${base} (${n})`;
    n += 1;
  }
  return title;
}


// Lista de TODAS as respostas prontas, com o conteúdo à mostra, e um campo de
// busca que filtra pelo que a resposta CONTÉM. Escolher uma resposta entrega o
// texto ao chat (quem chama decide como colar no campo de digitação). Também
// cadastra respostas novas ("Nova"), sem sair do atendimento.
export function QuickRepliesPanel({ notes, onSelect, onClose, onCreate }: QuickRepliesPanelProps) {
  const [mode, setMode] = useState<'list' | 'new'>('list');
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === 'list') inputRef.current?.focus();
    else contentRef.current?.focus();
  }, [mode]);

  const results = useMemo(() => {
    // Cada palavra digitada precisa aparecer no texto (ou no título/categoria),
    // em qualquer ordem — sem diferenciar maiúsculas nem acentos.
    const terms = normalizeString(search.trim()).split(/\s+/).filter(Boolean);
    const sorted = [...notes].sort((a, b) => a.content.localeCompare(b.content, 'pt-BR'));
    if (terms.length === 0) return sorted;
    return sorted.filter(n => {
      const haystack = normalizeString(`${n.content} ${n.shortcut} ${n.category || ''}`);
      return terms.every(t => haystack.includes(t));
    });
  }, [notes, search]);

  // Volta pro 1º resultado a cada busca nova.
  useEffect(() => { setActiveIndex(0); }, [search]);

  // Mantém o item marcado visível quando navega pelas setas.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-reply-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openNewForm = () => {
    setSaveError(null);
    setNewTitle('');
    setNewContent('');
    setMode('new');
  };

  const backToList = () => {
    if (saving) return;
    setMode('list');
  };

  const handleSave = async () => {
    const content = newContent.trim();
    if (!content || saving || !onCreate) return;
    setSaving(true);
    setSaveError(null);
    try {
      const title = buildReplyTitle(newTitle, content, notes.map(n => n.shortcut));
      await onCreate({ title, content });
      // Mostra a nova resposta logo: busca pelo começo do texto que acabou de salvar.
      setSearch(content.replace(/\s+/g, ' ').slice(0, 40));
      setMode('list');
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : 'Não foi possível salvar a resposta.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'new') backToList();
      else onClose();
      return;
    }
    if (mode === 'new') {
      // Ctrl/Cmd + Enter salva; Enter sozinho quebra linha no texto.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = results[activeIndex];
      if (chosen) onSelect(chosen);
    }
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className="absolute bottom-full left-3 right-3 mb-3 z-20 flex max-h-[min(62vh,30rem)] flex-col overflow-hidden rounded-[1.5rem] border border-[var(--border-default)] bg-[var(--surface-card)] shadow-2xl"
      role="dialog"
      aria-label="Respostas prontas"
    >
      {mode === 'new' ? (
        <>
          <div className="flex items-center justify-between border-b border-[var(--border-default)] p-3 shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Nova resposta pronta</p>
            <button
              type="button"
              onClick={backToList}
              title="Voltar (Esc)"
              className="shrink-0 rounded-lg p-1.5 text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-pill)]"
            >
              <X size={15} />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Texto da resposta</label>
              <textarea
                ref={contentRef}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={6}
                placeholder="O texto que será colado no chat..."
                className="mt-1 w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs font-medium leading-relaxed text-[var(--text-primary)] outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
            </div>
            <div>
              <label className="text-[9px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">Título (opcional)</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Se ficar em branco, usamos o começo do texto"
                className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
            </div>
            {saveError && (
              <p className="rounded-xl bg-[var(--surface-danger)] px-3 py-2 text-xs font-medium text-[var(--text-danger)]">{saveError}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={backToList}
                disabled={saving}
                className="rounded-xl px-4 py-2 text-xs font-bold text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-pill)] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!newContent.trim() || saving}
                title="Ctrl + Enter"
                className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Salvando...' : 'Salvar resposta'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-[var(--border-default)] p-3 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" size={14} />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nas respostas prontas..."
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] py-2 pl-9 pr-3 text-xs font-bold outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
            </div>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] tabular-nums">
              {results.length} {results.length === 1 ? 'resposta' : 'respostas'}
            </span>
            {onCreate && (
              <button
                type="button"
                onClick={openNewForm}
                title="Cadastrar uma resposta pronta nova"
                className="flex shrink-0 items-center gap-1 rounded-xl bg-[var(--accent)]/10 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-text)] transition-all hover:bg-[var(--accent)]/20"
              >
                <Plus size={13} /> Nova
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Fechar (Esc)"
              className="shrink-0 rounded-lg p-1.5 text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-pill)]"
            >
              <X size={15} />
            </button>
          </div>

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-xs font-medium text-[var(--text-tertiary)]">
                  {notes.length === 0 ? 'Nenhuma resposta pronta cadastrada.' : 'Nenhuma resposta contém o que você digitou.'}
                </p>
                {onCreate && (
                  <button
                    type="button"
                    onClick={() => { setNewContent(''); setNewTitle(''); setSaveError(null); setMode('new'); }}
                    className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-text)] hover:underline"
                  >
                    <Plus size={12} /> Cadastrar uma resposta nova
                  </button>
                )}
              </div>
            ) : (
              results.map((note, index) => (
                <button
                  key={note.id}
                  type="button"
                  data-reply-index={index}
                  onClick={() => onSelect(note)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'group w-full rounded-xl border p-3 text-left transition-all',
                    index === activeIndex
                      ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10'
                      : 'border-transparent hover:bg-[var(--surface-pill)]'
                  )}
                >
                  {(note.category || !titleRepeatsContent(note)) && (
                    <div className="mb-1 flex items-center gap-2">
                      {!titleRepeatsContent(note) && (
                        <span className="truncate text-[11px] font-black text-[var(--accent-text)]">{note.shortcut}</span>
                      )}
                      {note.category && (
                        <span className="shrink-0 rounded-full bg-[var(--surface-pill)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          {note.category}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-xs font-medium leading-relaxed text-[var(--text-secondary)] line-clamp-5">
                    {note.content}
                  </p>
                  {index === activeIndex && (
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--accent-text)]">
                      <CornerDownLeft size={10} /> Enter para usar
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
