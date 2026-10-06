-- Configuração da pontuação e das metas de chamados (Configurações > Pontuação de Chamados).
--
-- Uma linha só (id = 1), com metas e pontos em jsonb. Os valores iniciais são propostas e podem
-- ser alterados pela tela. Não sobrescreve uma configuração já salva.
--
-- Aditiva e idempotente. Para reverter: DROP TABLE public.ticket_points_config;

CREATE TABLE IF NOT EXISTS public.ticket_points_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  config JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.ticket_points_config (id, config)
VALUES (1, '{
  "metas": {"slaPct": 95, "primeiraRespostaMin": 10, "resolucaoPrimeiroContatoPct": 80, "backlogMax": 20, "reaberturaPct": 5},
  "regras": {"backlogHorasUteis": 48, "amostraMinima": 10},
  "pontos": {"slaCumprido": 10, "slaDescumprido": -15, "primeiraRespostaNoPrazo": 5, "primeiraRespostaForaPrazo": -5, "resolvidoPrimeiroContato": 10, "backlog": -5, "reabertura": -10}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
