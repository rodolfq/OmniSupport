-- Marca até quando cada usuário já leu as notificações de um chamado
-- (ver app/api/notifications/badges/route.ts) — alimenta o número no ícone
-- "Meus Chamados" da sidebar: toda modificação/nota/nota interna feita por
-- outra pessoa num chamado atribuído ao usuário, depois de last_read_at,
-- conta como notificação pendente. Upsert em mark-ticket-read (chamado ao
-- abrir o chamado no modal).
CREATE TABLE IF NOT EXISTS public.ticket_notification_reads (
  ticket_id text NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_notification_reads_pkey PRIMARY KEY (ticket_id, user_id),
  CONSTRAINT ticket_notification_reads_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE,
  CONSTRAINT ticket_notification_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);
