-- Recorte manual (posição + zoom) de cada personagem Rive do ícone do
-- Agente de IA — editável ao vivo em Configurações > Agente de IA (arrastar
-- pra posicionar + slider de zoom), em vez de valores fixos no código
-- (lib/ai-assistant-avatar-options.ts). Mesma linha singleton de sempre.
-- JSON por id de personagem: {"expressive-faces": {"focusX":0.3,"focusY":0.6,"zoom":2.2}, ...}
-- Ausente/NULL ou sem a chave do personagem = usa o default do catálogo em código.
ALTER TABLE public.ai_assistant_settings ADD COLUMN IF NOT EXISTS avatar_crop_overrides JSONB;
