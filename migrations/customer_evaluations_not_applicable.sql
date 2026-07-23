-- Permite "não se aplica" em cada critério: nota NULL num critério não
-- entra na média (AVG() do Postgres já ignora NULL sozinho). Os CHECK
-- existentes (ex: knowledge_score BETWEEN 1 AND 5) continuam válidos —
-- CHECK sempre passa quando a expressão resulta NULL.
ALTER TABLE public.customer_evaluations
  ALTER COLUMN knowledge_score DROP NOT NULL,
  ALTER COLUMN autonomy_score DROP NOT NULL,
  ALTER COLUMN learning_score DROP NOT NULL,
  ALTER COLUMN engagement_score DROP NOT NULL,
  ALTER COLUMN organization_score DROP NOT NULL,
  ALTER COLUMN communication_score DROP NOT NULL;
