-- Full-text search nativo do Postgres para as ferramentas de busca por
-- palavra-chave do Agente de IA (search_tickets, search_internal_tickets,
-- search_client_chats, search_internal_chats — ver
-- lib/services/ai-assistant-service.ts). Troca o ILIKE '%termo%' simples por
-- tsvector + websearch_to_tsquery/ts_rank: melhora relevância (ranking, não
-- só "contém a substring") sem custo de API nem modelo local — continua
-- zero-cost, ao contrário da busca semântica (ENABLE_AI_EMBEDDINGS), que
-- fica desligada de propósito neste ambiente.
--
-- GENERATED ALWAYS ... STORED mantém a coluna sincronizada sozinha em todo
-- INSERT/UPDATE (sem trigger manual, sem re-sync de app). 'portuguese' é a
-- configuração de dicionário nativa do Postgres (stemming + stopwords em
-- pt-BR).
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_tickets_search_vector ON public.tickets USING GIN (search_vector);

ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_internal_tickets_search_vector ON public.internal_tickets USING GIN (search_vector);

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(text, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_chat_messages_search_vector ON public.chat_messages USING GIN (search_vector);

ALTER TABLE public.internal_chat_messages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(text, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_search_vector ON public.internal_chat_messages USING GIN (search_vector);
