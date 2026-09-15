import { NextRequest, NextResponse } from 'next/server';
import { readAttachmentFile } from '@/lib/services/attachment-storage';
import { lookup as lookupMime } from '@/lib/mime-types';
import { verifyPyvonMediaToken } from '@/lib/services/pyvon-media-link';

// Único jeito de o Pyvon baixar um anexo nosso pra reencaminhar como mídia
// (bot-response.image_url/document_url exige URL pública, e /api/files exige
// sessão — decisão explícita, anexo pode ser documento de cliente). Fica em
// middleware.ts PUBLIC_PATHS porque o Pyvon não manda cookie nenhum; quem
// autentica aqui é o próprio token HMAC de curta duração na querystring
// (ver lib/services/pyvon-media-link.ts), não a rota em si.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path') || '';
  const expires = request.nextUrl.searchParams.get('expires') || '';
  const sig = request.nextUrl.searchParams.get('sig') || '';

  if (!verifyPyvonMediaToken(path, expires, sig)) {
    return NextResponse.json({ error: 'Link inválido ou expirado.' }, { status: 403 });
  }

  const buffer = await readAttachmentFile(path);
  if (!buffer) return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });

  const fileName = path.split('/').pop() || 'arquivo';
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': lookupMime(fileName),
      'Content-Length': String(buffer.byteLength),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      // Token é de uso único-ish (15min) — nunca vale a pena um proxy/CDN guardar isso.
      'Cache-Control': 'private, no-store'
    }
  });
}
