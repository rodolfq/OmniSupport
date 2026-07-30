-- Agente de IA — busca semântica (embeddings) sobre TODO o histórico de
-- mensagens, não só os últimos N resultados de uma busca por palavra-chave
-- exata (ver migrations/ai_assistant.sql para a v1 por palavra-chave/SQL).
-- Decisões de arquitetura registradas aqui porque não são óbvias:
--
-- SEM pgvector: testado direto no Postgres de produção (CREATE EXTENSION
-- vector) e a extensão não está instalada no servidor — não é algo que dá
-- pra resolver via SQL, precisaria de acesso ao SO do banco. Os vetores
-- ficam num array nativo do Postgres (double precision[]) e a similaridade
-- de cosseno é calculada em JS na hora da busca (ver
-- lib/services/embedding-service.ts) — funciona em qualquer Postgres, sem
-- extensão nenhuma. Se um dia o banco for trocado por um com pgvector,
-- essa é a primeira coisa a migrar (ganho de performance em escala maior
-- que a atual).
--
-- SEM hook manual em cada ponto de criação de mensagem: em vez de editar
-- os ~11 lugares no código onde uma mensagem é inserida (chamado, ticket
-- interno, chat cliente por 2+ caminhos diferentes, chat interno — cada um
-- com risco de esquecer algum), um TRIGGER de banco em cada uma das 4
-- tabelas de mensagem garante que TODA inserção, não importa o caminho de
-- código (nem os que existem hoje nem os que forem escritos no futuro),
-- cai sozinha na fila de indexação. Um scheduler em segundo plano (mesmo
-- padrão de lib/services/hotfix-scheduler.ts, setInterval registrado em
-- instrumentation-node.ts) drena essa fila silenciosamente, sem depender
-- de nenhum usuário estar com o navegador aberto.

CREATE TABLE public.ai_embeddings (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL, -- 'ticket_message' | 'internal_ticket_message' | 'chat_message' | 'internal_chat_message'
  source_id UUID NOT NULL,   -- id da linha original na tabela de origem
  parent_id TEXT,            -- ticket_id / internal_ticket_id / session_id / chat_id — agrupa/filtra sem decodificar source_type
  content TEXT NOT NULL,     -- texto que foi vetorizado (cópia — evita re-join a cada busca)
  embedding DOUBLE PRECISION[] NOT NULL,
  source_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  indexed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_embeddings_source ON public.ai_embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_parent ON public.ai_embeddings(parent_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_created_at ON public.ai_embeddings(source_created_at DESC);

CREATE TABLE public.ai_embedding_queue (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_ai_embedding_queue_pending ON public.ai_embedding_queue(created_at) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.ai_enqueue_embedding() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ai_embedding_queue (source_type, source_id) VALUES (TG_ARGV[0], NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_embed_ticket_messages ON public.ticket_messages;
CREATE TRIGGER trg_ai_embed_ticket_messages
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('ticket_message');

DROP TRIGGER IF EXISTS trg_ai_embed_internal_ticket_messages ON public.internal_ticket_messages;
CREATE TRIGGER trg_ai_embed_internal_ticket_messages
  AFTER INSERT ON public.internal_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('internal_ticket_message');

DROP TRIGGER IF EXISTS trg_ai_embed_chat_messages ON public.chat_messages;
CREATE TRIGGER trg_ai_embed_chat_messages
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('chat_message');

DROP TRIGGER IF EXISTS trg_ai_embed_internal_chat_messages ON public.internal_chat_messages;
CREATE TRIGGER trg_ai_embed_internal_chat_messages
  AFTER INSERT ON public.internal_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('internal_chat_message');

-- Backfill do histórico já existente — enfileira só o que ainda não foi
-- indexado nem já está pendente, então é seguro rodar esta migration mais
-- de uma vez sem duplicar trabalho. A partir daqui, o scheduler drena a
-- fila sozinho (ver ENABLE_AI_EMBEDDINGS no .env — desligado por padrão).
INSERT INTO public.ai_embedding_queue (source_type, source_id)
SELECT 'ticket_message', tm.id FROM public.ticket_messages tm
WHERE NOT EXISTS (SELECT 1 FROM public.ai_embeddings e WHERE e.source_type = 'ticket_message' AND e.source_id = tm.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_embedding_queue q WHERE q.source_type = 'ticket_message' AND q.source_id = tm.id AND q.processed_at IS NULL);

INSERT INTO public.ai_embedding_queue (source_type, source_id)
SELECT 'internal_ticket_message', itm.id FROM public.internal_ticket_messages itm
WHERE NOT EXISTS (SELECT 1 FROM public.ai_embeddings e WHERE e.source_type = 'internal_ticket_message' AND e.source_id = itm.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_embedding_queue q WHERE q.source_type = 'internal_ticket_message' AND q.source_id = itm.id AND q.processed_at IS NULL);

INSERT INTO public.ai_embedding_queue (source_type, source_id)
SELECT 'chat_message', cm.id FROM public.chat_messages cm
WHERE NOT EXISTS (SELECT 1 FROM public.ai_embeddings e WHERE e.source_type = 'chat_message' AND e.source_id = cm.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_embedding_queue q WHERE q.source_type = 'chat_message' AND q.source_id = cm.id AND q.processed_at IS NULL);

INSERT INTO public.ai_embedding_queue (source_type, source_id)
SELECT 'internal_chat_message', icm.id FROM public.internal_chat_messages icm
WHERE NOT EXISTS (SELECT 1 FROM public.ai_embeddings e WHERE e.source_type = 'internal_chat_message' AND e.source_id = icm.id)
  AND NOT EXISTS (SELECT 1 FROM public.ai_embedding_queue q WHERE q.source_type = 'internal_chat_message' AND q.source_id = icm.id AND q.processed_at IS NULL);
