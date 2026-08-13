const encoder = new TextEncoder();

function arrayBufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Devolve Uint8Array (não o ArrayBuffer "cru" de .buffer) de propósito: no
// sandbox de Edge Runtime do Next em modo dev, um ArrayBuffer montado à mão
// aqui às vezes falha o checar de tipo do WebCrypto do próprio Node
// (`crypto.subtle.verify`/`TextDecoder.decode` recusando com "3rd argument
// is not instance of ArrayBuffer..." mesmo sendo um de verdade — resíduo de
// contexto/realm do sandbox). Uint8Array é um BufferSource válido pros dois
// e não sofre esse problema (é o que TextEncoder().encode() já devolve, e
// signJWT nunca teve esse erro por causa disso).
function base64UrlToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Sem fallback, de propósito. Havia uma chave fixa escrita aqui para o caso de
// JWT_SECRET não estar definida — e como este repositório é versionado, essa
// chave é pública: com ela dá para ASSINAR um token válido para qualquer
// usuário, inclusive Administrador, sem saber senha nenhuma. O middleware só
// confere assinatura e validade, então um token forjado passa direto.
//
// O agravante era o silêncio: faltando a variável, o sistema continuava
// funcionando normalmente e ninguém percebia que a sessão inteira estava
// protegida por uma chave publicada. Agora falta de variável derruba o boot com
// mensagem clara, que é o comportamento certo para uma chave de assinatura.
// A checagem é feita aqui dentro, e não no topo do arquivo, porque `next build`
// não recebe JWT_SECRET (ela não é build arg — só as NEXT_PUBLIC_* são): lançar
// no carregamento do módulo quebraria a compilação da imagem. Aqui a falha
// acontece na primeira operação de sessão, que é quando a chave importa.
function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_SECRET não está definida. Ela assina o cookie de sessão — sem ela não há login seguro. ' +
      'Gere uma chave aleatória longa (ex.: openssl rand -hex 32) e defina no .env; ' +
      'no container, ela chega pelo env_file do docker-compose.yml.'
    );
  }
  return secret;
}

async function getSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(requireSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJWT(payload: Record<string, any>, expiresInSeconds: number = 86400): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };
  
  const headerBase64 = arrayBufferToBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadBase64 = arrayBufferToBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  
  const tokenString = `${headerBase64}.${payloadBase64}`;
  const key = await getSigningKey();
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(tokenString)
  );
  
  const signatureBase64 = arrayBufferToBase64Url(signature);
  return `${tokenString}.${signatureBase64}`;
}

export async function verifyJWT(token: string): Promise<Record<string, any> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerBase64, payloadBase64, signatureBase64] = parts;
    const tokenString = `${headerBase64}.${payloadBase64}`;
    
    const key = await getSigningKey();
    const signature = base64UrlToBytes(signatureBase64);

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(tokenString)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadBase64));
    const payload = JSON.parse(payloadJson);
    
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expirado
    }
    
    return payload;
  } catch (error) {
    console.error('Erro ao verificar JWT:', error);
    return null;
  }
}
