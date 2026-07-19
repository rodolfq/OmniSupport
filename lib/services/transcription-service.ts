import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { query } from '@/lib/db';
import { emitChatEvent } from '@/lib/chat-events';
import type { Attachment } from '@/lib/types';

// Transcrição de áudio 100% local (Whisper open-source rodando no próprio
// servidor via @huggingface/transformers + onnxruntime), sem API paga nem
// gasto por uso — só o processamento da própria máquina. Desligada por
// padrão (ENABLE_AUDIO_TRANSCRIPTION) porque depende de baixar um modelo
// (~150MB na primeira transcrição) e rodar um binário de ffmpeg — não roda
// bem num ambiente serverless (Vercel); ligar só no servidor dedicado.
const ENABLED = process.env.ENABLE_AUDIO_TRANSCRIPTION === 'true';
const MODEL_NAME = process.env.TRANSCRIPTION_MODEL || 'Xenova/whisper-base';
const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'transcription-models');

// Mensagem devolvida (em vez de null/erro) quando o áudio está mudo/vazio ou
// quando o Whisper "alucina" em cima de silêncio/ruído — problema conhecido
// do modelo, que sem fala real para transcrever entra em loop repetindo a
// mesma frase curta centenas de vezes. Ambos os casos são tratados como
// "sem fala identificada" em vez de mostrar o texto em loop ou um erro.
const NO_SPEECH_TEXT = '[Áudio sem fala identificada]';

// Abaixo desse RMS (~-48 dBFS) o áudio é considerado silêncio/vazio — não
// vale a pena nem rodar o Whisper, que tende a alucinar em cima disso.
const SILENCE_RMS_THRESHOLD = 0.004;

// Heurística para detectar o loop de alucinação do Whisper: quando o texto
// tem muitas palavras mas pouquíssimas são únicas (ex.: "o que é" repetido
// 80 vezes), é sinal de que não havia fala real para transcrever.
const MIN_UNIQUE_WORD_RATIO = 0.2;

function isSilentAudio(samples: Float32Array): boolean {
  if (samples.length === 0) return true;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  return rms < SILENCE_RMS_THRESHOLD;
}

function looksLikeHallucinatedLoop(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 20) return false;
  const uniqueWords = new Set(words);
  return uniqueWords.size / words.length < MIN_UNIQUE_WORD_RATIO;
}

export function isTranscriptionEnabled(): boolean {
  return ENABLED;
}

export function isAudioAttachment(attachment: Pick<Attachment, 'type' | 'name' | 'url'>): boolean {
  return !!attachment.type?.startsWith('audio/') || /\.(webm|ogg|opus|mp3|m4a|wav|aac)$/i.test(attachment.name || attachment.url || '');
}

// Fila simples com no máximo 1 transcrição rodando por vez — CPU-bound e sem
// GPU, então processar várias ao mesmo tempo só disputaria os mesmos núcleos
// e deixaria o resto do servidor mais lento. Chamadas extras esperam a vez.
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queueTail.catch(() => {}).then(job);
  queueTail = run.catch(() => {});
  return run;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriberPromise: Promise<any> | null = null;
async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = CACHE_DIR;
      return pipeline('automatic-speech-recognition', MODEL_NAME, { dtype: 'q8' });
    })();
  }
  return transcriberPromise;
}

// Decodifica um data URL de áudio (qualquer formato que o ffmpeg entenda —
// wav do gravador do widget, ogg/opus do WhatsApp, etc.) para PCM float32
// mono 16kHz, o formato que o Whisper espera. Usa arquivos temporários em vez
// de pipe porque o ffmpeg-static no Windows lida melhor com arquivo do que
// com stdin/stdout binário.
async function decodeToPcm16k(dataUrl: string): Promise<Float32Array> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('URL de áudio inválida (esperado data: URL em base64)');
  const buffer = Buffer.from(match[2], 'base64');

  const tmpDir = os.tmpdir();
  const jobId = randomUUID();
  const inputPath = path.join(tmpDir, `transcribe-in-${jobId}`);
  const outputPath = path.join(tmpDir, `transcribe-out-${jobId}.pcm`);

  await fs.writeFile(inputPath, buffer);

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath as unknown as string, [
        '-hide_banner', '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        outputPath
      ]);
      let stderr = '';
      ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    const pcm = await fs.readFile(outputPath);
    const samples = new Float32Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = pcm.readInt16LE(i * 2) / 32768;
    }
    return samples;
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {})
    ]);
  }
}

// Transcreve um áudio (data URL) e devolve o texto, ou null se a
// transcrição estiver desligada ou falhar por qualquer motivo — é um recurso
// complementar, uma falha aqui nunca deve derrubar o envio/recebimento da
// mensagem em si.
export async function transcribeAudio(dataUrl: string): Promise<string | null> {
  if (!ENABLED) return null;

  return enqueue(async () => {
    try {
      const samples = await decodeToPcm16k(dataUrl);
      if (isSilentAudio(samples)) return NO_SPEECH_TEXT;

      const transcriber = await getTranscriber();
      const result = await transcriber(samples, {
        language: 'portuguese',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      const text = (Array.isArray(result) ? result[0]?.text : result?.text)?.trim();
      if (!text) return null;
      return looksLikeHallucinatedLoop(text) ? NO_SPEECH_TEXT : text;
    } catch (err) {
      console.error('[transcription-service] Falha ao transcrever áudio:', err);
      return null;
    }
  });
}

// Ponto de integração: transcreve o anexo de áudio de uma mensagem já salva,
// grava o texto de volta no metadata (mesmo anexo, campo `transcription`) e
// avisa quem estiver com a conversa aberta agora via SSE. Disparado sob
// demanda (botão "Transcrever" no player de áudio), não automaticamente —
// devolve o texto pra rota que chamou poder responder na hora, sem precisar
// esperar o SSE.
export async function transcribeMessageAudio(params: {
  messageId: string;
  sessionId: string;
  attachment: Attachment;
}): Promise<string | null> {
  if (!ENABLED) return null;
  const { messageId, sessionId, attachment } = params;
  if (!isAudioAttachment(attachment) || !attachment.url) return null;

  const text = await transcribeAudio(attachment.url);
  if (!text) return null;

  try {
    const res = await query('SELECT metadata FROM public.chat_messages WHERE id = $1', [messageId]);
    const row = res.rows[0];
    if (!row) return text;

    const metadata = row.metadata || {};
    const attachments: Attachment[] = metadata.attachments || [];
    const updatedAttachments = attachments.map(a => a.id === attachment.id ? { ...a, transcription: text } : a);

    await query('UPDATE public.chat_messages SET metadata = $1 WHERE id = $2', [
      JSON.stringify({ ...metadata, attachments: updatedAttachments }),
      messageId
    ]);

    emitChatEvent(sessionId, {
      type: 'transcription',
      sessionId,
      messageId,
      attachmentId: attachment.id,
      transcription: text
    });

    return text;
  } catch (err) {
    console.error('[transcription-service] Falha ao salvar transcrição:', err);
    return text;
  }
}
