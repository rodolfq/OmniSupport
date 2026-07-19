-- Quem está com qual conversa aberta agora (SSE ativo), persistido no banco
-- em vez de memória do processo. Necessário para a supressão "não notificar
-- quem já está vendo a conversa" (igual WhatsApp) funcionar de verdade em
-- implantações serverless (ex.: Vercel), onde a conexão SSE e o disparo do
-- push podem cair em instâncias isoladas que não compartilham memória.
CREATE TABLE IF NOT EXISTS public.chat_session_viewers (
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_viewers_last_seen ON public.chat_session_viewers(last_seen_at);
