-- Etapas de treinamento por empresa (pedido do usuário, 2026-10-28).
-- Cadastradas e atualizadas por um sistema externo via API de integração
-- (app/api/integrations/v1/training-stages) — o analista só visualiza, como
-- uma lista fixa, dentro do SSX Desk. Independente de companies.is_in_training:
-- a trilha pode existir e ser consultada mesmo que o indicador mude depois.
CREATE TABLE IF NOT EXISTS public.training_stages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Não concluído' CHECK (status IN ('Em andamento', 'Concluído', 'Não concluído')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_training_stages_company_id ON public.training_stages(company_id);
