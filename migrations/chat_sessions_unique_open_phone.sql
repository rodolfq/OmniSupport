-- Impede duas conversas abertas (não fechadas) simultâneas para o mesmo
-- telefone — reforço no banco contra a condição de corrida em que duas
-- mensagens da mesma pessoa chegam quase ao mesmo tempo e cada uma cria sua
-- própria sessão antes que a outra termine de gravar a sua.

-- IMPORTANTE: se já existirem duplicatas hoje (como a relatada), a criação do
-- índice abaixo falha. Rode antes para achar e decidir o que fazer com elas
-- (ex.: fechar a mais antiga, ou mesclar o histórico manualmente):
--
-- SELECT customer_phone, array_agg(id) AS session_ids, array_agg(status) AS statuses
-- FROM public.chat_sessions
-- WHERE status <> 'closed' AND customer_phone IS NOT NULL
-- GROUP BY customer_phone
-- HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_open_phone
  ON public.chat_sessions (customer_phone)
  WHERE status <> 'closed' AND customer_phone IS NOT NULL;
