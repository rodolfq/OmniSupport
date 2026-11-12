-- Embeddings do Agente de IA em precisão SIMPLES (REAL[], 4 bytes por número)
-- em vez de DOUBLE PRECISION[] (8 bytes) — 2026-11-12, economia de espaço.
--
-- Por que é seguro: o modelo de embedding (@huggingface/transformers) já gera
-- Float32 — os valores gravados como double eram floats de 32 bits
-- convertidos. Medido no banco de dev: diferença ZERO por número e zero no
-- score de similaridade (o produto escalar é feito em JS, em
-- lib/services/embedding-service.ts, e o driver pg devolve REAL[] como array
-- de number igual antes). Nenhuma linha de código precisou mudar.
--
-- Efeito: a coluna cai pela metade (384 números × 4 bytes por linha). Em
-- produção, ai_embeddings era a maior tabela do banco (273 MB, 182 MB só de
-- vetor).
--
-- ATENÇÃO NA HORA DE APLICAR: o ALTER reescreve a tabela inteira e a segura
-- com bloqueio exclusivo enquanto roda (segundos a ~1 min para ~90 mil
-- linhas). Nesse intervalo a indexação do Agente de IA espera e a busca
-- semântica fica parada — nada se perde, só atrasa. Rodar fora do pico.
--
-- Idempotente: só altera se a coluna ainda for double precision[].

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ai_embeddings'
       AND column_name = 'embedding' AND udt_name = '_float8'
  ) THEN
    ALTER TABLE public.ai_embeddings
      ALTER COLUMN embedding TYPE REAL[] USING embedding::real[];
  END IF;
END $$;
