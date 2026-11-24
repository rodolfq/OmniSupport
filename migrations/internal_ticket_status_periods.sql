-- Tempo por status e sub-status do ticket interno (2026-11-23, pedido do usuário: KPI de
-- quanto tempo o ticket passou em cada status/sub-status, ex.: "3 dias em Em Espera ›
-- Aguardando Suporte"), visível no ticket e no relatório de Tickets Internos.
--
-- Um registro por TRECHO: o ticket ficou em (status, sub-status, fila) de started_at até
-- ended_at (NULL = trecho atual). Quem grava é um GATILHO em internal_tickets, então vale
-- para todo caminho que muda status/sub-status/fila — tela, edição em massa, Kanban, API
-- de integração, fechamento junto com o chamado — sem depender de cada rota lembrar.
-- Trocar de FILA também abre trecho novo: o relatório agrupa o tempo pela fila em que o
-- ticket estava naquele trecho, não pela fila de hoje.
--
-- Tickets que já existem: não há histórico confiável do passado (só ~16 tickets têm a
-- mensagem "Status alterado" e o sub-status nunca foi registrado). Decisão do usuário:
-- o status atual passa a contar a partir da aplicação desta migration, com
-- since_deploy = true. Esses trechos aparecem no ticket como "desde a implantação" e
-- ficam FORA das médias do relatório (o tempo real foi maior que o medido).
--
-- Tempo útil: calculado na leitura com ticket_business_minutes (08h–18h, seg a sex,
-- horário de Brasília — migrations/ticket_business_minutes.sql). Aplicar aquela antes.
--
-- Aditiva e idempotente. Para reverter:
--   DROP TRIGGER IF EXISTS trg_internal_tickets_status_periods ON public.internal_tickets;
--   DROP FUNCTION IF EXISTS public.track_internal_ticket_status_period();
--   DROP TABLE IF EXISTS public.internal_ticket_status_periods;

CREATE TABLE IF NOT EXISTS public.internal_ticket_status_periods (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  internal_ticket_id TEXT NOT NULL REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  sub_status TEXT,
  queue_id UUID REFERENCES public.internal_ticket_queues(id) ON DELETE SET NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  since_deploy BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_it_status_periods_ticket
  ON public.internal_ticket_status_periods(internal_ticket_id, started_at);
CREATE INDEX IF NOT EXISTS idx_it_status_periods_ended
  ON public.internal_ticket_status_periods(ended_at);
-- No máximo UM trecho aberto por ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_it_status_periods_open
  ON public.internal_ticket_status_periods(internal_ticket_id) WHERE ended_at IS NULL;

CREATE OR REPLACE FUNCTION public.track_internal_ticket_status_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMP WITH TIME ZONE := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.internal_ticket_status_periods (internal_ticket_id, status, sub_status, queue_id, started_at)
    VALUES (NEW.id, COALESCE(NEW.status, 'Novo'), NULLIF(NEW.sub_status, ''), NEW.internal_queue_id, NEW.created_at);
  ELSIF COALESCE(NEW.status, '') IS DISTINCT FROM COALESCE(OLD.status, '')
     OR NULLIF(NEW.sub_status, '') IS DISTINCT FROM NULLIF(OLD.sub_status, '')
     OR NEW.internal_queue_id IS DISTINCT FROM OLD.internal_queue_id THEN
    UPDATE public.internal_ticket_status_periods
       SET ended_at = GREATEST(v_now, started_at)
     WHERE internal_ticket_id = NEW.id AND ended_at IS NULL;
    INSERT INTO public.internal_ticket_status_periods (internal_ticket_id, status, sub_status, queue_id, started_at)
    VALUES (NEW.id, COALESCE(NEW.status, 'Novo'), NULLIF(NEW.sub_status, ''), NEW.internal_queue_id, v_now);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_internal_tickets_status_periods ON public.internal_tickets;
CREATE TRIGGER trg_internal_tickets_status_periods
  AFTER INSERT OR UPDATE OF status, sub_status, internal_queue_id ON public.internal_tickets
  FOR EACH ROW EXECUTE FUNCTION public.track_internal_ticket_status_period();

-- Tickets já existentes: status atual contando a partir de agora.
INSERT INTO public.internal_ticket_status_periods (internal_ticket_id, status, sub_status, queue_id, started_at, since_deploy)
SELECT i.id, COALESCE(i.status, 'Novo'), NULLIF(i.sub_status, ''), i.internal_queue_id, now(), true
  FROM public.internal_tickets i
 WHERE NOT EXISTS (SELECT 1 FROM public.internal_ticket_status_periods p WHERE p.internal_ticket_id = i.id);
