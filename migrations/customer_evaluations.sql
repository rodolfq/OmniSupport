-- Perfil interno do cliente: informações que só o time vê (nunca o próprio
-- cliente/funcionário), usadas pra facilitar o atendimento e futuras
-- integrações. Não confundir com a pesquisa de satisfação existente
-- (config_survey_settings/chat_histories.rating) — ali é o cliente avaliando
-- o atendimento; aqui é o analista avaliando o cliente.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS radar_sync BOOLEAN NOT NULL DEFAULT false;

-- Cada linha é uma avaliação pontual (ex: feita ao encerrar um chat) — o
-- "cadastro" do cliente mostra a média dessas avaliações, não um valor único
-- editável direto, e o relatório lista o histórico completo.
CREATE TABLE IF NOT EXISTS public.customer_evaluations (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  customer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_customer_evaluations_customer_id ON public.customer_evaluations(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_evaluations_created_at ON public.customer_evaluations(created_at DESC);
