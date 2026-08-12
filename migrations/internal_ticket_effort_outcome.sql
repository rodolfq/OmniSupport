-- Corrige o alvo da classificação de solução: os campos Esforço e Desfecho
-- pertencem ao TICKET INTERNO (trabalho do time de desenvolvimento), não ao
-- chamado de cliente.
--
-- A migration anterior (ticket_effort_outcome.sql) colocou as colunas em
-- public.tickets. Ela não é editada — a regra do projeto é criar uma nova em
-- vez de mexer em migration já aplicada —, então aqui as colunas são movidas.
--
-- A remoção em tickets é segura: foi verificado antes de aplicar que nenhuma
-- linha tinha effort_id ou outcome_id preenchido (os campos existiram por
-- poucas horas e nunca foram usados). As duas tabelas de configuração
-- (config_effort_levels / config_outcomes) continuam como estão — são listas
-- genéricas de classificação e não dependem de quem as referencia.

ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS effort_id UUID REFERENCES public.config_effort_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome_id UUID REFERENCES public.config_outcomes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_internal_tickets_effort_id ON public.internal_tickets(effort_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_outcome_id ON public.internal_tickets(outcome_id);

DROP INDEX IF EXISTS public.idx_tickets_effort_id;
DROP INDEX IF EXISTS public.idx_tickets_outcome_id;

ALTER TABLE public.tickets
  DROP COLUMN IF EXISTS effort_id,
  DROP COLUMN IF EXISTS outcome_id;
