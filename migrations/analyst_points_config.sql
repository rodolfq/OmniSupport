-- Configuração do ranking de analistas por pontos (tela "Configurar pontos do ranking").
--
-- Uma linha só (id = 1), com os pesos em jsonb. O ranking lê esta linha a cada consulta,
-- então uma mudança vale em tempo real para todos, sem deploy.
--
-- Aditiva e idempotente. Para reverter: DROP TABLE public.analyst_points_config;
-- (o ranking volta aos valores padrão do código, porque o serviço trata a tabela ausente).

CREATE TABLE IF NOT EXISTS public.analyst_points_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  config JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Valores padrão do Desempenho SSX. Não sobrescreve uma configuração já salva.
INSERT INTO public.analyst_points_config (id, config)
VALUES (1, '{"volume":1,"volumeLimit":0,"good":10,"bad":-90,"lt1":5,"lt3":0.5,"gt3":-1}'::jsonb)
ON CONFLICT (id) DO NOTHING;
