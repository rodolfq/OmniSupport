-- Chave Groq trocável em Configurações > Agente de IA sem editar o .env
-- nem redeployar (ver lib/groq-client.ts e
-- lib/services/ai-assistant-config-service.ts). Mesmo padrão de override da
-- linha singleton ai_assistant_settings: NULL = usa GROQ_API_KEY do
-- ambiente. Nunca devolvida ao client em texto puro — só um booleano
-- "configurada?" (ver getRawAssistantSettings).
ALTER TABLE public.ai_assistant_settings ADD COLUMN IF NOT EXISTS groq_api_key TEXT;
