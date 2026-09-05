-- Canal WhatsApp via Pyvon (provider = 'pyvon' em whatsapp_instances, mesmo
-- padrão de 'baileys'/'meta') — ver lib/services/pyvon-service.ts.

-- Id do contato no Pyvon ("cadastro_id" — a chave pra responder e iniciar
-- template). Preenchido/atualizado a cada mensagem recebida via webhook.
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS pyvon_cadastro_id INTEGER;

-- Id da mensagem no Pyvon ("message_id") — chave de idempotência: o mesmo
-- evento pode chegar duas vezes em retentativa de rede (documentado pelo
-- próprio Pyvon). Índice único parcial: a maioria das linhas (outros canais)
-- fica NULL, e Postgres permite múltiplos NULLs num índice único.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS pyvon_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_pyvon_message_id
  ON public.chat_messages(pyvon_message_id) WHERE pyvon_message_id IS NOT NULL;

-- 'prod' (api.pyvon.io) ou 'dev' (api-dev.pyvon.io) — decide a Base URL sem
-- precisar de duas colunas ou hardcode no serviço.
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS pyvon_environment TEXT;
