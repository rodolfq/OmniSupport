import { NextRequest, NextResponse } from 'next/server';
import { readAttachmentFile } from '@/lib/services/attachment-storage';
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
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const relativePath = (segments || []).join('/');
  if (!relativePath) {
    return NextResponse.json({ error: 'Caminho inválido.' }, { status: 400 });
  }

  const buffer = await readAttachmentFile(relativePath);
  if (!buffer) {
    return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
  }

  const fileName = relativePath.split('/').pop() || 'arquivo';
  // ?download=1 força "Salvar como"; sem isso o navegador exibe inline, que é
  // o que as <img>/<audio>/<video> da conversa precisam.
  const forceDownload = request.nextUrl.searchParams.get('download') === '1';
  const downloadName = request.nextUrl.searchParams.get('name') || fileName;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': lookupMime(fileName),
      'Content-Length': String(buffer.byteLength),
      'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      // private: é conteúdo autenticado, não pode ficar em cache compartilhado
      // de proxy/CDN. O arquivo em si é imutável (nome é UUID), daí o immutable.
      'Cache-Control': 'private, max-age=31536000, immutable'
    }
  });
}
