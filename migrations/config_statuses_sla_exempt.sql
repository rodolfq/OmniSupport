-- "Não conta como SLA vencido" por sub-status — pedido do usuário, 2026-11-03.
-- Checkbox igual ao "Finaliza" (is_closed), só que pras SUBTAGS (sub-status,
-- parent_status_id preenchido) de um chamado: marcado, o chamado naquele
-- sub-status para de contar como vencido (nem aparece na lista de SLA
-- vencido do Dashboard, nem no chip "Atrasadas"). Default false preserva o
-- comportamento de sempre pra quem já tem sub-status cadastrado.
ALTER TABLE public.config_statuses
  ADD COLUMN IF NOT EXISTS sla_exempt BOOLEAN NOT NULL DEFAULT false;
