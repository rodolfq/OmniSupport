-- Web Push: assinaturas de notificação push por usuário/dispositivo (PWA
-- instalado), e preferências de notificação espelhadas do cliente (hoje só
-- existiam em localStorage) para o disparo no servidor poder respeitá-las.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_ticket_new BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_ticket_assigned BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_ticket_update BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_ticket_closed BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_chat_new BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_chat_message BOOLEAN DEFAULT true;
