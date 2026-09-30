import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
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

// Mesma resolução de binário de lib/services/transcription-service.ts.
const FFMPEG_BIN = process.env.FFMPEG_PATH || (ffmpegPath as unknown as string) || 'ffmpeg';
const REMUX_TIMEOUT_MS = 15000;

// Áudio de voz que chega de fora (WhatsApp via Pyvon) às vezes vem num
// OGG/Opus sem cabeçalho de duração/posição de busca corretos — o Chrome não
// sabe pular/voltar dentro dele (mesmo bug relatado pro player de vídeo em
// 2026-09-29, mas ali o problema era o SERVIDOR não aceitar Range; aqui o
// servidor já aceita — ver app/api/files/[...path]/route.ts —, o problema é
// o ARQUIVO em si não ter posição de granule/duração que o navegador
// consiga usar pra calcular onde buscar). Reencodar com ffmpeg SEMPRE
// finaliza esse cabeçalho direito, resolvendo na raiz em vez de só mascarar
// sintoma (o "truque" em components/audio-player.tsx de forçar a duração
// buscando pro fim do arquivo continua existindo como rede de segurança,
// mas some de fato em áudio remuxado por aqui).
//
// Falha graciosamente: ffmpeg ausente/travado ou áudio corrompido devolve
// null, e quem chama grava o buffer ORIGINAL — o áudio chega com o bug de
// busca de sempre, mas a mensagem nunca deixa de ser salva por causa disto.
export async function remuxAudioForSeeking(buffer: Buffer): Promise<Buffer | null> {
  if (FFMPEG_BIN !== 'ffmpeg') {
    try {
      await fs.access(FFMPEG_BIN);
    } catch {
      console.error(`[attachment-storage] ffmpeg não encontrado em ${FFMPEG_BIN} — áudio salvo sem remux (busca pode não funcionar).`);
      return null;
    }
  }

  const tmpDir = os.tmpdir();
  const jobId = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `remux-in-${jobId}`);
  const outputPath = path.join(tmpDir, `remux-out-${jobId}.ogg`);

  await fs.writeFile(inputPath, buffer);

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-c:a', 'libopus',
        '-b:a', '32k',
        outputPath
      ]);
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ffmpeg.kill('SIGKILL');
        reject(new Error(`ffmpeg excedeu ${REMUX_TIMEOUT_MS / 1000}s remuxando o áudio`));
      }, REMUX_TIMEOUT_MS);

      ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      ffmpeg.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      ffmpeg.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    return await fs.readFile(outputPath);
  } catch (error) {
    console.error('[attachment-storage] Falha ao remuxar áudio, salvando original:', error);
    return null;
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);
  }
}

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

/**
 * Tamanho do arquivo no disco, sem carregar o conteúdo — quem serve o anexo
 * por streaming, com suporte a Range (ver app/api/files/[...path]/route.ts),
 * precisa saber o tamanho total ANTES de decidir o trecho a devolver.
 */
export async function statAttachmentFile(relativePath: string): Promise<{ absolutePath: string; size: number } | null> {
  const absolute = resolveAttachmentPath(relativePath);
  if (!absolute) return null;
  try {
    const stats = await fs.stat(absolute);
    return { absolutePath: absolute, size: stats.size };
  } catch {
    return null;
  }
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
