-- Indicador de "novas notas" no ticket interno (2026-10-21, pedido do
-- usuário) — mesmo mecanismo já existente pra chamado de cliente
-- (ticket_notification_reads / app/api/notifications/badges), generalizado
-- pro ticket interno. Por usuário: last_read_at avança quando o usuário abre
-- aquele ticket específico; "não lida" = mensagem de OUTRA pessoa criada
-- depois disso. Critério propositalmente mais amplo que o do chamado (que é
-- só "atribuídos a mim"): aqui vale pra QUALQUER ticket interno que o
-- usuário já tenha aberto antes, pedido do usuário ("todo lugar... tudo").
--
-- ⚠️ MORATÓRIA DE BANCO (ver CLAUDE.md) — escrito e espelhado em
-- schema_postgres.sql, mas NÃO aplicado contra o DATABASE_URL atual.
-- Aplicar só com autorização explícita do usuário. Tabela nova, aditiva.

CREATE TABLE IF NOT EXISTS public.internal_ticket_notification_reads (
  internal_ticket_id TEXT NOT NULL REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (internal_ticket_id, user_id)
);
