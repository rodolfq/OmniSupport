import crypto from 'crypto';

/**
 * Hash password using PBKDF2
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 10000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

/**
 * Verify password against hashed password
 */
export function verifyPassword(password: string, hashed: string): boolean {
  if (!hashed) return false;

  // Só hash. A versão anterior caía num `password === hashed` quando o valor
  // guardado não tinha o prefixo pbkdf2$ — sobra da migração do Supabase. Isso
  // fazia de qualquer conteúdo gravado na coluna uma senha válida em texto
  // puro, inclusive um marcador de "conta sem senha". Conferido no banco de
  // produção antes de remover: nenhum perfil dependia desse caminho.
  if (!hashed.startsWith('pbkdf2$')) return false;

  const parts = hashed.split('$');
  if (parts.length !== 4) return false;

  const [, iterationsStr, salt, hash] = parts;
  const iterations = parseInt(iterationsStr, 10);

  // Hash malformado (marcador de conta sem senha, registro truncado) devolve
  // "senha errada" em vez de derrubar o login com 500: sem estas checagens,
  // pbkdf2Sync com iterações NaN e timingSafeEqual com tamanhos diferentes
  // lançam exceção.
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  if (!/^[0-9a-f]+$/i.test(hash) || hash.length % 2 !== 0) return false;

  const expected = Buffer.from(hash, 'hex');
  const testHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512');
  if (expected.length !== testHash.length) return false;

  return crypto.timingSafeEqual(expected, testHash);
}
