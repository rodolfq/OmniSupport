-- Ordem programada dos participantes LIVRES do Giro de Atendimento.
--
-- Até aqui, a base do rodízio dos livres vinha só da ordem do giro do dia
-- anterior (ou, na primeira vez, da ordem de CADASTRO). Isso não dava ao
-- administrador nenhum jeito de definir de propósito "quem vem depois de
-- quem" antes do primeiro giro existir, nem de reorganizar a sequência sem
-- mexer posição fixa por posição fixa. base_order resolve isso: é a ordem
-- "programada" que o admin define arrastando a lista em Configuração — usada
-- como base sempre que não há giro anterior pra herdar (participante novo, ou
-- giro sendo montado pela primeira vez), e também como referência de
-- "quem tá logo depois de quem" a qualquer momento.
ALTER TABLE public.giro_participants ADD COLUMN IF NOT EXISTS base_order INTEGER NOT NULL DEFAULT 0;

-- Backfill: ordem de cadastro vira a ordem programada inicial, pra ninguém
-- ficar em 0 e colidir.
WITH ordered AS (
  SELECT user_id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.giro_participants
)
UPDATE public.giro_participants gp
   SET base_order = ordered.rn
  FROM ordered
 WHERE gp.user_id = ordered.user_id;

CREATE INDEX IF NOT EXISTS idx_giro_participants_base_order ON public.giro_participants(base_order);
