-- Preferências de notificação por e-mail, por usuário (2026-11-25, pedido do
-- usuário). Mapa { chave: true|false } — ver lib/email-notification-prefs.ts.
-- Chave ausente = LIGADA: todo mundo continua recebendo tudo, como antes, até
-- desligar algo em Configurações > Notificações. Idempotente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
