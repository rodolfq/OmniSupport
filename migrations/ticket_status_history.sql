-- Histórico de status de cada chamado (uma linha por mudança), para medir reabertura, prazo de
-- conclusão e chamado que nasce resolvido. Antes não existia: o log de auditoria tinha poucos
-- registros de alteração de chamado e não dava para reconstruir a sequência de status.
--
-- O gatilho grava qualquer mudança de status, venha de onde vier (tela, API, SQL). Não há
-- backfill: chamados anteriores à migração não têm histórico, e os indicadores que dependem
-- dele marcam esses casos como "sem histórico" em vez de inventar uma data.
--
-- Aditiva e idempotente. Para reverter: DROP TABLE public.ticket_status_history CASCADE;
-- e DROP FUNCTION public.track_ticket_status();

CREATE TABLE IF NOT EXISTS public.ticket_status_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  from_status TEXT,          -- NULL = criação do chamado (from_status vazio quer dizer "nasceu com este status")
  to_status TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket ON public.ticket_status_history(ticket_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_changed_at ON public.ticket_status_history(changed_at);

CREATE OR REPLACE FUNCTION public.track_ticket_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ticket_status_history (ticket_id, from_status, to_status, changed_at, changed_by)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_at, NEW.created_by);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.ticket_status_history (ticket_id, from_status, to_status, changed_at, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, now(), NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_status_history ON public.tickets;
CREATE TRIGGER trg_tickets_status_history
  AFTER INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.track_ticket_status();
