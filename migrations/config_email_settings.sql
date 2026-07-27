-- Configuração de SMTP (Roadmap itens 15/16) — linha única, mesmo padrão de
-- public.config_survey_settings.
CREATE TABLE IF NOT EXISTS public.config_email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure BOOLEAN NOT NULL DEFAULT true,
  smtp_user TEXT,
  smtp_password TEXT,
  from_name TEXT,
  from_email TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_email_settings_single_row CHECK (id = 1)
);

INSERT INTO public.config_email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
