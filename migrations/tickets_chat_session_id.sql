-- Item 10 do roadmap de melhorias: permitir mais de um chamado na mesma
-- conversa. Hoje só existe chat_sessions.ticket_id (sessão -> 1 chamado, sem
-- constraint UNIQUE — a regra "1 chat = 1 chamado" era só de aplicação, em
-- saveTicketFromChatSession). Esta coluna inverte o sentido: cada chamado
-- passa a "saber" de qual conversa veio, permitindo vários chamados
-- apontarem pra mesma sessão. chat_sessions.ticket_id/ticket_number
-- continuam existindo, agora com o sentido de "chamado mais recente desta
-- conversa" (usado como badge no chat) — aditivo, não quebra nada existente.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS chat_session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_chat_session_id ON public.tickets(chat_session_id);
