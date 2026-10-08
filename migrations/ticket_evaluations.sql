-- Avaliação do chamado pelo cliente: Bom/Ruim + comentário opcional, depois que
-- o chamado é concluído. Pedido do usuário (2026-10-07):
--   - Cliente/Funcionário avalia o CHAMADO em si (não a conversa de chat — essa
--     já tem sua própria pesquisa, ver config_survey_settings/chat_sessions).
--   - Uma avaliação por chamado (não por usuário): o primeiro a avaliar "fecha"
--     o chamado pra avaliação, ele some da lista de pendentes pra todo mundo
--     da empresa.
--   - Somente-inserção: não pode ser editada nem excluída (nem pela aplicação,
--     nem por engano via SQL direto) — mesmo padrão rígido de
--     migrations/user_creation_log.sql.
--
-- Elegibilidade (checada na aplicação, não aqui): chamado com status = 'Concluído'
-- (TicketStatus.CLOSED). "Mesclado" fica de fora de propósito — é o chamado
-- absorvido numa mesclagem, não faz sentido avaliar.
--
-- Aditiva e idempotente. Compatível com Postgres 12 (produção): sem
-- gen_random_uuid() e com EXECUTE PROCEDURE.

CREATE TABLE IF NOT EXISTS public.ticket_evaluations (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  ticket_id TEXT NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_evaluations_created_at ON public.ticket_evaluations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_evaluations_customer ON public.ticket_evaluations (customer_id);

-- Somente-inserção: nenhuma avaliação gravada pode ser alterada ou apagada.
CREATE OR REPLACE FUNCTION public.fn_ticket_evaluations_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_evaluations é somente-inserção: % não é permitido', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_evaluations_no_change ON public.ticket_evaluations;
CREATE TRIGGER trg_ticket_evaluations_no_change
  BEFORE UPDATE OR DELETE ON public.ticket_evaluations
  FOR EACH ROW EXECUTE PROCEDURE public.fn_ticket_evaluations_immutable();

DROP TRIGGER IF EXISTS trg_ticket_evaluations_no_truncate ON public.ticket_evaluations;
CREATE TRIGGER trg_ticket_evaluations_no_truncate
  BEFORE TRUNCATE ON public.ticket_evaluations
  FOR EACH STATEMENT EXECUTE PROCEDURE public.fn_ticket_evaluations_immutable();
