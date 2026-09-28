-- Tempo de 1ª resposta e duração corretos em chat_histories (2026-09-28).
--
-- Dois defeitos na tela Histórico de Conversas:
--
-- 1) "1ª resposta" vazia ou NEGATIVA. O cálculo era feito no NAVEGADOR sobre as
--    mensagens carregadas na tela e contava como "resposta do analista" qualquer
--    mensagem cujo remetente fosse diferente do cliente — inclusive a do PRÓPRIO
--    cliente quando chega sem remetente (WhatsApp/Pyvon sem contato vinculado; dava
--    0 s, e 0 era gravado como NULL) e a mensagem automática de template enviada
--    horas ANTES da conversa nascer (dava tempo negativo).
-- 2) Duração NEGATIVA. finished_at vinha do relógio do navegador de quem encerrou,
--    e alguns estão 3-4 min atrasados em relação ao servidor.
--
-- Esta migration cria a função que passa a ser a ÚNICA definição de "1ª resposta"
-- (o servidor a usa ao gravar o histórico) e recalcula o que já está gravado.
-- Antes de mexer, guarda uma cópia dos valores antigos em
-- chat_histories_metrics_backup_20260928 (para desfazer, ver o final do arquivo).
--
-- Definição de 1ª resposta = tempo entre a PRIMEIRA mensagem do cliente e a primeira
-- mensagem HUMANA da equipe depois dela:
--   cliente  = veio do WhatsApp/Pyvon (metadata.source), OU remetente que não é da
--              equipe, OU sem remetente e que não é automação. Automação (template,
--              resposta do modo de crise, "SSX Desk ...") nunca é cliente.
--   analista = remetente com papel de equipe, sem origem de canal (o que chega do
--              WhatsApp é do cliente, mesmo quando o cadastro dele tem papel de
--              equipe — conversa de teste), não é template/resposta automática,
--              tem texto ou anexo, e não é nota interna nem mensagem de sistema.
-- NULL = a equipe nunca respondeu o cliente (conversa só do cliente, só do bot, ou
-- iniciada pela equipe sem retorno do cliente). Nunca devolve valor negativo.

CREATE OR REPLACE FUNCTION public.chat_first_response_seconds(p_session_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  WITH cust AS (
    SELECT MIN(c.created_at) AS at
      FROM public.chat_messages c
      LEFT JOIN public.profiles cp ON cp.id = c.sender_id
     WHERE c.session_id = p_session_id
       AND c.type NOT IN ('system', 'internal')
       AND NOT (c.metadata ? 'auto_reply' OR c.metadata ? 'template')
       AND NOT (c.sender_id IS NULL AND c.sender_name LIKE 'SSX Desk%')
       AND (
            COALESCE(c.metadata->>'source', '') IN ('pyvon', 'whatsapp')
         OR cp.id IS NULL
         OR cp.role NOT IN ('Administrador', 'Equipe', 'Time Interno')
       )
  )
  SELECT ROUND(EXTRACT(EPOCH FROM (MIN(r.created_at) - cust.at)))::int
    FROM cust
    JOIN public.chat_messages r
      ON r.session_id = p_session_id
     AND r.created_at > cust.at
     AND r.type NOT IN ('system', 'internal')
     AND COALESCE(r.metadata->>'source', '') NOT IN ('pyvon', 'whatsapp', 'crisis_mode')
     AND NOT (r.metadata ? 'auto_reply' OR r.metadata ? 'template')
     AND ((r.text IS NOT NULL AND r.text <> '')
          OR jsonb_array_length(COALESCE(r.metadata->'attachments', '[]'::jsonb)) > 0)
    JOIN public.profiles rp
      ON rp.id = r.sender_id
     AND rp.role IN ('Administrador', 'Equipe', 'Time Interno')
   GROUP BY cust.at
$$;

-- Cópia dos valores antigos (só cria se ainda não existir — reaplicar a migration não
-- sobrescreve a cópia original).
CREATE TABLE IF NOT EXISTS public.chat_histories_metrics_backup_20260928 AS
  SELECT id, started_at, finished_at, duration_seconds, first_response_seconds
    FROM public.chat_histories;

-- 1ª resposta: recalcula onde a conversa tem mensagens (sem mensagens não há como
-- recalcular — o valor gravado fica, exceto se for negativo).
UPDATE public.chat_histories h
   SET first_response_seconds = public.chat_first_response_seconds(h.session_id)
 WHERE h.session_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.session_id = h.session_id);

UPDATE public.chat_histories
   SET first_response_seconds = NULL
 WHERE first_response_seconds < 0;

-- Fim antes do início (relógio do navegador atrasado): o fim verdadeiro é o da última
-- mensagem da conversa (a de encerramento é gravada pelo servidor). Sem mensagens, fim = início.
UPDATE public.chat_histories h
   SET finished_at = GREATEST(
         h.started_at,
         COALESCE((SELECT MAX(m.created_at) FROM public.chat_messages m WHERE m.session_id = h.session_id), h.started_at)
       )
 WHERE h.finished_at < h.started_at;

UPDATE public.chat_histories
   SET duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (finished_at - started_at))::int)
 WHERE duration_seconds < 0;

-- Para DESFAZER (restaura os valores de antes desta migration):
--   UPDATE public.chat_histories h
--      SET started_at = b.started_at, finished_at = b.finished_at,
--          duration_seconds = b.duration_seconds, first_response_seconds = b.first_response_seconds
--     FROM public.chat_histories_metrics_backup_20260928 b WHERE b.id = h.id;
