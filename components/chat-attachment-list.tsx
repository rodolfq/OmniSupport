'use client';

import React, { useState } from 'react';
import { File, Image as ImageIcon, Download } from 'lucide-react';
import { Attachment } from '@/lib/types';
import { isImageAttachment, isAudioAttachment, isVideoAttachment } from '@/lib/attachment-kind';
import { AudioPlayer } from '@/components/audio-player';
import { AttachmentPreviewModal } from '@/components/attachment-gallery';

interface ChatAttachmentListProps {
  attachments: Attachment[];
}

// Renderização somente-leitura de anexos de chat, para contextos de
// histórico (Histórico de Conversas, aba "Conversa" do chamado) — ao
// contrário de chat-widget.tsx, não tem estado de "enviando"/transcrição sob
// demanda: só mostra o que já está salvo em cada anexo.
export function ChatAttachmentList({ attachments }: ChatAttachmentListProps) {
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {attachments.map((attachment) => {
        const key = attachment.id || attachment.url;

        if (isImageAttachment(attachment)) {
          return (
            <button
              key={key}
              type="button"
              onClick={() => setPreviewAttachment(attachment)}
              className="block w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-left transition-all hover:bg-[var(--surface-pill)]"
            >
              <img src={attachment.url} alt={attachment.name} className="max-h-56 w-full object-cover" />
              <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]">
                <ImageIcon size={13} />
                <span className="truncate">{attachment.name}</span>
              </div>
            </button>
          );
        }

        if (isAudioAttachment(attachment)) {
          return (
            <div key={key} className="space-y-1.5">
              <AudioPlayer src={attachment.url} name={attachment.name} />
              {attachment.transcription ? (
                <p className="px-1 text-xs italic leading-snug text-[var(--text-tertiary)]">
                  &quot;{attachment.transcription}&quot;
                </p>
              ) : (
                <p className="px-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-tertiary)]/70">
                  Transcrição indisponível
                </p>
              )}
            </div>
          );
        }

        if (isVideoAttachment(attachment)) {
          return (
            <video
              key={key}
              src={attachment.url}
              controls
              preload="metadata"
              className="max-h-64 w-full rounded-xl bg-black"
            />
          );
        }

        return (
          <a
            key={key}
            href={attachment.url}
            download={attachment.name}
            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 transition-all hover:bg-[var(--surface-pill)]"
          >
            <File size={16} className="shrink-0 text-[var(--text-tertiary)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-[var(--text-primary)]">{attachment.name}</p>
              <p className="text-[9px] font-bold uppercase text-[var(--text-tertiary)]">
                {attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : 'Arquivo'}
              </p>
            </div>
            <Download size={14} className="shrink-0 text-[var(--text-tertiary)]" />
          </a>
        );
      })}
      <AttachmentPreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
    </div>
  );
}
