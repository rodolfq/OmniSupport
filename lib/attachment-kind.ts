import type { Attachment } from '@/lib/types';

// Detecção de tipo de anexo por MIME (com fallback pela extensão do nome).
// Client-safe de propósito: lib/services/transcription-service.ts importa
// 'pg'/ffmpeg (Node-only) e não pode ser puxado por um client component —
// ver o bug corrigido em lib/integration-constants.ts para o mesmo caso.

export function isImageAttachment(attachment: Pick<Attachment, 'type' | 'name' | 'url'>): boolean {
  return !!attachment.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.name || attachment.url || '');
}

export function isAudioAttachment(attachment: Pick<Attachment, 'type' | 'name' | 'url'>): boolean {
  return !!attachment.type?.startsWith('audio/') || /\.(webm|ogg|opus|mp3|m4a|wav|aac)$/i.test(attachment.name || attachment.url || '');
}

export function isVideoAttachment(attachment: Pick<Attachment, 'type' | 'name' | 'url'>): boolean {
  return !!attachment.type?.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(attachment.name || attachment.url || '');
}
