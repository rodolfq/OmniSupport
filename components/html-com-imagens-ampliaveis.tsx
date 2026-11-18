'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Attachment } from '@/lib/types';
import { AttachmentPreviewModal } from '@/components/attachment-gallery';

// HTML de nota/mensagem (vindo do editor rico) em que as imagens coladas no
// texto abrem no mesmo modal das outras fotos da aplicação
// (AttachmentPreviewModal). Antes só os ANEXOS abriam no modal (ver
// ChatAttachmentList); a imagem colada no corpo da nota era um <img> solto,
// sem clique.
//
// O clique é tratado por delegação no container, porque o conteúdo chega como
// HTML pronto (dangerouslySetInnerHTML). Pelo mesmo motivo, cada <img> recebe
// foco e nome acessível depois de renderizar, para abrir também com Enter ou
// Espaço. Imagem dentro de link (<a><img></a>) mantém o comportamento do link.

interface HtmlComImagensAmpliaveisProps {
  html: string;
  className?: string;
  /** Elemento do container. O padrão `div` aceita qualquer HTML de nota. */
  as?: 'div' | 'p';
}

function imagemAmpliavel(alvo: EventTarget | null, container: HTMLElement | null): HTMLImageElement | null {
  if (!(alvo instanceof Element) || !container) return null;
  const imagem = alvo.closest('img');
  if (!imagem || !container.contains(imagem) || imagem.closest('a')) return null;
  return imagem.getAttribute('src') ? imagem : null;
}

function comoAnexo(imagem: HTMLImageElement): Attachment {
  const src = imagem.currentSrc || imagem.src;
  const nome = imagem.getAttribute('alt')?.trim() || 'Imagem da nota';
  return { id: src, name: nome, type: 'image/*', url: src, size: 0 };
}

export function HtmlComImagensAmpliaveis({ html, className, as = 'div' }: HtmlComImagensAmpliaveisProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [imagemAberta, setImagemAberta] = useState<Attachment | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('img').forEach(imagem => {
      if (imagem.closest('a')) return;
      imagem.tabIndex = 0;
      imagem.setAttribute('role', 'button');
      const nome = imagem.getAttribute('alt')?.trim();
      imagem.setAttribute('aria-label', nome ? `Ampliar imagem: ${nome}` : 'Ampliar imagem');
      imagem.style.cursor = 'zoom-in';
    });
  }, [html]);

  const abrir = useCallback((evento: React.SyntheticEvent) => {
    const imagem = imagemAmpliavel(evento.target, containerRef.current);
    if (!imagem) return false;
    evento.preventDefault();
    // Não deixa o clique chegar ao balão da nota (que pode ter ações próprias).
    evento.stopPropagation();
    setImagemAberta(comoAnexo(imagem));
    return true;
  }, []);

  const aoTeclar = useCallback((evento: React.KeyboardEvent) => {
    if (evento.key === 'Enter' || evento.key === ' ') abrir(evento);
  }, [abrir]);

  const fechar = useCallback(() => {
    // Devolve o foco à imagem que abriu o modal (navegação por teclado).
    const origem = imagemAberta?.url;
    setImagemAberta(null);
    if (!origem) return;
    requestAnimationFrame(() => {
      const imagens = Array.from(containerRef.current?.querySelectorAll('img') || []);
      imagens.find(i => (i.currentSrc || i.src) === origem)?.focus();
    });
  }, [imagemAberta]);

  const Elemento = as;
  return (
    <>
      <Elemento
        ref={(no: HTMLElement | null) => { containerRef.current = no; }}
        className={className}
        onClick={abrir}
        onKeyDown={aoTeclar}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <AttachmentPreviewModal attachment={imagemAberta} onClose={fechar} />
    </>
  );
}
