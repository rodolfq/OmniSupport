-- Detector de insatisfação do cliente (item 9 do ROADMAP_MELHORIAS_2.md).
-- Ao final de cada chat, um job em segundo plano (ver
-- lib/services/dissatisfaction-service.ts + dissatisfaction-scheduler.ts)
-- classifica se houve insatisfação, com departamento/categoria da taxonomia
-- fixa em lib/dissatisfaction-taxonomy.ts. dissatisfaction_processed_at NULL
-- = ainda não processado (mesmo padrão de sentinela de summary_generated_at
-- e hotfixes.alerted_at).
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_processed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_detected BOOLEAN;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_department TEXT;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_category TEXT;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_reason TEXT;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.chat_histories ADD COLUMN IF NOT EXISTS dissatisfaction_last_error TEXT;

-- Consulta do scheduler (WHERE dissatisfaction_processed_at IS NULL ORDER BY
-- finished_at ASC LIMIT N) não precisa escanear a tabela inteira conforme
-- ela cresce.
CREATE INDEX IF NOT EXISTS idx_chat_histories_dissatisfaction_pending
  ON public.chat_histories (finished_at ASC) WHERE dissatisfaction_processed_at IS NULL;

-- Backlog histórico: marca tudo que já existe como "processado" (sem
-- classificação), pra não cair de sopetão na fila do scheduler e estourar a
-- cota diária do Groq (chave de teste compartilhada com o Agente de IA) no
-- primeiro deploy. Backfill do histórico é manual/opt-in — ver a ação
-- 'requeue-dissatisfaction' em app/api/chats/route.ts.
UPDATE public.chat_histories SET dissatisfaction_processed_at = now() WHERE dissatisfaction_processed_at IS NULL;
