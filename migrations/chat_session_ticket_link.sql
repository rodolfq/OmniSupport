ALTER TABLE public.chat_sessions
ADD COLUMN IF NOT EXISTS ticket_id TEXT REFERENCES public.tickets(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS ticket_number BIGINT;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_id ON public.chat_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_phone ON public.chat_sessions(customer_phone);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_number ON public.chat_sessions(ticket_number);
