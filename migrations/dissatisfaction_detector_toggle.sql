-- Detector de Insatisfação hoje só liga automaticamente via env var
-- ENABLE_DISSATISFACTION_DETECTOR (exige redeploy pra mudar). Adiciona
-- override em runtime na mesma linha singleton do Agente de IA
-- (ai_assistant_settings), no mesmo padrão de semantic_search_enabled:
-- NULL = segue o comportamento de sempre (env var); preenchido = decide por
-- cima do env. dissatisfaction_extra_instructions permite acrescentar
-- critério de negócio ao prompt de classificação sem tocar no JSON/taxonomia
-- fixos em lib/services/dissatisfaction-service.ts.
ALTER TABLE public.ai_assistant_settings ADD COLUMN IF NOT EXISTS dissatisfaction_detector_enabled BOOLEAN;
ALTER TABLE public.ai_assistant_settings ADD COLUMN IF NOT EXISTS dissatisfaction_extra_instructions TEXT;
