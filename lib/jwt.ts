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

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const base64 = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key-change-me-in-production-1234567';

async function getSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(JWT_SECRET),
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
    const signature = base64UrlToArrayBuffer(signatureBase64);
    
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(tokenString)
    );
    
    if (!isValid) return null;
    
    const payloadJson = new TextDecoder().decode(base64UrlToArrayBuffer(payloadBase64));
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
