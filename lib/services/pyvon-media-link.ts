import crypto from 'crypto';

/**
 * Link público de curta duração pra um anexo nosso — único jeito de o Pyvon
 * baixar mídia que a gente encaminha (`bot-response.image_url`/`document_url`
 * exige URL pública; `/api/files/...` exige sessão de propósito, é anexo de
 * atendimento). Token HMAC assinado com JWT_SECRET, embutindo caminho +
 * validade — não fica reaproveitável depois de expirar, e nunca expõe o
 * anexo de forma permanente (ver app/api/whatsapp/pyvon/media-proxy/route.ts).
 */

const TOKEN_TTL_MS = 15 * 60 * 1000; // Pyvon baixa na hora do bot-response; 15min é folga, não permanência

function secret(): string {
  return process.env.JWT_SECRET || '';
}

function sign(relativePath: string, expires: number): string {
  return crypto.createHmac('sha256', secret()).update(`${relativePath}:${expires}`).digest('hex');
}

/** Retorna null quando não há segredo ou URL pública configurada — quem chama trata como "não dá pra encaminhar mídia agora". */
export function signPyvonMediaUrl(relativePath: string): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl || !secret()) return null;
  const expires = Date.now() + TOKEN_TTL_MS;
  const sig = sign(relativePath, expires);
  const qs = new URLSearchParams({ path: relativePath, expires: String(expires), sig });
  return `${baseUrl}/api/whatsapp/pyvon/media-proxy?${qs.toString()}`;
}

export function verifyPyvonMediaToken(relativePath: string, expiresParam: string, sig: string): boolean {
  const expires = Number(expiresParam);
  if (!relativePath || !expires || !sig || Date.now() > expires) return false;

  const expected = sign(relativePath, expires);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
