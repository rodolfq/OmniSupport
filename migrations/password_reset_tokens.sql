-- Tokens de "Esqueci minha senha" (self-service, via e-mail) — token de uso
-- único e curta duração, nunca gravado em texto puro (token_hash = SHA-256 do
-- token enviado no link do e-mail). Diferente de profiles.password (PBKDF2,
-- pensado pra resistir a ataque offline por décadas): aqui é um segredo de
-- 1h de vida, SHA-256 já é rápido o bastante e suficiente.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- NULL = ainda válido (se dentro de expires_at). Marcado ao ser consumido
  -- OU quando um pedido de reset mais novo invalida os anteriores do mesmo
  -- perfil (ver lib/services/password-reset-service.ts).
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_profile ON public.password_reset_tokens(profile_id);
