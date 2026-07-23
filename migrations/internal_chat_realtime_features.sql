-- Suporte a leitura persistida (3o estado de entrega) e reações rápidas no
-- Chat Interno (public.internal_chat_messages). Antes, "lido" era só
-- client-side (nunca persistido nem propagado a outros usuários) — ver
-- investigação em app/(portal)/chat-internal/page.tsx.
-- delivered_by: cliente do destinatário sincronizou a lista de conversas (a
-- mensagem "chegou"), marcado em internal-chats GET (lista de salas).
-- read_by: destinatário abriu ESSA sala especificamente, marcado em
-- internal-messages GET — por isso é sempre um subconjunto (ou igual) de
-- delivered_by, nunca o contrário.
ALTER TABLE public.internal_chat_messages
  ADD COLUMN IF NOT EXISTS read_by UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivered_by UUID[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.internal_chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  message_id UUID NOT NULL REFERENCES public.internal_chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  -- 1 reação por pessoa por mensagem (igual WhatsApp/Telegram): escolher um
  -- emoji novo troca o anterior em vez de acumular.
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_internal_chat_message_reactions_message_id ON public.internal_chat_message_reactions(message_id);
