-- "Chat Resumido" — resumo por IA da conversa, salvo permanentemente na
-- primeira geração (não regenerado a cada consulta). Ver
-- lib/services/chat-summary-service.ts.
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMP WITH TIME ZONE;
