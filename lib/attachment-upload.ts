import type { Attachment } from '@/lib/types';

// Client-safe (sem 'pg'/ffmpeg) — importável por qualquer component.
//
// Substitui o padrão antigo (fileToBase64/FileReader.readAsDataURL + embutir
// o resultado dentro do JSON da mensagem): o arquivo agora vai de verdade
// como multipart/form-data pra app/api/attachments/upload/route.ts, que grava
// em disco e devolve a URL curta (/api/files/...) — o mesmo formato que
// persistAttachment (lib/services/attachment-storage.ts) já trata como
// "já persistido" e repassa sem reprocessar.
//
// Por quê: achado em 2026-09-30 (conversa da Central de Atendimento) — um
// arquivo de 125MB, dentro do teto de 220MB de lib/attachment-limits.ts,
// travava a aba do navegador. FileReader.readAsDataURL lê o arquivo INTEIRO
// e monta uma string base64 (~33% maior) na memória da aba, tudo na thread
// principal, sem Web Worker — e essa string ainda ia inteira dentro de um
// único POST em JSON. fetch()+FormData, ao contrário, nunca materializa o
// arquivo como string JS: o navegador transmite o Blob em stream direto.
export async function uploadAttachment(fileOrBlob: File | Blob, filename?: string): Promise<Attachment> {
  const name = filename || (fileOrBlob instanceof File ? fileOrBlob.name : 'arquivo');
  const formData = new FormData();
  formData.append('file', fileOrBlob, name);

  const res = await fetch('/api/attachments/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Erro ao enviar arquivo.');
  }
  return res.json();
}
