import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';
import { statAttachmentFile } from '@/lib/services/attachment-storage';
import { lookup as lookupMime } from '@/lib/mime-types';

// Serve os anexos gravados no volume (ver lib/services/attachment-storage.ts).
//
// Autenticada: não está em PUBLIC_PATHS/PUBLIC_PREFIXES do middleware.ts, ou
// seja, exige cookie de sessão como qualquer outra rota do portal. Isso é uma
// mudança em relação ao que existia (/api/chats/attachment servia anexo sem
// nenhuma sessão, só sabendo o messageId) e foi decisão explícita: anexo de
// atendimento pode conter documento de cliente.
//
// Não há checagem de "este usuário pode ver ESTE anexo": o caminho é um UUID
// aleatório e o modelo de autorização do projeto é por tela, não por objeto —
// mesma postura das demais rotas internas. Se um dia houver necessidade de
// escopo por empresa, é aqui que entra.
//
// Suporte a Range (2026-09-29): antes esta rota sempre respondia o arquivo
// INTEIRO, ignorando o header `Range`. Pra a maioria dos anexos (imagem,
// áudio pequeno, PDF) isso não se notava, mas o player de vídeo do chat
// (components/chat-widget.tsx, components/chat-attachment-list.tsx — um
// <video controls> comum) depende de o SERVIDOR aceitar pedir só um TRECHO do
// arquivo pra "adiantar"/"voltar" funcionar: sem isso, arrastar a barra de
// progresso pra um ponto ainda não baixado não tem como completar, e em vídeo
// grande (comum em vídeo de WhatsApp) o navegador trava tentando. Agora
// devolve 206 Partial Content quando vem `Range`, e sempre anuncia
// `Accept-Ranges: bytes` — é esse header que diz ao navegador "pode pedir
// pedaço". Efeito colateral bom: também evita carregar o arquivo inteiro na
// memória do processo a cada requisição (antes lia tudo com `readFile`).
export const dynamic = 'force-dynamic';

function buildContentDisposition(forceDownload: boolean, downloadName: string): string {
  return `${forceDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const relativePath = (segments || []).join('/');
  if (!relativePath) {
    return NextResponse.json({ error: 'Caminho inválido.' }, { status: 400 });
  }

  const stat = await statAttachmentFile(relativePath);
  if (!stat) {
    return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
  }
  const { absolutePath, size } = stat;

  const fileName = relativePath.split('/').pop() || 'arquivo';
  // ?download=1 força "Salvar como"; sem isso o navegador exibe inline, que é
  // o que as <img>/<audio>/<video> da conversa precisam.
  const forceDownload = request.nextUrl.searchParams.get('download') === '1';
  const downloadName = request.nextUrl.searchParams.get('name') || fileName;

  const baseHeaders: Record<string, string> = {
    'Content-Type': lookupMime(fileName),
    'Content-Disposition': buildContentDisposition(forceDownload, downloadName),
    // private: é conteúdo autenticado, não pode ficar em cache compartilhado
    // de proxy/CDN. O arquivo em si é imutável (nome é UUID), daí o immutable.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes'
  };

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    // Formato padrão HTTP: "bytes=INÍCIO-FIM", os dois lados opcionais
    // ("bytes=500-" = do byte 500 até o fim; "bytes=-500" = os últimos 500
    // bytes) — é assim que o <video> pede "me dá só o trecho perto de onde
    // arrastaram a barra".
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || (!match[1] && !match[2])) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    let start: number;
    let end: number;
    if (match[1] === '') {
      // sufixo: os últimos N bytes
      const suffixLength = parseInt(match[2], 10);
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    } else {
      start = parseInt(match[1], 10);
      end = match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
    }

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    const chunkSize = end - start + 1;
    const nodeStream = createReadStream(absolutePath, { start, end });
    return new NextResponse(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(chunkSize)
      }
    });
  }

  // Sem Range: o arquivo inteiro, mas em stream (não carrega tudo na memória
  // do processo de uma vez, o que importa pra vídeo de dezenas de MB).
  const nodeStream = createReadStream(absolutePath);
  return new NextResponse(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(size)
    }
  });
}
