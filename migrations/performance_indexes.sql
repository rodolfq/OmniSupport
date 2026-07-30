-- Índices que faltavam nas colunas mais filtradas/ordenadas do caminho
-- quente do sistema (abrir a lista de chamados, abrir um chamado, poll de
-- chats a cada 30s) — achado numa investigação de lentidão percebida ao
-- abrir telas. Puramente aditivo (CREATE INDEX), sem mudança de
-- comportamento nem de dado.
--
-- Tabela grande em produção: se travar escrita por muito tempo, prefira
-- rodar `CREATE INDEX CONCURRENTLY` manualmente em vez deste arquivo direto
-- (CONCURRENTLY não roda dentro de transação, por isso não é o padrão aqui).

CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON public.tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON public.tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);

-- WHERE ticket_id = $1 ORDER BY created_at — toda abertura de chamado batia
-- nisso sem índice nenhum na tabela inteira.
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON public.ticket_messages(ticket_id, created_at);

-- chat_sessions não tinha NENHUM índice (nem status, nem queue_id, nem
-- assignee_id, nem customer_id, nem ticket_id) apesar do poll de 30s
-- (GET /api/chats?action=sessions) e da subquery correlacionada em
-- app/api/tickets/route.ts rodarem contra ela o tempo todo.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON public.chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_queue_id ON public.chat_sessions(queue_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assignee_id ON public.chat_sessions(assignee_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_id ON public.chat_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_id ON public.chat_sessions(ticket_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_internal_tickets_assignee_id ON public.internal_tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_internal_team_id ON public.internal_tickets(internal_team_id);

-- Mesmo gap de ticket_messages, achado no mesmo lugar: internal_ticket_id
-- sem índice numa tabela filtrada em toda abertura de ticket interno.
CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_internal_ticket_id ON public.internal_ticket_messages(internal_ticket_id, created_at);
