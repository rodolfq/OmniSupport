-- Pesquisa de satisfação enviada ao cliente ao finalizar uma conversa.
-- A resposta (1 = satisfeito, 0 = poderia ser melhor) é gravada na coluna
-- `rating` já existente em chat_histories (nunca usada até então).

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS awaiting_survey_until TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.config_survey_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT NOT NULL DEFAULT 'Diga-nos como nos saímos.

Basta enviar 1, se você estiver satisfeito, ou 0, se poderíamos fazer melhor.',
  response_window_hours INTEGER NOT NULL DEFAULT 24,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_survey_settings_single_row CHECK (id = 1)
);

INSERT INTO public.config_survey_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
