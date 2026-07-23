-- Suporte a leitura persistida (3o estado de entrega), reações rápidas, e
-- histórico de edição/exclusão no chat com cliente (public.chat_messages).
-- Exclusão é soft-delete (deleted_at) — o texto original NUNCA é apagado
-- fisicamente, só escondido da visualização normal, pra manter histórico
-- auditável (ver chat_message_edits abaixo pra edição).
-- delivered_by: cliente do destinatário sincronizou a lista de sessões (a
-- mensagem "chegou"). read_by: destinatário teve ESSA conversa
-- especificamente aberta — subconjunto de delivered_by.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS read_by UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivered_by UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Uma linha por edição, com o texto ANTERIOR à mudança — dá pra reconstruir
-- o histórico completo de versões de uma mensagem (chat_messages.text
-- sempre guarda a versão atual).
CREATE TABLE IF NOT EXISTS public.chat_message_edits (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  previous_text TEXT,
  edited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_message_edits_message_id ON public.chat_message_edits(message_id);

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message_id ON public.chat_message_reactions(message_id);
