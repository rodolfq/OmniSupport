-- Controle do Agente de IA em Configurações — prompt do sistema, modelo e
-- busca semântica passam a ser editáveis em runtime (sem redeploy), em vez
-- de fixos no código (lib/services/ai-assistant-service.ts) ou só via .env.
-- Linha única (singleton), mesmo padrão de config_email_settings/
-- config_survey_settings. Todos os campos NULL = usa o padrão de sempre
-- (texto/model hardcoded, embeddings seguindo ENABLE_AI_EMBEDDINGS).
CREATE TABLE IF NOT EXISTS public.ai_assistant_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  system_prompt TEXT,
  model TEXT,
  semantic_search_enabled BOOLEAN,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ai_assistant_settings_singleton CHECK (id = 1)
);

INSERT INTO public.ai_assistant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
