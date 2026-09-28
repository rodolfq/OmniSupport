-- Aviso de entrega/falha do Pyvon (2026-09-28).
--
-- Por que existe: o Pyvon aceita o envio na hora (bot-template/bot-response
-- respondem 2xx) e a Meta só avisa a falha DEPOIS, de forma assíncrona — e o
-- contrato antigo não previa nenhum aviso pro nosso lado. Caso real: chamado
-- #3394, dois templates aceitos ("sent" no nosso log) que nunca chegaram ao
-- cliente. Agora o Pyvon chama POST /api/whatsapp/pyvon-status (autenticado por
-- X-Pyvon-Secret, como o webhook de entrada) e a falha é tratada aqui.
--
-- pyvon_delivery_events: tudo o que o Pyvon mandar nessa rota, cru (raw) e já
-- interpretado. Serve de auditoria e de prova quando o payload real for
-- diferente do combinado. `handled` diz o que foi atualizado (NULL = nenhuma
-- mensagem nossa correspondia ao message_id).
--
-- pyvon_message_id em automation_dispatches e pyvon_pending_outbound: é o elo
-- entre o aviso do Pyvon e o que enviamos — antes o message_id devolvido pelo
-- bot-template/bot-response não era guardado nesses dois lugares.
--
-- Aditiva: cria uma tabela e duas colunas anuláveis; nada existente muda.

CREATE TABLE IF NOT EXISTS public.pyvon_delivery_events (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  instance_id TEXT,
  pyvon_message_id TEXT,
  cadastro_id INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  handled TEXT,
  raw JSONB NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pyvon_delivery_events_message ON public.pyvon_delivery_events (pyvon_message_id);
CREATE INDEX IF NOT EXISTS idx_pyvon_delivery_events_received ON public.pyvon_delivery_events (received_at DESC);

ALTER TABLE public.automation_dispatches ADD COLUMN IF NOT EXISTS pyvon_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_automation_dispatches_pyvon_message
  ON public.automation_dispatches (pyvon_message_id) WHERE pyvon_message_id IS NOT NULL;

ALTER TABLE public.pyvon_pending_outbound ADD COLUMN IF NOT EXISTS pyvon_message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pyvon_pending_outbound_message
  ON public.pyvon_pending_outbound (pyvon_message_id) WHERE pyvon_message_id IS NOT NULL;
