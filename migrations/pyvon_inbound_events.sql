-- Mensagens recebidas do Pyvon, guardadas CRUAS antes de qualquer processamento.
--
-- Por que existe (2026-10-06): o webhook respondia 200 e processava em segundo
-- plano sem guardar nada. Se o processamento falhasse (ex.: erro de banco ao
-- abrir a conversa), a mensagem do cliente sumia — o Pyvon não reenvia.
--
-- Agora cada evento entra aqui primeiro (status 'pending') e só vira 'processed'
-- depois que a conversa e a mensagem foram gravadas. O que falhar é retentado por
-- lib/services/pyvon-inbound-events.ts; depois de 10 tentativas vira 'dead' e
-- fica aqui para conferência manual (payload completo, nada se perde).
--
-- Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.pyvon_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  instance_id TEXT,
  pyvon_message_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed', 'ignored', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pyvon_inbound_events_status
  ON public.pyvon_inbound_events (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_pyvon_inbound_events_message
  ON public.pyvon_inbound_events (pyvon_message_id);
