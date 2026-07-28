-- Índices que faltavam pras queries de lib/services/metrics-service.ts
-- (Etapa 2 do roadmap "Time x Gerencial"). Conferido contra schema_postgres.sql
-- + migrations/ antes de escrever: chat_sessions.customer_id/customer_phone/
-- ticket_id/ticket_number e todas as colunas usadas de chat_histories já têm
-- índice (migrations/chat_session_ticket_link.sql,
-- chat_sessions_ticket_id_index.sql, create_chat_histories.sql) — não
-- duplicados aqui.

CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON public.chat_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assignee_id ON public.chat_sessions(assignee_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_queue_id ON public.chat_sessions(queue_id);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON public.chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_status_history_user_timestamp ON public.user_status_history(user_id, timestamp);
