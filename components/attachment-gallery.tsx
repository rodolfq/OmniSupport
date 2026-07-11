'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, File, Image as ImageIcon, Film, Music, ExternalLink, Maximize2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Attachment } from '@/lib/types';

interface AttachmentGalleryProps {
  attachments: Attachment[];
  title?: string;
}

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.name || attachment.url || '');
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

export function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            className="relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
            style={{ zIndex: 2147483647 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <ImageIcon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-800">{attachment.name}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : 'Imagem'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openAttachmentInNewTab(attachment)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-indigo-600"
                  title="Abrir em nova aba"
                >
                  <Maximize2 size={17} />
                </button>
                <a
                  href={attachment.url}
                  download={attachment.name}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition-all hover:bg-slate-50 hover:text-indigo-600"
                  title="Baixar imagem"
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
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-6">
              <img
                src={attachment.url}
                alt={attachment.name}
                className="max-h-full max-w-full rounded-xl object-contain"
              />
            </div>
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
      <div className="text-center py-20 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
        <File size={40} className="mx-auto text-slate-300 mb-4" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Nenhum anexo encontrado</p>
      </div>
    );
  }

  const getIcon = (type: string) => {
    if (!type) return <File size={20} className="text-slate-500" />;
    if (type.startsWith('image/')) return <ImageIcon size={20} className="text-indigo-500" />;
    if (type.startsWith('video/')) return <Film size={20} className="text-amber-500" />;
    if (type.startsWith('audio/')) return <Music size={20} className="text-emerald-500" />;
    return <File size={20} className="text-slate-500" />;
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
        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest">{title}</h3>
        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{attachments.length} arquivos</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {attachments.map((file) => {
          const isImage = isImageAttachment(file);
          
          return (
            <div 
              key={file.id} 
              className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-indigo-200 transition-all duration-300"
            >
              {isImage ? (
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(file)}
                  className="aspect-video w-full bg-slate-100 relative overflow-hidden text-left"
                  title="Visualizar imagem"
                >
                  <img 
                    src={file.url} 
                    alt={file.name} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                     <span
                       className="p-2 bg-white rounded-full text-slate-900 shadow-xl hover:scale-110 transition-all font-black text-[10px]"
                     >
                       <ExternalLink size={14} />
                     </span>
                  </div>
                </button>
              ) : (
                <div className="aspect-video w-full bg-slate-50 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                    {getIcon(file.type)}
                  </div>
                </div>
              )}
              
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800 truncate" title={file.name}>{file.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-tighter">
                      {(file.type && file.type.includes('/')) ? (file.type.split('/')[1] || 'FILE') : (file.type || 'FILE')} • {formatSize(file.size)}
                    </p>
                  </div>
                  <a 
                    href={file.url} 
                    download={file.name}
                    className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shrink-0"
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


