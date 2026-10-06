-- Varredura final (2026-10-01): os 125 chamados com título padrão
-- "Atendimento DD/MM/AAAA HH:mm: Nome" já foram migrados em
-- close_default_titled_atendimento_tickets.sql. Este arquivo cobre o
-- restante — chamados com título PRÓPRIO (escrito por um analista) que
-- ainda ficaram presos em 'Fechado', resquício do período entre o rename do
-- enum (TicketStatus.CLOSED, 2026-09-29) e o deploy que consolidou todas as
-- correções da cadeia (status não validado no PUT, dropdown com cache
-- antigo) — ver CLAUDE.md, seção 15. Nenhum chamado criado depois de
-- 2026-10-01 01:03 saiu com esse status; confirmado ao vivo contra o
-- endpoint real antes de rodar isto.
--
-- Idempotente: WHERE já filtra só quem ainda está 'Fechado' — rodar de novo
-- não afeta nada (não sobra ninguém pra mexer).
UPDATE public.tickets
SET status = 'Concluído', updated_at = NOW()
WHERE status = 'Fechado';
