import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth-utils';
import { INTEGRATION_SCOPES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS, type IntegrationScope } from '@/lib/integration-constants';

// Autenticação por API key para a integração externa em /api/integrations/v1/*.
// Independente do login por cookie JWT (lib/jwt.ts) usado pelo frontend interno.
// Toda resposta das rotas v1 deve ser construída com integrationJson/integrationError
// (ou authErrorResponse, antes de auth resolver) para manter o formato de erro
// { error, code } e os headers de rate limit consistentes em toda a API.
//
// Este módulo importa lib/db.ts (driver 'pg', Node-only) — nunca importar
// daqui a partir de um client component. Constantes/tipos client-safe
// (escopos, limite de rate limit) vivem em lib/integration-constants.ts e
// são só reexportados abaixo para não quebrar quem já importa daqui.

export { INTEGRATION_SCOPES, RATE_LIMIT_MAX_REQUESTS, type IntegrationScope };

export type IntegrationErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_SCOPE'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

const KEY_PREFIX_LENGTH = 12;

// Limitador simples em memória (por processo). Não sobrevive a restart nem
// é compartilhado entre múltiplas instâncias — suficiente para conter abuso
// básico na v1; se o volume crescer, trocar por um limitador com Redis.
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>();

export function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const rawKey = `ssx_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = rawKey.slice(0, KEY_PREFIX_LENGTH);
  const hash = hashPassword(rawKey);
  return { rawKey, prefix, hash };
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

export interface AuthenticatedIntegration {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: RateLimitInfo;
}

export interface IntegrationAuthError {
  error: string;
  code: IntegrationErrorCode;
  status: number;
  rateLimit?: RateLimitInfo;
}

function extractKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  const apiKeyHeader = request.headers.get('x-api-key');
  return apiKeyHeader?.trim() || null;
}

function checkRateLimit(keyId: string): { allowed: boolean; info: RateLimitInfo } {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(keyId, { count: 1, windowStart: now });
    return { allowed: true, info: { limit: RATE_LIMIT_MAX_REQUESTS, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS } };
  }
  bucket.count++;
  return {
    allowed: bucket.count <= RATE_LIMIT_MAX_REQUESTS,
    info: { limit: RATE_LIMIT_MAX_REQUESTS, remaining: RATE_LIMIT_MAX_REQUESTS - bucket.count, resetAt: bucket.windowStart + RATE_LIMIT_WINDOW_MS },
  };
}

export async function authenticateApiKey(
  request: Request
): Promise<AuthenticatedIntegration | IntegrationAuthError> {
  const rawKey = extractKeyFromRequest(request);
  if (!rawKey) {
    return { error: 'Chave de API ausente. Envie o header "Authorization: Bearer <chave>".', code: 'UNAUTHORIZED', status: 401 };
  }

  const prefix = rawKey.slice(0, KEY_PREFIX_LENGTH);
  const result = await query(
    `SELECT id, name, key_hash, scopes, is_active FROM public.integration_api_keys WHERE key_prefix = $1`,
    [prefix]
  );

  const candidate = result.rows.find((row: any) => verifyPassword(rawKey, row.key_hash));
  if (!candidate || !candidate.is_active) {
    return { error: 'Chave de API inválida ou revogada.', code: 'UNAUTHORIZED', status: 401 };
  }

  const { allowed, info } = checkRateLimit(candidate.id);
  if (!allowed) {
    return { error: 'Limite de requisições excedido. Tente novamente em instantes.', code: 'RATE_LIMITED', status: 429, rateLimit: info };
  }

  query('UPDATE public.integration_api_keys SET last_used_at = NOW() WHERE id = $1', [candidate.id]).catch(err => {
    console.error('[integration-auth] Falha ao atualizar last_used_at:', err);
  });

  return { id: candidate.id, name: candidate.name, scopes: candidate.scopes || [], rateLimit: info };
}

export function isAuthError(
  auth: AuthenticatedIntegration | IntegrationAuthError
): auth is IntegrationAuthError {
  return 'error' in auth;
}

function applyRateLimitHeaders(res: NextResponse, info: RateLimitInfo): NextResponse {
  res.headers.set('X-RateLimit-Limit', String(info.limit));
  res.headers.set('X-RateLimit-Remaining', String(Math.max(0, info.remaining)));
  res.headers.set('X-RateLimit-Reset', String(Math.ceil(info.resetAt / 1000)));
  return res;
}

// Resposta para falha de autenticação/rate-limit (antes de termos um AuthenticatedIntegration).
export function authErrorResponse(err: IntegrationAuthError): NextResponse {
  const res = NextResponse.json({ error: err.error, code: err.code }, { status: err.status });
  return err.rateLimit ? applyRateLimitHeaders(res, err.rateLimit) : res;
}

// Resposta de sucesso/erro de negócio já autenticada — sempre inclui os
// headers X-RateLimit-* para o consumidor acompanhar a cota da chave.
export function integrationJson(auth: AuthenticatedIntegration, body: any, status: number = 200): NextResponse {
  return applyRateLimitHeaders(NextResponse.json(body, { status }), auth.rateLimit);
}

export function integrationError(
  auth: AuthenticatedIntegration,
  code: IntegrationErrorCode,
  message: string,
  status: number
): NextResponse {
  return integrationJson(auth, { error: message, code }, status);
}

export function requireScope(auth: AuthenticatedIntegration, scope: IntegrationScope): NextResponse | null {
  if (!auth.scopes.includes(scope)) {
    return integrationError(auth, 'FORBIDDEN_SCOPE', `Esta chave de API não tem o escopo necessário: ${scope}`, 403);
  }
  return null;
}
