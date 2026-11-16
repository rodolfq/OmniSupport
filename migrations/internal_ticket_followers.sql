-- Seguidores do ticket interno (2026-11-16, pedido do usuário).
--
-- Quem é marcado com @ numa nota do ticket interno passa a receber por e-mail
-- todas as atualizações dele (como o criador e o responsável), até o ticket
-- ser concluído/fechado. A lista fica aqui; é só acrescida (marcar de novo não
-- duplica). Ver lib/services/internal-ticket-notifications.ts.
--
-- Aditiva e idempotente. Aplicar ANTES de publicar o código que a usa.

ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS follower_ids UUID[] NOT NULL DEFAULT '{}';
