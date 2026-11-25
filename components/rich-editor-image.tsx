'use client';

import React, { useCallback, useRef } from 'react';
import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { cn } from '@/lib/utils';

const MIN_WIDTH_PX = 60;
const PRESETS = [25, 50, 75, 100];

// Extensão de imagem com tamanho ajustável — o Image padrão do Tiptap sempre
// insere a imagem colada/inserida no tamanho natural (só limitado por
// max-w-full via CSS), sem nenhum jeito de encaixar num parágrafo menor. O
// atributo `width` vira `style="width:...`" no <img> salvo (não um wrapper),
// então o tamanho escolhido aparece igual em qualquer lugar que renderize o
// HTML salvo (chamado, e-mail, nota interna) — não só dentro do editor.
function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, title, width } = node.attrs as { src: string; alt?: string; title?: string; width?: string | null };
  const imgRef = useRef<HTMLImageElement>(null);
  const draggingRef = useRef(false);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const startX = e.clientX;
    const startWidth = imgEl.getBoundingClientRect().width;
    draggingRef.current = true;

    const onMove = (moveEvent: PointerEvent) => {
      if (!draggingRef.current) return;
      const next = Math.max(MIN_WIDTH_PX, Math.round(startWidth + (moveEvent.clientX - startX)));
      updateAttributes({ width: `${next}px` });
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [updateAttributes]);

  return (
    // A extensão Image do Tiptap é um node de bloco por padrão (inline:
    // false) — renderizar o wrapper como <span> (inline) aqui quebrava a
    // suposição do ProseMirror de que esse node ocupa uma linha própria,
    // criando uma área vazia "fantasma" ao redor da imagem quando
    // selecionada. Isso valia enquanto ele era de bloco.
    //
    // Desde 2026-11-25 a imagem é um node INLINE (pedido do usuário: imagens
    // lado a lado quando cabem, quebrando linha como texto — `inline: true`
    // em rich-editor.tsx). Agora o wrapper PRECISA ser <span> inline-block:
    // um <div> quebraria a linha de novo. A largura fica no wrapper, então
    // "50%" é metade do parágrafo e duas de 50% ficam lado a lado.
    <NodeViewWrapper as="span" className="inline-block align-bottom max-w-full my-1" style={{ width: width || undefined }}>
      <span className={cn("relative inline-block max-w-full leading-none rounded-xl", width && "w-full", selected && "ring-2 ring-[var(--accent)]")}>
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          title={title}
          draggable={false}
          style={{ width: width ? '100%' : undefined, maxWidth: '100%', display: 'block', margin: 0 }}
          className="rounded-xl border border-[var(--border-default)] shadow-sm"
        />
        {selected && (
          <>
            <span
              contentEditable={false}
              className="absolute -top-10 left-0 flex items-center gap-0.5 bg-slate-900 rounded-lg shadow-xl px-1 py-1 z-10 whitespace-nowrap"
            >
              {PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => updateAttributes({ width: `${pct}%` })}
                  className={cn(
                    "px-1.5 py-0.5 text-[9px] font-bold rounded transition-colors",
                    width === `${pct}%` ? "bg-[var(--accent)] text-white" : "text-white/80 hover:text-white hover:bg-white/10"
                  )}
                >
                  {pct}%
                </button>
              ))}
              <span className="w-px h-3 bg-white/20 mx-0.5" />
              <button
                type="button"
                onClick={() => updateAttributes({ width: null })}
                className="px-1.5 py-0.5 text-[9px] font-bold text-white/80 hover:text-white hover:bg-white/10 rounded"
                title="Tamanho original"
              >
                Original
              </button>
            </span>
            <span
              contentEditable={false}
              onPointerDown={startResize}
              title="Arraste para redimensionar"
              className="absolute bottom-1 right-1 w-3.5 h-3.5 bg-[var(--accent)] border-2 border-white rounded-full shadow cursor-nwse-resize"
            />
          </>
        )}
      </span>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.width || element.getAttribute('width') || null,
        renderHTML: (attributes: { width?: string | null }) => {
          if (!attributes.width) return {};
          return { style: `width: ${attributes.width}; max-width: 100%;` };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
