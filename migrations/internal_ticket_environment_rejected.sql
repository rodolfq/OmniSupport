-- Ambiente reprovado (marcação manual, sem pontuação), ao lado de Reprovação de QA.
-- Indica que a entrega foi reprovada no ambiente (homologação/produção), não só no teste de QA.
--
-- Aditiva e idempotente. Para reverter: ALTER TABLE public.internal_tickets DROP COLUMN IF EXISTS environment_rejected;

ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS environment_rejected BOOLEAN NOT NULL DEFAULT false;
