-- Config Modo de Crise (linha única) — ver schema_postgres.sql para o
-- comentário completo e lib/services/crisis-mode-service.ts para o uso.
CREATE TABLE IF NOT EXISTS public.config_crisis_mode (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_crisis_mode_single_row CHECK (id = 1)
);

INSERT INTO public.config_crisis_mode (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
