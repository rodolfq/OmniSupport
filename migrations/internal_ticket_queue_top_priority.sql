-- "Prioridade máxima na fila" do ticket interno (2026-11-23, pedido do usuário):
-- uma marcação acima de todas as estrelas — o ticket marcado fica no topo e
-- destacado na sua fila em Todos os Chamados > Tickets Internos, Meus Chamados
-- e Dashboard. Decisões do usuário: vários tickets podem estar marcados na
-- mesma fila (entre eles, a ordem normal) e só quem tem a permissão nova
-- internal:queue_priority marca/desmarca.
--
-- Independente de `priority` (estrelas): não mexe no SLA nem na regra de 2 dias.
--
-- Aditiva e idempotente. Aplicar ANTES de publicar o código: as listagens
-- selecionam a coluna. Para reverter:
--   ALTER TABLE public.internal_tickets DROP COLUMN IF EXISTS queue_top_priority;
--   UPDATE public.role_permissions SET permissions = array_remove(permissions, 'internal:queue_priority');

ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS queue_top_priority BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_internal_tickets_queue_top_priority
  ON public.internal_tickets(internal_queue_id) WHERE queue_top_priority;

-- Backfill: quem já configura as filas de ticket interno passa a poder priorizar.
UPDATE public.role_permissions
   SET permissions = array_append(permissions, 'internal:queue_priority')
 WHERE 'internal:queues_manage' = ANY(permissions)
   AND NOT ('internal:queue_priority' = ANY(permissions));
