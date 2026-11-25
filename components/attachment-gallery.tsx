'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, File, Image as ImageIcon, Film, Music, ExternalLink, Maximize2, X, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Attachment } from '@/lib/types';
import { isVideoAttachment } from '@/lib/attachment-kind';
import { cn } from '@/lib/utils';

interface AttachmentGalleryProps {
  attachments: Attachment[];
  title?: string;
}

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.name || attachment.url || '');
}

// Miniatura compacta pra chips de anexo (resposta de chamado, área de
// "vai anexar" antes de enviar) — antes mostravam só um ícone genérico +
// nome do arquivo, mesmo quando dava pra exibir a prévia de verdade.
// Imagem/vídeo ganham preview real; qualquer outro tipo cai no `fallback`
// que quem chamou já tinha (ícone por extensão/mimetype).
export function AttachmentChipThumb({
  attachment,
  size = 16,
  fallback,
}: {
  attachment: Attachment;
  size?: number;
  fallback: React.ReactNode;
}) {
  if (isImageAttachment(attachment)) {
    return (
      <img
        src={attachment.url}
        alt={attachment.name}
        className="rounded object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  if (isVideoAttachment(attachment)) {
    return (
      <span className="relative inline-flex shrink-0 overflow-hidden rounded bg-black" style={{ width: size, height: size }}>
        <video src={attachment.url} preload="metadata" muted className="h-full w-full object-cover opacity-80" />
        <Play size={Math.max(8, size * 0.55)} className="absolute inset-0 m-auto text-white" fill="white" />
      </span>
    );
  }
  return <>{fallback}</>;
}

export async function openAttachmentInNewTab(attachment: Attachment) {
  if (!attachment.url) return;

  if (attachment.url.startsWith('data:')) {
    try {
      const [header, payload = ''] = attachment.url.split(',');
      const isBase64 = /;base64/i.test(header);
      const mime = header.match(/^data:([^;,]+)/)?.[1] || attachment.type || 'application/octet-stream';
      const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return;
    } catch {
      window.open(attachment.url, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error('Attachment fetch failed');
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch {
    window.open(attachment.url, '_blank', 'noopener,noreferrer');
  }
}

// Item da galeria do visualizador. `subtitle` aparece no cabeçalho no lugar do
// tamanho do arquivo (ex.: "Fulano · 25/11/2026 14:32", como no WhatsApp).
export interface MediaGalleryItem {
  attachment: Attachment;
  subtitle?: string;
}

export function mediaKey(attachment: Attachment): string {
  return attachment.id || attachment.url;
}

export function AttachmentPreviewModal({
  attachment,
  onClose,
  gallery,
  onNavigate,
}: {
  attachment: Attachment | null;
  onClose: () => void;
  // Navegação entre mídias (2026-11-25, pedido do usuário, "como no
  // WhatsApp"): com a galeria, setas laterais, ← → do teclado, deslizar no
  // celular e faixa de miniaturas trocam a mídia aberta. Sem galeria (ou com
  // a mídia aberta fora dela), o modal se comporta como sempre: uma imagem só.
  gallery?: MediaGalleryItem[];
  onNavigate?: (attachment: Attachment) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const index = attachment && gallery ? gallery.findIndex(item => mediaKey(item.attachment) === mediaKey(attachment)) : -1;
  const canNavigate = index >= 0 && !!onNavigate && (gallery?.length || 0) > 1;
  const hasPrev = canNavigate && index > 0;
  const hasNext = canNavigate && index < (gallery!.length - 1);
  const current = index >= 0 ? gallery![index] : null;
  const isVideo = !!attachment && isVideoAttachment(attachment);

  const goTo = useCallback((nextIndex: number) => {
    if (!gallery || !onNavigate) return;
    const item = gallery[nextIndex];
    if (item) onNavigate(item.attachment);
  }, [gallery, onNavigate]);

  // Teclado: Esc fecha, ← → navegam. Escuta na captura e para a propagação:
  // este modal abre por cima de outros (detalhe do chamado, chat) que também
  // reagem ao Esc — sem isso um único Esc fecharia a imagem E o modal de trás.
  useEffect(() => {
    if (!attachment) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isEsc = event.key === 'Escape';
      const isPrev = event.key === 'ArrowLeft' && hasPrev;
      const isNext = event.key === 'ArrowRight' && hasNext;
      if (!isEsc && !isPrev && !isNext) return;
      // ← → dentro dos controles do vídeo (avançar/voltar o trecho) não trocam de mídia.
      if (!isEsc && (event.target as HTMLElement | null)?.tagName === 'VIDEO') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (isEsc) onClose();
      else goTo(index + (isNext ? 1 : -1));
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [attachment, onClose, hasPrev, hasNext, index, goTo]);

  // Foco no diálogo ao abrir (leitor de tela anuncia, teclado funciona sem
  // clique) e devolvido a quem abriu ao fechar.
  useEffect(() => {
    if (!attachment) return;
    const origem = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => { origem?.focus?.(); };
    // Só na abertura/fechamento — navegar entre mídias não mexe no foco.
  }, [!!attachment]);

  // Pré-carrega as imagens vizinhas: a troca pela seta fica instantânea.
  useEffect(() => {
    if (!canNavigate) return;
    [index - 1, index + 1].forEach(i => {
      const neighbor = gallery?.[i]?.attachment;
      if (neighbor && isImageAttachment(neighbor)) { const img = new window.Image(); img.src = neighbor.url; }
    });
  }, [canNavigate, index, gallery]);

  // Miniatura ativa sempre visível na faixa.
  useEffect(() => {
    if (!canNavigate) return;
    const el = thumbsRef.current?.querySelector<HTMLElement>(`[data-media-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [canNavigate, index]);

  const onTouchStart = (event: React.TouchEvent) => {
    const t = event.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = event.changedTouches[0];
    if (!start || !t || !canNavigate) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Só gesto claramente horizontal: rolagem vertical não troca de mídia.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && hasNext) goTo(index + 1);
    if (dx > 0 && hasPrev) goTo(index - 1);
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {attachment && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: 2147483647, isolation: 'isolate' }}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
            style={{ zIndex: 2147483646 }}
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={canNavigate ? `Mídia ${index + 1} de ${gallery!.length}: ${attachment.name}` : attachment.name}
            tabIndex={-1}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            className="relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-[var(--surface-card)] shadow-2xl outline-none"
            style={{ zIndex: 2147483647 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent-text)]">
                  {isVideo ? <Film size={18} /> : <ImageIcon size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[var(--text-primary)]">{current?.subtitle || attachment.name}</p>
                  <p className="truncate text-[10px] font-semibold text-[var(--text-tertiary)]">
                    {canNavigate && <span className="text-[var(--text-secondary)]">{index + 1} de {gallery!.length}</span>}
                    {canNavigate && ' · '}
                    {current?.subtitle ? attachment.name : (attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : (isVideo ? 'Vídeo' : 'Imagem'))}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAttachmentInNewTab(attachment)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border-default)] text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-card)] hover:text-[var(--accent-text)]"
                  title="Abrir em nova aba"
                >
                  <Maximize2 size={17} />
                </button>
                <a
                  href={attachment.url}
                  download={attachment.name}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--border-default)] text-[var(--text-tertiary)] transition-all hover:bg-[var(--surface-card)] hover:text-[var(--accent-text)]"
                  title={isVideo ? 'Baixar vídeo' : 'Baixar imagem'}
                  aria-label={isVideo ? 'Baixar vídeo' : 'Baixar imagem'}
                >
                  <Download size={17} />
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white transition-all hover:bg-slate-800"
                  title="Fechar preview"
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-6"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* key = mídia: trocar de item recria o elemento (o vídeo anterior para de tocar). */}
              {isVideo ? (
                <video
                  key={mediaKey(attachment)}
                  src={attachment.url}
                  controls
                  autoPlay
                  className="max-h-full max-w-full rounded-xl bg-black"
                />
              ) : (
                <img
                  key={mediaKey(attachment)}
                  src={attachment.url}
                  alt={attachment.name}
                  className="max-h-full max-w-full rounded-xl object-contain select-none"
                  draggable={false}
                />
              )}
              {canNavigate && (
                <>
                  <button
                    type="button"
                    onClick={() => goTo(index - 1)}
                    disabled={!hasPrev}
                    className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 shadow-lg backdrop-blur-sm transition-all hover:bg-white/30 disabled:opacity-0 disabled:pointer-events-none"
                    title="Mídia anterior (←)"
                    aria-label="Mídia anterior"
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(index + 1)}
                    disabled={!hasNext}
                    className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 shadow-lg backdrop-blur-sm transition-all hover:bg-white/30 disabled:opacity-0 disabled:pointer-events-none"
                    title="Próxima mídia (→)"
                    aria-label="Próxima mídia"
                  >
                    <ChevronRight size={24} />
                  </button>
                </>
              )}
            </div>
            {canNavigate && (
              <div
                ref={thumbsRef}
                className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-slate-950 px-3 py-2.5"
                role="listbox"
                aria-label="Mídias da conversa"
              >
                {gallery!.map((item, i) => {
                  const active = i === index;
                  const thumbIsVideo = isVideoAttachment(item.attachment);
                  return (
                    <button
                      key={`${mediaKey(item.attachment)}-${i}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-media-index={i}
                      onClick={() => goTo(i)}
                      title={item.subtitle || item.attachment.name}
                      className={cn(
                        "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
                        active ? "border-[var(--accent)] opacity-100" : "border-transparent opacity-55 hover:opacity-90"
                      )}
                    >
                      {thumbIsVideo ? (
                        <>
                          <video src={item.attachment.url} preload="metadata" muted className="h-full w-full object-cover bg-black" />
                          <Play size={14} className="absolute inset-0 m-auto text-white drop-shadow" fill="white" />
                        </>
                      ) : (
                        <img src={item.attachment.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function AttachmentGallery({ attachments, title = "Todos os Anexos" }: AttachmentGalleryProps) {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  if (attachments.length === 0) {
    return (
      <div className="text-center py-20 bg-[var(--surface-card)]/50 rounded-3xl border-2 border-dashed border-[var(--border-default)]">
        <File size={40} className="mx-auto text-slate-300 mb-4" />
        <p className="text-sm font-bold text-[var(--text-tertiary)] uppercase tracking-widest">Nenhum anexo encontrado</p>
      </div>
    );
  }

  const getIcon = (type: string) => {
    if (!type) return <File size={20} className="text-[var(--text-tertiary)]" />;
    if (type.startsWith('image/')) return <ImageIcon size={20} className="text-[var(--accent-text)]" />;
    if (type.startsWith('video/')) return <Film size={20} className="text-[var(--text-warning-strong)]" />;
    if (type.startsWith('audio/')) return <Music size={20} className="text-[var(--text-success)]" />;
    return <File size={20} className="text-[var(--text-tertiary)]" />;
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)]">{title}</h3>
        <span className="text-[10px] font-black bg-[var(--surface-pill)] text-[var(--text-tertiary)] px-2 py-0.5 rounded-full">{attachments.length} arquivos</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {attachments.map((file) => {
          const isImage = isImageAttachment(file);
          
          return (
            <div 
              key={file.id} 
              className="group relative bg-[var(--surface-card)] border border-[var(--border-default)] rounded-2xl overflow-hidden hover:shadow-xl hover:border-[var(--accent)]/30 transition-all duration-300"
            >
              {isImage ? (
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(file)}
                  className="aspect-video w-full bg-[var(--surface-pill)] relative overflow-hidden text-left"
                  title="Visualizar imagem"
                >
                  <img
                    src={file.url}
                    alt={file.name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     <span
                       className="p-2 bg-[var(--surface-card)] rounded-full text-[var(--text-primary)] shadow-xl hover:scale-110 transition-all font-black text-[10px]"
                     >
                       <ExternalLink size={14} />
                     </span>
                  </div>
                </button>
              ) : isVideoAttachment(file) ? (
                <div className="aspect-video w-full bg-black relative overflow-hidden">
                  <video src={file.url} preload="metadata" muted className="w-full h-full object-cover opacity-90" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="p-2.5 bg-white/90 rounded-full text-slate-900 shadow-xl">
                      <Play size={16} fill="currentColor" />
                    </span>
                  </div>
                </div>
              ) : (
                <div className="aspect-video w-full bg-[var(--surface-card)] flex items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--surface-card)] shadow-sm flex items-center justify-center">
                    {getIcon(file.type)}
                  </div>
                </div>
              )}
              
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-[var(--text-primary)] truncate" title={file.name}>{file.name}</p>
                    <p className="text-[10px] font-bold text-[var(--text-tertiary)] mt-0.5 uppercase tracking-tighter">
                      {(file.type && file.type.includes('/')) ? (file.type.split('/')[1] || 'FILE') : (file.type || 'FILE')} • {formatSize(file.size)}
                    </p>
                  </div>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="p-2 bg-[var(--accent)]/10 text-[var(--accent-text)] rounded-lg hover:bg-[var(--accent)] hover:text-white transition-all shrink-0"
                    title="Download"
                  >
                    <Download size={14} />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
    </div>
  );
}


