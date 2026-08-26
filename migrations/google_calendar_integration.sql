-- Integração com Google Agenda: cada usuário vincula a própria conta
-- (só leitura) e recebe lembretes de eventos aqui no SSX Desk.
-- Ver seção 10 do CLAUDE.md e lib/services/google-calendar-service.ts.

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  user_id uuid NOT NULL,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT google_calendar_connections_pkey PRIMARY KEY (user_id),
  CONSTRAINT google_calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.google_calendar_reminder_log (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id text NOT NULL,
  event_title text,
  event_start timestamptz NOT NULL,
  event_url text,
  notified_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT google_calendar_reminder_log_pkey PRIMARY KEY (id),
  CONSTRAINT google_calendar_reminder_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT google_calendar_reminder_log_unique UNIQUE (user_id, event_id, event_start)
);
CREATE INDEX IF NOT EXISTS idx_google_calendar_reminder_log_user_time ON public.google_calendar_reminder_log USING btree (user_id, notified_at);
