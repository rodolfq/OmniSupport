-- Reversão e alternativas para migrations/chat_assignments_clock.sql.
--
-- Fica em scripts/rollback/ de propósito: o runner (scripts/run-migrations.js) aplica
-- todo *.sql de migrations/, e este arquivo não pode ser aplicado por engano.
--
-- Três caminhos, do menos para o mais destrutivo:
--
-- A) DESLIGAR (kill-switch). Para de gravar o histórico de atribuição. Não apaga nada e
--    pode ser religado. Enquanto estiver desligado, as atribuições NÃO são registradas,
--    e isso cria lacunas no histórico.
--      ALTER TABLE public.chat_sessions DISABLE TRIGGER trg_chat_assignments_track;
--      ALTER TABLE public.chat_sessions ENABLE TRIGGER trg_chat_assignments_track;
--
-- B) REFATORAR uma função sem perder dados. NÃO use este arquivo. Crie uma migration nova
--    em migrations/ com CREATE OR REPLACE FUNCTION. Se o significado de uma métrica mudar,
--    grave com definition_version maior, por exemplo:
--      SELECT public.record_analyst_metrics(analista, inicio, fim, 2);
--    Os valores da versão 1 continuam na tabela e podem ser comparados com os da versão 2.
--
-- C) REMOVER TUDO. Apaga o histórico de atribuição acumulado e as métricas gravadas.
--    Só executar com autorização explícita. Recomendado dentro de BEGIN/COMMIT, conferindo
--    antes com o SELECT de contagem abaixo.
--
--    Contagem antes de apagar (para registrar o que será perdido):
--      SELECT (SELECT COUNT(*) FROM public.chat_assignments)      AS periodos,
--             (SELECT COUNT(*) FROM public.analyst_metric_values) AS metricas;

-- ---------------------------------------------------------------------------
-- Caminho C: remover tudo
-- ---------------------------------------------------------------------------
BEGIN;

DROP TRIGGER IF EXISTS trg_chat_assignments_track ON public.chat_sessions;

DROP FUNCTION IF EXISTS public.record_analyst_metrics(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER);
DROP FUNCTION IF EXISTS public.analyst_first_response_metrics(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS public.analyst_turn_metrics(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS public.chat_first_response_clock_seconds(UUID);
DROP FUNCTION IF EXISTS public.chat_turn_clock(UUID);
DROP FUNCTION IF EXISTS public.chat_online_seconds(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS public.chat_assignments_track();

DROP TABLE IF EXISTS public.analyst_metric_values;
DROP TABLE IF EXISTS public.chat_assignments;

COMMIT;
