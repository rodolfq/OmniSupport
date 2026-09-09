import crypto from 'crypto';
import { query } from '@/lib/db';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface RequestedReset {
  profileId: string;
  name: string;
  email: string;
  token: string;
}

// Devolve null quando o e-mail não corresponde a nenhum perfil (ou o perfil
// está desativado) — quem chama NUNCA deve usar isso pra responder diferente
// ao usuário (enumeration-safe, mesmo princípio do login em
// app/api/auth/login/route.ts: mensagem idêntica exista ou não a conta).
export async function requestPasswordReset(email: string): Promise<RequestedReset | null> {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return null;

  // IS DISTINCT FROM em vez de <>: is_active é opcional (default true em
  // schema_postgres.sql, mas pode vir NULL de linha antiga) — `<> false`
  // descartaria silenciosamente todo perfil com is_active NULL.
  const profileRes = await query(
    `SELECT id, name, email FROM public.profiles WHERE lower(email) = $1 AND is_active IS DISTINCT FROM false`,
    [normalized]
  );
  const profile = profileRes.rows[0];
  if (!profile) return null;

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalida qualquer link anterior ainda válido do mesmo perfil — evita um
  // link antigo (de um pedido anterior, ainda dentro da 1h) continuar
  // funcionando depois de um pedido mais novo, o que confundiria "qual
  // e-mail é o certo pra usar" se a pessoa pediu reset mais de uma vez.
  await query(
    `UPDATE public.password_reset_tokens SET used_at = now() WHERE profile_id = $1 AND used_at IS NULL`,
    [profile.id]
  );
  await query(
    `INSERT INTO public.password_reset_tokens (profile_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [profile.id, tokenHash, expiresAt]
  );

  return { profileId: profile.id, name: profile.name, email: profile.email, token };
}

export interface ConsumedReset {
  profileId: string;
}

// Consome o token (marca used_at, atômico via UPDATE...RETURNING — impede
// dois envios simultâneos do mesmo link válido) e devolve o dono, só se
// ainda válido (não usado, não expirado). Token inválido/expirado/já usado
// devolve null — resposta genérica pro client, sem detalhar o motivo (não dá
// pra saber se o link já foi usado por outra pessoa vs. simplesmente não existe).
export async function consumePasswordResetToken(token: string): Promise<ConsumedReset | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const res = await query(
    `UPDATE public.password_reset_tokens
        SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING profile_id`,
    [tokenHash]
  );
  const row = res.rows[0];
  return row ? { profileId: row.profile_id } : null;
}
