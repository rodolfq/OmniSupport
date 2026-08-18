import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { query } from '@/lib/db';

// Serve a logo da empresa como IMAGEM, em vez de embutir o base64 na
// listagem — mesmo raciocínio (e mesmo bug que isso evita) de
// app/api/users/[id]/avatar/route.ts: companies.logo_url guarda a imagem
// inteira como `data:` URL, e listar empresas não deve pagar esse peso toda
// vez só pra desenhar o card/sidebar.

const DATA_URL_RE = /^data:([^;,]+)(;base64)?,(.*)$/s;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sem checagem de sessão explícita: middleware.ts já barra tudo que não é
  // rota pública, e esta não está na lista.
  try {
    const res = await query('SELECT logo_url FROM public.companies WHERE id = $1', [id]);
    const dataUrl: string | null = res.rows[0]?.logo_url || null;
    if (!dataUrl) {
      return NextResponse.json({ error: 'Sem logo.' }, { status: 404 });
    }

    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      console.error('[company-logo] logo_url da empresa %s não é uma data: URL', id);
      return NextResponse.json({ error: 'Logo inválida.' }, { status: 404 });
    }

    const [, mime, isBase64, payload] = match;
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    const etag = `"${createHash('sha1').update(buffer).digest('hex')}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, max-age=300, must-revalidate' }
      });
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=300, must-revalidate',
        ETag: etag
      }
    });
  } catch (error: any) {
    console.error('[company-logo] Falha ao servir logo da empresa:', error);
    return NextResponse.json({ error: 'Erro ao carregar a logo.' }, { status: 500 });
  }
}
