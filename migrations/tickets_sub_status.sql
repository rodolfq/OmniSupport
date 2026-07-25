-- Sub-status opcional do chamado (detalhe dentro do status principal, ex.:
-- "Aguardando Cliente" -> "Feedback") — ver config_statuses.parent_status_id.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sub_status TEXT;
