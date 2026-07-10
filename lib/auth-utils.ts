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
  
  // Support plaintext password for seeded users/migration if needed, but best is hashed
  if (!hashed.startsWith('pbkdf2$')) {
    return password === hashed;
  }
  
  const parts = hashed.split('$');
  if (parts.length !== 4) return false;
  
  const [, iterationsStr, salt, hash] = parts;
  const iterations = parseInt(iterationsStr, 10);
  const testHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}
