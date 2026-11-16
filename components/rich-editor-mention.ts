import Mention from '@tiptap/extension-mention';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';

// Menção com @ no editor rico (2026-11-16, notas do ticket interno).
//
// O HTML gravado fica <span data-type="mention" data-id="<uuid>" data-label="Nome">@Nome</span>
// — é por esse data-id que o servidor descobre quem foi marcado (ver
// lib/services/internal-ticket-mentions.ts).
//
// O node é registrado em TODO editor, mesmo sem lista de pessoas: sem ele o
// Tiptap descartaria a marcação ao reabrir uma nota antiga pra editar. A lista
// vem de uma função (getItems) lida a cada "@", então o editor não precisa ser
// recriado quando a lista carrega depois.
//
// A janelinha de sugestões é desenhada à mão (DOM simples) pra não trazer mais
// uma biblioteca de popup só pra isto.

export interface MentionItem {
  id: string;
  label: string;
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function createMentionExtension(getItems: () => MentionItem[]) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ options, node }) => [
      'span',
      { ...options.HTMLAttributes, 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: ({ query }) => {
        const all = getItems();
        if (all.length === 0) return [];
        const q = normalize(query.trim());
        return all
          .filter(i => !q || normalize(i.label).split(/\s+/).some(w => w.startsWith(q)) || normalize(i.label).startsWith(q))
          .slice(0, 8);
      },
      render: () => {
        let el: HTMLDivElement | null = null;
        let items: MentionItem[] = [];
        let selected = 0;
        let command: ((item: { id: string; label: string }) => void) | null = null;

        const paint = () => {
          if (!el) return;
          el.innerHTML = '';
          if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'px-3 py-2 text-xs text-[var(--text-tertiary)]';
            empty.textContent = 'Ninguém encontrado';
            el.appendChild(empty);
            return;
          }
          items.forEach((item, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.setAttribute('aria-selected', String(idx === selected));
            btn.className = 'w-full text-left px-3 py-1.5 text-sm rounded-lg '
              + (idx === selected ? 'bg-[var(--accent)]/15 text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-pill)]');
            btn.textContent = item.label;
            // mousedown (não click): o click tira o foco do editor antes de inserir.
            btn.addEventListener('mousedown', (e) => {
              e.preventDefault();
              command?.({ id: item.id, label: item.label });
            });
            el!.appendChild(btn);
          });
        };

        const place = (props: SuggestionProps<MentionItem>) => {
          const rect = props.clientRect?.();
          if (!el || !rect) return;
          const width = 240;
          const left = Math.min(rect.left, window.innerWidth - width - 8);
          // Abre pra cima quando não cabe embaixo (composer fica no fim da tela).
          const below = rect.bottom + 6;
          const spaceBelow = window.innerHeight - below;
          el.style.left = `${Math.max(8, left)}px`;
          el.style.width = `${width}px`;
          if (spaceBelow < 220) {
            el.style.top = '';
            el.style.bottom = `${window.innerHeight - rect.top + 6}px`;
          } else {
            el.style.bottom = '';
            el.style.top = `${below}px`;
          }
        };

        return {
          onStart: (props: SuggestionProps<MentionItem>) => {
            items = props.items;
            selected = 0;
            command = props.command as any;
            el = document.createElement('div');
            el.setAttribute('role', 'listbox');
            el.setAttribute('aria-label', 'Marcar pessoa');
            el.className = 'fixed z-[400] max-h-56 overflow-y-auto p-1 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl';
            document.body.appendChild(el);
            paint();
            place(props);
          },
          onUpdate: (props: SuggestionProps<MentionItem>) => {
            items = props.items;
            selected = Math.min(selected, Math.max(0, items.length - 1));
            command = props.command as any;
            paint();
            place(props);
          },
          onKeyDown: ({ event }: SuggestionKeyDownProps) => {
            // stopPropagation: sem isso o mesmo Esc fecharia o ticket/modal
            // inteiro por baixo (eles ouvem keydown em document/window).
            if (event.key === 'Escape') { event.stopPropagation(); el?.remove(); el = null; return true; }
            if (!items.length) return false;
            if (event.key === 'ArrowDown') { selected = (selected + 1) % items.length; paint(); return true; }
            if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % items.length; paint(); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const item = items[selected];
              if (item) command?.({ id: item.id, label: item.label });
              return true;
            }
            return false;
          },
          onExit: () => { el?.remove(); el = null; },
        };
      },
    },
  });
}
