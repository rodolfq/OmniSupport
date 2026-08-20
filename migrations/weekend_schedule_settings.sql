-- Link da planilha do Google publicada como "Escala Fim de Semana" (ver
-- lib/services/weekend-schedule-service.ts), trocável em Configurações sem
-- precisar de deploy — mesmo padrão de ai_assistant_settings.groq_api_key.
-- NULL = usa o link padrão embutido no código.
CREATE TABLE IF NOT EXISTS public.weekend_schedule_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  published_sheet_id TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT weekend_schedule_settings_singleton CHECK (id = 1)
);
INSERT INTO public.weekend_schedule_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
