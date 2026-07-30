-- Corrige o cronometro de almoco/ausencia: o campo "statusSince" (usado pra
-- calcular os 60 minutos em app-context.tsx) lia analyst_status.last_active,
-- uma coluna de PRESENCA que o heartbeat de 60s (app-context.tsx) recarrega
-- pra NOW() a cada tick mesmo sem o status/motivo mudar. Ao fechar e reabrir
-- o sistema no meio do almoco, "desde quando" voltava pra um horario recente
-- (o do ultimo heartbeat antes de fechar), fazendo o cronometro parecer que
-- tinha parado/reiniciado em vez de continuar contando.
--
-- status_since é uma coluna nova, atualizada só quando status ou
-- current_reason realmente mudam (ver app/api/chats/route.ts, acao
-- log-status-change) — sobrevive a fechar/reabrir porque não depende de
-- nenhum heartbeat continuar rodando.
--
-- "status" também é adicionada aqui de forma defensiva (IF NOT EXISTS): já
-- está em uso em producao (app/api/chats/route.ts e app/actions.ts já
-- gravam nela), mas não constava em schema_postgres.sql — drift de uma
-- migration antiga não versionada. Sem efeito se a coluna já existir.
ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'online';
ALTER TABLE public.analyst_status ADD COLUMN IF NOT EXISTS status_since TIMESTAMP WITH TIME ZONE;

-- Backfill: usa last_active como melhor aproximação disponível pro status
-- atual de quem já estava com um status/motivo gravado antes desta migration.
UPDATE public.analyst_status SET status_since = last_active WHERE status_since IS NULL;
