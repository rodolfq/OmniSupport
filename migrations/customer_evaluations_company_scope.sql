-- Reescopa o "perfil interno" (migrations/customer_evaluations.sql) da pessoa
-- (profiles) pra empresa (companies) — o cadastro certo pra essa informação
-- é o da empresa como um todo, não de um funcionário/contato específico.
--
-- A tabela customer_evaluations é recriada (em vez de só trocar a coluna)
-- porque não há como "converter" um customer_id (pessoa) num company_id
-- (empresa) de forma confiável, e a feature acabou de ser lançada, sem uso
-- real registrado ainda.

DROP TABLE IF EXISTS public.customer_evaluations;

CREATE TABLE public.customer_evaluations (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  analyst_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  chat_session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  knowledge_score SMALLINT NOT NULL CHECK (knowledge_score BETWEEN 1 AND 5),
  autonomy_score SMALLINT NOT NULL CHECK (autonomy_score BETWEEN 1 AND 5),
  learning_score SMALLINT NOT NULL CHECK (learning_score BETWEEN 1 AND 5),
  engagement_score SMALLINT NOT NULL CHECK (engagement_score BETWEEN 1 AND 5),
  organization_score SMALLINT NOT NULL CHECK (organization_score BETWEEN 1 AND 5),
  communication_score SMALLINT NOT NULL CHECK (communication_score BETWEEN 1 AND 5),
  -- 'technical' | 'beginner' | 'challenging' — classificação opcional, não
  -- obrigatória em toda avaliação.
  profile_tag TEXT CHECK (profile_tag IN ('technical', 'beginner', 'challenging')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_evaluations_company_id ON public.customer_evaluations(company_id);
CREATE INDEX IF NOT EXISTS idx_customer_evaluations_created_at ON public.customer_evaluations(created_at DESC);

ALTER TABLE public.profiles DROP COLUMN IF EXISTS radar_sync;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS radar_sync BOOLEAN NOT NULL DEFAULT false;
