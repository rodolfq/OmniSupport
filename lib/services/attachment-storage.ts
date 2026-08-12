import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Attachment } from '@/lib/types';

// Armazenamento físico de anexos.
//
// Até aqui todo anexo era gravado como `data:` URL dentro do próprio Postgres
// (chat_messages.metadata, tickets/ticket_messages.attachments_data, ...): um
// arquivo de 8MB virava ~11MB de base64 dentro de um JSONB, carregado inteiro
// em toda listagem de conversa. Agora o binário vai para o disco (volume do
// container, ver ATTACHMENTS_DIR no docker-compose.yml) e no banco fica só uma
// URL curta servida por app/api/files/[...path]/route.ts.
//
// Sem tabela de índice de propósito: o caminho relativo do arquivo ESTÁ na
// URL, e o nome original/tipo/tamanho continuam no mesmo JSON de sempre
// (Attachment). Um anexo a menos no banco não deixa arquivo órfão perigoso —
// no máximo lixo em disco, que um faxineiro futuro pode varrer.

// Fora do container (dev local) grava em ./data/attachments, que o .gitignore
// já cobre por ser diretório de dados, não de código.
const DEFAULT_DIR = path.join(process.cwd(), 'data', 'attachments');

export function getAttachmentsDir(): string {
  return process.env.ATTACHMENTS_DIR || DEFAULT_DIR;
}

export const ATTACHMENT_URL_PREFIX = '/api/files/';

// Extensão a partir do MIME, com fallback pelo nome original. Só é usada pra
// deixar o arquivo reconhecível em disco — quem manda no Content-Type servido
// é o `type` guardado no JSON do anexo.
function extensionFor(mime: string, originalName?: string): string {
  const fromName = originalName ? path.extname(originalName).replace('.', '') : '';
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  const subtype = mime.split('/')[1]?.split(';')[0] || 'bin';
  const cleaned = subtype.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return cleaned || 'bin';
}

export interface StoredFile {
  // Caminho relativo dentro de ATTACHMENTS_DIR (ex.: '2026/08/uuid.png').
  relativePath: string;
  // URL pública (autenticada) para consumo no front.
  url: string;
  size: number;
}

// Grava o binário e devolve a URL. Particionado por ano/mês pra nenhum
// diretório acumular dezenas de milhares de entradas — ls/backup em diretório
// gigante é dolorido em qualquer filesystem.
export async function storeAttachmentBuffer(
  buffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<StoredFile> {
  const now = new Date();
  const folder = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
  const fileName = `${crypto.randomUUID()}.${extensionFor(mimeType, originalName)}`;
  const relativePath = path.posix.join(folder.split(path.sep).join('/'), fileName);

  const absoluteDir = path.join(getAttachmentsDir(), folder);
  await fs.mkdir(absoluteDir, { recursive: true });
  await fs.writeFile(path.join(absoluteDir, fileName), buffer);

  return { relativePath, url: `${ATTACHMENT_URL_PREFIX}${relativePath}`, size: buffer.byteLength };
}

export function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  if (!dataUrl?.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const isBase64 = /;base64/i.test(header);
  const mimeType = header.split(';')[0] || 'application/octet-stream';
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf-8');
  return { buffer, mimeType };
}

// Converte um anexo que chegou como `data:` URL num anexo apontando pro disco.
// Anexo que já veio com URL (http, /api/files/...) passa direto — a função é
// idempotente de propósito, pra poder ser chamada em qualquer ponto de escrita
// sem o chamador precisar saber a procedência do anexo.
export async function persistAttachment(attachment: Attachment): Promise<Attachment> {
  const parsed = attachment?.url ? parseDataUrl(attachment.url) : null;
  if (!parsed) return attachment;

  const stored = await storeAttachmentBuffer(parsed.buffer, parsed.mimeType, attachment.name);
  return {
    ...attachment,
    url: stored.url,
    type: attachment.type || parsed.mimeType,
    size: attachment.size || stored.size
  };
}

// Versão em lote, tolerante a falha: se a gravação de UM anexo falhar, ele
// continua como `data:` URL (comportamento antigo) em vez de a mensagem
// inteira não ser enviada. Perder o anexo seria pior do que o banco crescer.
export async function persistAttachments(attachments?: Attachment[] | null): Promise<Attachment[]> {
  if (!attachments?.length) return attachments || [];
  return Promise.all(
    attachments.map(async attachment => {
      try {
        return await persistAttachment(attachment);
      } catch (err) {
        console.error('[attachment-storage] Falha ao gravar anexo em disco, mantendo inline:', err);
        return attachment;
      }
    })
  );
}

// Mesma conversão, mas sobre um registro cru de tabela (as duas formas que o
// projeto usa: coluna `attachments_data` e `metadata.attachments`). Existe pro
// tradutor do shim Supabase (app/api/compat/supabase/route.ts), por onde ainda
// passam escritas antigas — ex.: mensagem de ticket interno em
// lib/services/ticket-service.ts. Sem isso essas rotas continuariam gravando
// base64 no banco, e o ganho da migração seria parcial.
export async function persistAttachmentsInRecord<T extends Record<string, any>>(record: T): Promise<T> {
  if (!record || typeof record !== 'object') return record;
  let result = record;

  if (Array.isArray(result.attachments_data)) {
    result = { ...result, attachments_data: await persistAttachments(result.attachments_data) };
  }
  if (result.metadata && typeof result.metadata === 'object' && Array.isArray(result.metadata.attachments)) {
    result = {
      ...result,
      metadata: { ...result.metadata, attachments: await persistAttachments(result.metadata.attachments) }
    };
  }
  return result;
}

// Resolve um caminho vindo da URL para um caminho absoluto dentro do
// diretório de anexos. Devolve null pra qualquer tentativa de sair dele
// ('../../etc/passwd'), que é o risco clássico de servir arquivo por path na
// URL — a checagem é feita depois de resolver, não por blacklist de '..'.
export function resolveAttachmentPath(relativePath: string): string | null {
  const root = path.resolve(getAttachmentsDir());
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

export async function readAttachmentFile(relativePath: string): Promise<Buffer | null> {
  const absolute = resolveAttachmentPath(relativePath);
  if (!absolute) return null;
  try {
    return await fs.readFile(absolute);
  } catch {
    return null;
  }
}
