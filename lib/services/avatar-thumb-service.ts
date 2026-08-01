import sharp from 'sharp';

// Miniatura só pra exibir em listas com muitos avatares ao mesmo tempo (linha
// de Chamados, linha de Tickets Internos) — não substitui avatar_url, que
// continua servindo telas que mostram a foto maior (ex.: seletor de membros
// de Fila). 48px porque o maior uso hoje é ~24px em tela retina (2x).
const THUMB_DIM = 48;
const THUMB_QUALITY = 60;

function parseDataUrl(dataUrl: string): Buffer | null {
  const match = /^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

// Aceita tanto `data:` URL (padrão usado hoje pra avatar_url) quanto http(s)
// — falha em gerar a miniatura não deve derrubar o fluxo que chamou (login,
// sync do Bitrix24, etc.), só retorna null e quem chamou decide o que fazer.
export async function generateAvatarThumb(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl) return null;

  try {
    let buffer: Buffer;
    if (avatarUrl.startsWith('data:')) {
      const parsed = parseDataUrl(avatarUrl);
      if (!parsed) return null;
      buffer = parsed;
    } else if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
      const res = await fetch(avatarUrl);
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    } else {
      return null;
    }

    const resized = await sharp(buffer)
      .resize(THUMB_DIM, THUMB_DIM, { fit: 'cover' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();

    return `data:image/jpeg;base64,${resized.toString('base64')}`;
  } catch (err) {
    console.error('Error generating avatar thumb:', err);
    return null;
  }
}
