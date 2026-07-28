-- Ordem do rodízio por "quem ficou online primeiro hoje": em vez de seguir
-- sempre a ordem cadastrada em queues.member_ids, pickNextQueueAssignee passa
-- a ordenar por queue_anchor_at. A âncora só é gravada na PRIMEIRA vez que o
-- analista fica online no dia (ver lógica em updateUserStatus/log-status-
-- change) — ficar ausente ou fechar o navegador não mexe nela, só a virada
-- do dia (queue_anchor_date < CURRENT_DATE) permite regravar.
ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS queue_anchor_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS queue_anchor_date DATE;

-- Backfill: quem já está online agora ganha âncora de hoje, pra não perder a
-- posição até a próxima troca de status.
UPDATE public.analyst_status
  SET queue_anchor_at = NOW(), queue_anchor_date = CURRENT_DATE
  WHERE is_online = true AND queue_anchor_at IS NULL;

-- Suporte à contagem de trocas de status hoje (visibilidade admin, LAG por usuário/tempo).
CREATE INDEX IF NOT EXISTS idx_user_status_history_user_time ON public.user_status_history(user_id, timestamp);
