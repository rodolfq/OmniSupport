-- Remove o status "Fechado" (redundante com "Concluído" — os dois fecham o
-- chamado do mesmo jeito) e migra todo o histórico para "Concluído".
-- Pedido do usuário, 2026-09-29.
--
-- Idempotente: rodar de novo não faz nada (as UPDATE já não acham mais
-- 'Fechado' pra trocar, e o DELETE já não acha mais a linha).

-- 1. Chamados com status 'Fechado' viram 'Concluído'.
UPDATE public.tickets SET status = 'Concluído', updated_at = NOW() WHERE status = 'Fechado';

-- 2. Automação "Chamado finalizado" (chamado_finalizado) disparava ao mudar
--    para 'Fechado' — passa a disparar para 'Concluído', senão a mensagem
--    automática de encerramento para de sair depois desta migration.
UPDATE public.automation_settings SET trigger_status = 'Concluído' WHERE trigger_status = 'Fechado';

-- 3. Some do cadastro (Configurações > Geral > Status) — sem isso ele
--    continuaria aparecendo como opção pra escolher de novo, mesmo sem
--    nenhum chamado usando.
DELETE FROM public.config_statuses WHERE label = 'Fechado' AND scope = 'ticket';
