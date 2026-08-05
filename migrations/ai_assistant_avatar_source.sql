-- Ícone do Agente de IA (aba Configurações > Agente de IA) — troca entre o
-- personagem padrão em SVG e os personagens Rive em public/rive/*.riv, sem
-- redeploy. Mesmo padrão de override da linha singleton ai_assistant_settings:
-- NULL = usa o padrão ('default', personagem SVG). Valores válidos ficam
-- fora do banco, em lib/ai-assistant-avatar-options.ts (única fonte da
-- verdade também usada pelo client) — validados na camada de serviço, não
-- por CHECK constraint, pro catálogo poder crescer sem nova migration.
ALTER TABLE public.ai_assistant_settings ADD COLUMN IF NOT EXISTS avatar_source TEXT;
