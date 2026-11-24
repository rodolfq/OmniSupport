-- Status por fila de ticket interno (2026-11-24, pedido do usuário).
--
-- O cadastro de status continua ÚNICO (config_statuses, scope
-- 'internal_ticket') — o ticket guarda o NOME do status e relatórios, tempo
-- por status, SLA e API ligam tudo por ele. Cada fila só ESCOLHE quais desses
-- status (e sub-status, um a um) usa, e em que ordem.
--
-- Fila sem nenhuma linha aqui = usa TODOS os status (nada muda até alguém
-- configurar). Sub-status só vale se o status pai também estiver na fila.
--
-- Excluir um status do cadastro remove a linha daqui (CASCADE); excluir a
-- fila também. Idempotente.

CREATE TABLE IF NOT EXISTS public.internal_ticket_queue_statuses (
  queue_id UUID NOT NULL REFERENCES public.internal_ticket_queues(id) ON DELETE CASCADE,
  status_id UUID NOT NULL REFERENCES public.config_statuses(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (queue_id, status_id)
);

CREATE INDEX IF NOT EXISTS idx_internal_ticket_queue_statuses_status
  ON public.internal_ticket_queue_statuses (status_id);
