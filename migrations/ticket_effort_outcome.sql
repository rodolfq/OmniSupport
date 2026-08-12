-- Classificação de solução do chamado: dois campos INTERNOS (nunca visíveis
-- ao cliente), preenchidos no fechamento.
--
-- São dois campos e não um porque respondem perguntas diferentes:
--   Esforço  = quanto custou resolver
--   Desfecho = qual foi a natureza da solução
-- Um chamado trivial pode exigir ação (mudar uma config em 2 minutos) e um
-- complexo pode terminar em pura orientação. Num enum único as duas dimensões
-- brigam, e o dado sai inconsistente.
--
-- Ambas as listas são editáveis em Configurações (mesmo padrão das demais
-- config_*), por isso são tabela e não CHECK/enum do Postgres.

-- ---------------------------------------------------------------- Esforço
CREATE TABLE IF NOT EXISTS public.config_effort_levels (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  -- Peso relativo usado na CARGA PONDERADA dos relatórios: 10 chamados
  -- "Imediato" não representam o mesmo trabalho que 10 "Crítico", e contar
  -- chamado por cabeça premia quem pega os fáceis. Editável junto do rótulo.
  weight NUMERIC(5,2) NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- --------------------------------------------------------------- Desfecho
CREATE TABLE IF NOT EXISTS public.config_outcomes (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  -- Marca os desfechos que representam DEFEITO DE PRODUTO. É o que permite
  -- calcular "quanto do volume de suporte é bug que escapou" sem depender do
  -- rótulo literal — se amanhã alguém renomear "Bug" para "Falha", a conta
  -- continua certa.
  counts_as_defect BOOLEAN NOT NULL DEFAULT false,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- ------------------------------------------------- Vínculo com o chamado
-- ON DELETE SET NULL: apagar um rótulo em Configurações não pode apagar o
-- chamado nem travar a exclusão — o chamado só perde a classificação.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS effort_id UUID REFERENCES public.config_effort_levels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome_id UUID REFERENCES public.config_outcomes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_effort_id ON public.tickets(effort_id);
CREATE INDEX IF NOT EXISTS idx_tickets_outcome_id ON public.tickets(outcome_id);

-- ------------------------------------------------------------------ Seeds
-- Valores iniciais. ON CONFLICT (label) DO NOTHING deixa a migration
-- idempotente e preserva qualquer edição feita depois em Configurações.
INSERT INTO public.config_effort_levels (label, weight, color, sort_order) VALUES
  ('Imediato', 1,  '#22c55e', 1),
  ('Rotina',   2,  '#3b82f6', 2),
  ('Complexo', 5,  '#f59e0b', 3),
  ('Crítico',  8,  '#ef4444', 4)
ON CONFLICT (label) DO NOTHING;

INSERT INTO public.config_outcomes (label, counts_as_defect, color, sort_order) VALUES
  ('Orientação/dúvida',      false, '#3b82f6', 1),
  ('Configuração',           false, '#8b5cf6', 2),
  ('Correção de dado',       false, '#06b6d4', 3),
  ('Bug (virou ticket interno)', true, '#ef4444', 4),
  ('Melhoria/pedido novo',   false, '#f59e0b', 5),
  ('Não reproduzido',        false, '#64748b', 6),
  ('Duplicado',              false, '#94a3b8', 7)
ON CONFLICT (label) DO NOTHING;
