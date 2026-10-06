-- Histórico de atribuição de conversas + relógio do analista (plano de avaliação v1.3).
--
-- Até aqui o banco guardava só o responsável ATUAL da conversa (chat_sessions.assignee_id).
-- Quando a conversa muda de analista, o período anterior se perde. Sem esse histórico não
-- dá para medir o tempo do analista só enquanto ele era o responsável e estava online.
--
-- Regra única do relógio (plano v1.3, seção 2.2), aplicada a cada turno do cliente:
--   o relógio anda quando o cliente espera resposta, a conversa está com o analista e o
--   analista está online (user_status_history = 'online'). Para quando ele responde.
--   Fila não conta (começa na atribuição). Transferência: quem saiu para de contar; quem
--   recebeu começa a contar na transferência.
--
-- Peças desta migration:
--   1) chat_assignments: um registro por período em que a conversa esteve com um analista.
--      Preenchida por gatilho em chat_sessions, que cobre TODOS os pontos que mudam
--      assignee_id ou status (pyvon-service, queue-routing, chat-sessions, chats/route,
--      INSERTs com assignee_id), sem depender de cada caminho lembrar de gravar.
--   2) chat_online_seconds(usuário, início, fim): segundos online no intervalo.
--   3) chat_turn_clock(conversa): um registro por turno do cliente, com o analista, o
--      resultado (respondido, sem_resposta ou aberto) e os segundos do relógio.
--   4) chat_first_response_clock_seconds(conversa): 1ª resposta = relógio do primeiro turno
--      respondido. Não substitui chat_first_response_seconds, que continua alimentando o
--      histórico de conversas; trocar é uma etapa própria.
--   5) analyst_turn_metrics(analista, início, fim): mediana, P90, média e % de turnos sem
--      resposta de um analista no período. Base da pontuação.
--
-- Sem backfill de propósito: conversas anteriores a esta migration não têm histórico de
-- atribuição, e reconstruí-lo a partir de texto de transferência não é confiável. As
-- funções devolvem NULL/nenhum turno para elas, e o painel precisa mostrar a data de início.
--
-- Compatível com o Postgres de produção (antigo): sem gen_random_uuid(), e com
-- EXECUTE PROCEDURE em vez de EXECUTE FUNCTION. Idempotente: pode rodar de novo.

-- ---------------------------------------------------------------------------
-- 1) Tabela de períodos de atribuição
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_assignments (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  assignee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- NULL = período ainda aberto (conversa ainda com este analista).
  unassigned_at TIMESTAMP WITH TIME ZONE,
  -- inicial: primeira atribuição da conversa
  -- atribuicao: conversa sem responsável que passou a ter um
  -- transferencia: saiu de um analista e foi para outro
  -- reabertura: conversa encerrada foi reaberta com o mesmo responsável
  reason TEXT NOT NULL CHECK (reason IN ('inicial', 'atribuicao', 'transferencia', 'reabertura')),
  CONSTRAINT chat_assignments_period_check CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at)
);

-- Sem índice único parcial de "um período aberto por conversa" de propósito: um bug de
-- concorrência nele faria o UPDATE do chat falhar em produção. A garantia fica no gatilho.
CREATE INDEX IF NOT EXISTS idx_chat_assignments_session
  ON public.chat_assignments (session_id, assigned_at);
CREATE INDEX IF NOT EXISTS idx_chat_assignments_assignee
  ON public.chat_assignments (assignee_id, assigned_at);

-- ---------------------------------------------------------------------------
-- 2) Gatilho que mantém o histórico a partir de chat_sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_assignments_track() RETURNS trigger AS $$
DECLARE
  v_had_history BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assignee_id IS NOT NULL AND NEW.status IS DISTINCT FROM 'closed' THEN
      INSERT INTO public.chat_assignments (session_id, assignee_id, assigned_at, reason)
      VALUES (NEW.id, NEW.assignee_id, NOW(), 'inicial');
    END IF;
    RETURN NEW;
  END IF;

  -- Encerrar a conversa fecha o período aberto.
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE public.chat_assignments
       SET unassigned_at = NOW()
     WHERE session_id = NEW.id AND unassigned_at IS NULL;
  END IF;

  -- Troca de responsável (inclui atribuir a quem estava vazio e tirar o responsável).
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id THEN
    UPDATE public.chat_assignments
       SET unassigned_at = NOW()
     WHERE session_id = NEW.id AND unassigned_at IS NULL;

    IF NEW.assignee_id IS NOT NULL AND NEW.status IS DISTINCT FROM 'closed' THEN
      SELECT EXISTS (SELECT 1 FROM public.chat_assignments WHERE session_id = NEW.id)
        INTO v_had_history;
      INSERT INTO public.chat_assignments (session_id, assignee_id, assigned_at, reason)
      VALUES (
        NEW.id,
        NEW.assignee_id,
        NOW(),
        CASE
          WHEN OLD.assignee_id IS NOT NULL THEN 'transferencia'
          WHEN v_had_history THEN 'atribuicao'
          ELSE 'inicial'
        END
      );
    END IF;
  END IF;

  -- Reabrir conversa encerrada com responsável abre um novo período. Roda depois do bloco
  -- de troca para não duplicar um período já aberto acima.
  IF OLD.status = 'closed' AND NEW.status IS DISTINCT FROM 'closed' AND NEW.assignee_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_assignments WHERE session_id = NEW.id AND unassigned_at IS NULL
     ) THEN
    INSERT INTO public.chat_assignments (session_id, assignee_id, assigned_at, reason)
    VALUES (NEW.id, NEW.assignee_id, NOW(), 'reabertura');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_assignments_track ON public.chat_sessions;
CREATE TRIGGER trg_chat_assignments_track
  AFTER INSERT OR UPDATE OF assignee_id, status ON public.chat_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.chat_assignments_track();

-- ---------------------------------------------------------------------------
-- 3) Segundos online de um usuário num intervalo
-- ---------------------------------------------------------------------------
-- Cada linha de user_status_history marca o INÍCIO de um status; o trecho dura até a
-- próxima linha, ou até p_to na última. Devolve NULL quando não há nenhum registro de
-- presença do usuário até p_to: não dá para separar tempo online sem histórico.
CREATE OR REPLACE FUNCTION public.chat_online_seconds(p_user UUID, p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_has_presence BOOLEAN;
  v_total NUMERIC;
BEGIN
  IF p_to <= p_from THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_status_history h
     WHERE h.user_id = p_user AND h.timestamp <= p_to
  ) INTO v_has_presence;

  IF NOT v_has_presence THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(
           GREATEST(0, EXTRACT(EPOCH FROM (LEAST(seg.seg_end, p_to) - GREATEST(seg.seg_start, p_from))))
         ), 0)
    INTO v_total
    FROM (
      SELECT h.timestamp AS seg_start,
             COALESCE(LEAD(h.timestamp) OVER (ORDER BY h.timestamp), p_to) AS seg_end,
             h.status
        FROM public.user_status_history h
       WHERE h.user_id = p_user
         AND h.timestamp <= p_to
         -- Começa na linha vigente em p_from, para pegar o status que já valia ali.
         AND h.timestamp >= COALESCE(
               (SELECT MAX(x.timestamp) FROM public.user_status_history x
                 WHERE x.user_id = p_user AND x.timestamp <= p_from),
               '-infinity'::timestamptz)
    ) seg
   WHERE seg.status = 'online'
     AND seg.seg_end > p_from;

  RETURN v_total;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Turnos do cliente de uma conversa, com o relógio de cada um
-- ---------------------------------------------------------------------------
-- Classificação das mensagens. Os critérios de cliente e de equipe são os mesmos de
-- chat_first_response_seconds (migrations/chat_first_response_seconds.sql). Ao unificar as
-- definições, extrair esses critérios para uma função só.
--   ignorar: sistema, nota interna, automação, template, resposta de crise, sem conteúdo
--   cliente: veio do canal (pyvon/whatsapp), remetente sem cadastro, ou sem papel de equipe
--   equipe:  remetente com papel de equipe, com texto ou anexo
--
-- Turno = sequência de mensagens do cliente depois da última resposta da equipe.
-- Resultado de cada turno:
--   respondido:   a equipe respondeu. Relógio do analista que respondeu.
--   sem_resposta: conversa encerrada sem resposta. Relógio de quem estava com ela no fim.
--   aberto:       ainda sem resposta e conversa ativa. Relógio até agora. Não entra nas métricas.
-- Quando o turno passou para outro analista antes da resposta, quem saiu não recebe
-- registro: o relógio já tinha parado e quem recebeu conta a partir da transferência.
-- Turno sem nenhum segundo online do analista não conta como sem resposta.
CREATE OR REPLACE FUNCTION public.chat_turn_clock(p_session_id UUID)
RETURNS TABLE (
  out_turn_start TIMESTAMP WITH TIME ZONE,
  out_analyst_id UUID,
  out_reply_at TIMESTAMP WITH TIME ZONE,
  out_outcome TEXT,
  out_clock_seconds INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  m RECORD;
  v_status TEXT;
  v_in_turn BOOLEAN := FALSE;
  v_turn_start TIMESTAMP WITH TIME ZONE;
  v_assigned_at TIMESTAMP WITH TIME ZONE;
  v_last_assignee UUID;
  v_last_assigned TIMESTAMP WITH TIME ZONE;
  v_last_unassigned TIMESTAMP WITH TIME ZONE;
  v_start TIMESTAMP WITH TIME ZONE;
  v_end TIMESTAMP WITH TIME ZONE;
  v_secs NUMERIC;
BEGIN
  SELECT s.status INTO v_status FROM public.chat_sessions s WHERE s.id = p_session_id;

  FOR m IN
    SELECT c.created_at, c.sender_id,
           CASE
             WHEN c.type IN ('system', 'internal') THEN 'ignorar'
             WHEN c.metadata ? 'auto_reply' OR c.metadata ? 'template' THEN 'ignorar'
             WHEN c.sender_id IS NULL AND c.sender_name LIKE 'SSX Desk%' THEN 'ignorar'
             WHEN COALESCE(c.metadata->>'source', '') IN ('pyvon', 'whatsapp')
                  OR p.id IS NULL
                  OR p.role NOT IN ('Administrador', 'Equipe', 'Time Interno') THEN 'cliente'
             WHEN COALESCE(c.metadata->>'source', '') = 'crisis_mode' THEN 'ignorar'
             WHEN (c.text IS NOT NULL AND c.text <> '')
                  OR jsonb_array_length(COALESCE(c.metadata->'attachments', '[]'::jsonb)) > 0 THEN 'equipe'
             ELSE 'ignorar'
           END AS kind
      FROM public.chat_messages c
      LEFT JOIN public.profiles p ON p.id = c.sender_id
     WHERE c.session_id = p_session_id
     ORDER BY c.created_at, c.id
  LOOP
    IF m.kind = 'cliente' THEN
      IF NOT v_in_turn THEN
        v_in_turn := TRUE;
        v_turn_start := m.created_at;
      END IF;
    ELSIF m.kind = 'equipe' AND v_in_turn THEN
      -- Quando quem respondeu recebeu a conversa (e ainda estava com ela na resposta).
      SELECT a.assigned_at INTO v_assigned_at
        FROM public.chat_assignments a
       WHERE a.session_id = p_session_id
         AND a.assignee_id = m.sender_id
         AND a.assigned_at <= m.created_at
         AND COALESCE(a.unassigned_at, 'infinity'::timestamptz) > m.created_at
       ORDER BY a.assigned_at DESC
       LIMIT 1;

      IF v_assigned_at IS NOT NULL THEN
        v_secs := public.chat_online_seconds(m.sender_id, GREATEST(v_turn_start, v_assigned_at), m.created_at);
        IF v_secs IS NOT NULL THEN
          out_turn_start := v_turn_start;
          out_analyst_id := m.sender_id;
          out_reply_at := m.created_at;
          out_outcome := 'respondido';
          out_clock_seconds := ROUND(v_secs)::integer;
          RETURN NEXT;
        END IF;
      END IF;

      v_in_turn := FALSE;
    END IF;
  END LOOP;

  -- Turno ainda sem resposta no fim da conversa: vale para quem está com ela agora (ou
  -- estava por último, se a conversa foi encerrada).
  IF v_in_turn THEN
    SELECT a.assignee_id, a.assigned_at, a.unassigned_at
      INTO v_last_assignee, v_last_assigned, v_last_unassigned
      FROM public.chat_assignments a
     WHERE a.session_id = p_session_id
     ORDER BY a.assigned_at DESC
     LIMIT 1;

    IF v_last_assignee IS NOT NULL THEN
      v_start := GREATEST(v_turn_start, v_last_assigned);
      v_end := COALESCE(v_last_unassigned, NOW());

      IF v_end > v_start THEN
        v_secs := public.chat_online_seconds(v_last_assignee, v_start, v_end);
        IF v_secs IS NOT NULL AND (v_status = 'closed' AND v_secs > 0 OR v_status <> 'closed') THEN
          out_turn_start := v_turn_start;
          out_analyst_id := v_last_assignee;
          out_reply_at := NULL;
          out_outcome := CASE WHEN v_status = 'closed' THEN 'sem_resposta' ELSE 'aberto' END;
          out_clock_seconds := ROUND(v_secs)::integer;
          RETURN NEXT;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) 1ª resposta do analista = relógio do primeiro turno respondido
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_first_response_clock_seconds(p_session_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT t.out_clock_seconds
    FROM public.chat_turn_clock(p_session_id) t
   WHERE t.out_outcome = 'respondido'
   ORDER BY t.out_turn_start
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 6) Métricas de turnos de um analista no período (base da pontuação)
-- ---------------------------------------------------------------------------
-- Só conta turnos que começaram dentro do período. Turnos 'aberto' ficam de fora até
-- serem resolvidos. Percentuais e medianas são calculados só sobre turnos com resposta ou
-- sem resposta.
CREATE OR REPLACE FUNCTION public.analyst_turn_metrics(p_analyst UUID, p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
  turnos_respondidos INTEGER,
  turnos_sem_resposta INTEGER,
  intervalo_mediana NUMERIC,
  intervalo_p90 NUMERIC,
  intervalo_media NUMERIC,
  sem_resposta_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH turnos AS (
    SELECT tc.out_outcome, tc.out_clock_seconds
      FROM (
        SELECT DISTINCT a.session_id
          FROM public.chat_assignments a
         WHERE a.assignee_id = p_analyst
           AND a.assigned_at < p_to
           AND COALESCE(a.unassigned_at, 'infinity'::timestamptz) > p_from
      ) s
      CROSS JOIN LATERAL public.chat_turn_clock(s.session_id) tc
     WHERE tc.out_analyst_id = p_analyst
       AND tc.out_turn_start >= p_from
       AND tc.out_turn_start < p_to
       AND tc.out_outcome IN ('respondido', 'sem_resposta')
  )
  SELECT
    COUNT(*) FILTER (WHERE out_outcome = 'respondido')::integer,
    COUNT(*) FILTER (WHERE out_outcome = 'sem_resposta')::integer,
    -- percentile_cont devolve double precision; o cast explícito é obrigatório no PG 12, que
    -- não converte implicitamente na declaração RETURNS TABLE (o PGlite de teste converte).
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY out_clock_seconds) FILTER (WHERE out_outcome = 'respondido'))::numeric,
    (percentile_cont(0.9) WITHIN GROUP (ORDER BY out_clock_seconds) FILTER (WHERE out_outcome = 'respondido'))::numeric,
    AVG(out_clock_seconds) FILTER (WHERE out_outcome = 'respondido'),
    CASE WHEN COUNT(*) > 0
         THEN 100.0 * COUNT(*) FILTER (WHERE out_outcome = 'sem_resposta') / COUNT(*)
    END
    FROM turnos;
$$;

-- ---------------------------------------------------------------------------
-- 7) 1ª resposta por analista no período (métrica 1 da pontuação)
-- ---------------------------------------------------------------------------
-- Entra, para cada conversa, o tempo do PRIMEIRO turno respondido, desde que quem respondeu
-- seja o analista medido e o turno tenha começado dentro da janela.
CREATE OR REPLACE FUNCTION public.analyst_first_response_metrics(p_analyst UUID, p_from TIMESTAMP WITH TIME ZONE, p_to TIMESTAMP WITH TIME ZONE)
RETURNS TABLE (
  primeira_resposta_mediana NUMERIC,
  primeira_resposta_p90 NUMERIC,
  primeira_resposta_n INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH primeiras AS (
    SELECT first_t.out_clock_seconds
      FROM (
        SELECT DISTINCT a.session_id
          FROM public.chat_assignments a
         WHERE a.assignee_id = p_analyst
           AND a.assigned_at < p_to
           AND COALESCE(a.unassigned_at, 'infinity'::timestamptz) > p_from
      ) s
      CROSS JOIN LATERAL (
        SELECT t.out_clock_seconds, t.out_analyst_id, t.out_turn_start
          FROM public.chat_turn_clock(s.session_id) t
         WHERE t.out_outcome = 'respondido'
         ORDER BY t.out_turn_start
         LIMIT 1
      ) first_t
     WHERE first_t.out_analyst_id = p_analyst
       AND first_t.out_turn_start >= p_from
       AND first_t.out_turn_start < p_to
  )
  SELECT
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY out_clock_seconds))::numeric,
    (percentile_cont(0.9) WITHIN GROUP (ORDER BY out_clock_seconds))::numeric,
    COUNT(*)::integer
    FROM primeiras;
$$;

-- ---------------------------------------------------------------------------
-- 8) Valores das métricas por analista e período (base da pontuação)
-- ---------------------------------------------------------------------------
-- Formato longo: uma métrica nova é só uma nova metric_key, sem migração. definition_version
-- faz parte da chave: mudar uma definição não apaga os valores calculados com a anterior.
-- value NULL = sem dado no período (distinto de zero). sample_n = base do cálculo.
CREATE TABLE IF NOT EXISTS public.analyst_metric_values (
  analyst_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  metric_key TEXT NOT NULL,
  value NUMERIC,
  sample_n INTEGER NOT NULL DEFAULT 0,
  definition_version INTEGER NOT NULL DEFAULT 1,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (analyst_id, period_start, period_end, metric_key, definition_version),
  CONSTRAINT analyst_metric_values_period_check CHECK (period_end > period_start)
);

-- Calcula e grava (ou regrava) todas as métricas de um analista num período. Idempotente:
-- rodar de novo atualiza os valores, sem duplicar linhas. Devolve quantas linhas gravou.
CREATE OR REPLACE FUNCTION public.record_analyst_metrics(
  p_analyst UUID,
  p_from TIMESTAMP WITH TIME ZONE,
  p_to TIMESTAMP WITH TIME ZONE,
  p_definition_version INTEGER DEFAULT 1
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  WITH tm AS (
    SELECT * FROM public.analyst_turn_metrics(p_analyst, p_from, p_to)
  ),
  fm AS (
    SELECT * FROM public.analyst_first_response_metrics(p_analyst, p_from, p_to)
  ),
  valores AS (
    SELECT 'primeira_resposta_mediana'::text AS metric_key, fm.primeira_resposta_mediana::numeric AS value, fm.primeira_resposta_n AS sample_n FROM fm
    UNION ALL SELECT 'primeira_resposta_p90', fm.primeira_resposta_p90, fm.primeira_resposta_n FROM fm
    UNION ALL SELECT 'intervalo_mediana', tm.intervalo_mediana, tm.turnos_respondidos FROM tm
    UNION ALL SELECT 'intervalo_p90', tm.intervalo_p90, tm.turnos_respondidos FROM tm
    UNION ALL SELECT 'intervalo_media', tm.intervalo_media, tm.turnos_respondidos FROM tm
    UNION ALL SELECT 'turnos_respondidos', tm.turnos_respondidos::numeric, tm.turnos_respondidos FROM tm
    UNION ALL SELECT 'turnos_sem_resposta', tm.turnos_sem_resposta::numeric, tm.turnos_sem_resposta FROM tm
    UNION ALL SELECT 'sem_resposta_pct', tm.sem_resposta_pct, tm.turnos_respondidos + tm.turnos_sem_resposta FROM tm
  )
  INSERT INTO public.analyst_metric_values
    (analyst_id, period_start, period_end, metric_key, value, sample_n, definition_version, computed_at)
  SELECT p_analyst, p_from, p_to, v.metric_key, v.value, COALESCE(v.sample_n, 0), p_definition_version, now()
    FROM valores v
  ON CONFLICT (analyst_id, period_start, period_end, metric_key, definition_version)
  DO UPDATE SET value = EXCLUDED.value,
                sample_n = EXCLUDED.sample_n,
                computed_at = EXCLUDED.computed_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
