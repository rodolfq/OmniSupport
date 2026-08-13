import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { query } from '@/lib/db';

// Serve a foto de perfil como IMAGEM, em vez de embutir o base64 na listagem.
//
// Por que existe: profiles.avatar_url guarda a foto inteira como `data:` URL
// (é assim que o sync do Bitrix24 grava). São 50,7 MB somando os 72 perfis com
// foto, e a maior sozinha passa de 2,7 MB. Toda tela que listava usuários
// baixava esse peso inteiro, em toda montagem, só pra desenhar avatares de 32 a
// 56 pixels.
//
// Agora a listagem devolve só o endereço desta rota, e o navegador busca cada
// imagem uma vez e reaproveita das outras telas pelo cache. A alternativa
// seria mandar a miniatura de 48x48 no lugar da foto, mas isso rebaixaria a
// qualidade justamente onde ela aparece maior — aqui a foto continua inteira.
//
// ATENÇÃO ao editar: como a listagem passou a devolver ESTA URL no campo
// avatarUrl, qualquer gravação que devolva o objeto de usuário inteiro (ver
// components/link-contact-modal.tsx) mandaria a URL de volta no lugar da
// imagem. A trava está no PUT de app/api/users/route.ts, que só reescreve
// avatar_url quando o valor recebido é mesmo uma `data:` URL.

const DATA_URL_RE = /^data:([^;,]+)(;base64)?,(.*)$/s;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Sem checagem de sessão explícita: middleware.ts já barra tudo que não é
  // rota pública, e esta não está na lista.
  try {
    const res = await query('SELECT avatar_url FROM public.profiles WHERE id = $1', [id]);
    const dataUrl: string | null = res.rows[0]?.avatar_url || null;
    if (!dataUrl) {
      return NextResponse.json({ error: 'Sem foto.' }, { status: 404 });
    }

    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      // Valor que não é `data:` URL — provavelmente lixo gravado por algum
      // caminho antigo. Melhor 404 (a tela cai no fallback com a inicial do
      // nome) do que devolver conteúdo quebrado como se fosse imagem.
      console.error('[avatar] avatar_url do perfil %s não é uma data: URL', id);
      return NextResponse.json({ error: 'Foto inválida.' }, { status: 404 });
    }

    const [, mime, isBase64, payload] = match;
    const buffer = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');

    // ETag em cima do conteúdo: trocar a foto invalida o cache na hora, sem
    // precisar de "cache busting" na URL (que a listagem teria que saber
    // montar). max-age curto + revalidação por ETag: a segunda visita responde
    // 304 sem corpo, que é o que interessa aqui.
    const etag = `"${createHash('sha1').update(buffer).digest('hex')}"`;

    // O 304 é feito à mão porque a resposta é montada aqui: sem isso o
    // navegador revalidaria a cada 5 minutos e receberia a imagem inteira de
    // volta, desperdiçando exatamente o que esta rota veio economizar.
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
    console.error('[avatar] Falha ao servir foto do perfil:', error);
    return NextResponse.json({ error: 'Erro ao carregar a foto.' }, { status: 500 });
  }
}
