-- Pedido do usuário (2026-10-07): trocar o template de "chamar cliente pelo
-- WhatsApp" de contato_pos_vendas pra saudacao_nova, cujo texto referencia
-- {{2}} = NÚMERO DO ATENDIMENTO — não existe chamado ainda numa ligação
-- proativa, então precisa de um identificador que a própria conversa tenha
-- desde que nasce. chat_sessions nunca teve isso (só ticket_number, quando um
-- chamado já existe) — mesmo padrão de tickets.public_ticket_number/ticket_seq.

CREATE SEQUENCE IF NOT EXISTS public.chat_session_seq START 1;

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS public_session_number BIGINT;

-- Preenche quem já existe, na ordem de criação, antes de travar o DEFAULT e o
-- NOT NULL — idempotente (WHERE ... IS NULL não acha nada numa 2ª execução).
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at) AS rn
    FROM public.chat_sessions
   WHERE public_session_number IS NULL
)
UPDATE public.chat_sessions cs
   SET public_session_number = o.rn
  FROM ordered o
 WHERE cs.id = o.id;

SELECT setval('public.chat_session_seq', GREATEST((SELECT COALESCE(MAX(public_session_number), 0) FROM public.chat_sessions), 1), true);

ALTER TABLE public.chat_sessions
  ALTER COLUMN public_session_number SET DEFAULT nextval('public.chat_session_seq'),
  ALTER COLUMN public_session_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_public_session_number
  ON public.chat_sessions (public_session_number);

-- Cadastra o template novo (texto literal aprovado na Meta, só pra preview no
-- nosso chat — ver renderTemplateBody em lib/services/pyvon-service.ts) e
-- desativa o antigo, sem apagar (histórico de mensagens antigas ainda cita
-- "contato_pos_vendas" em metadata/texto salvo).
INSERT INTO public.pyvon_templates (template_name, language, description, variables_schema, is_active, body_text)
SELECT
  'saudacao_nova',
  'pt_BR',
  'Primeiro contato proativo (sem chamado ainda) — usado em "Iniciar Conversa"/"+ Novo WhatsApp" fora da janela de 24h.',
  '[{"key":"1","label":"Nome do contato"},{"key":"2","label":"Número do atendimento"}]'::jsonb,
  true,
  E'Olá, {{1}}! Tudo bem?\n\nFoi gerado o atendimento nº {{2}} em nosso sistema para tratarmos de um assunto relacionado a você.\n\nEstamos entrando em contato para dar continuidade ao atendimento. Quando possível, responda a esta mensagem.\n\nAtenciosamente,\nEquipe Systemsat'
WHERE NOT EXISTS (SELECT 1 FROM public.pyvon_templates WHERE template_name = 'saudacao_nova');

UPDATE public.pyvon_templates SET is_active = false WHERE template_name = 'contato_pos_vendas';
