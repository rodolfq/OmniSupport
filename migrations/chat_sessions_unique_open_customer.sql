-- Mesmo reforço de migrations/chat_sessions_unique_open_phone.sql, agora para
-- conversas de usuário logado (customer_id) — impede duas sessões abertas
-- (não fechadas) simultâneas para o mesmo cliente, cobrindo a corrida em que
-- o widget monta duas vezes quase ao mesmo tempo (ex.: aba duplicada) e cada
-- montagem cria sua própria sessão antes da outra terminar.

-- IMPORTANTE: se já existirem duplicatas abertas hoje, a criação do índice
-- abaixo falha. Rode antes para achar e decidir o que fazer com elas:
--
-- SELECT customer_id, array_agg(id) AS session_ids, array_agg(status) AS statuses
-- FROM public.chat_sessions
-- WHERE status <> 'closed' AND customer_id IS NOT NULL
-- GROUP BY customer_id
-- HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_open_customer
  ON public.chat_sessions (customer_id)
  WHERE status <> 'closed' AND customer_id IS NOT NULL;
