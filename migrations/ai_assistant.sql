-- Agente de IA (widget flutuante) — busca em chat com cliente, chat de
-- grupo interno, chamados e tickets internos via Groq com function-calling
-- (busca por palavra-chave/SQL direto, sem embeddings/pgvector nesta v1).
--
-- ai_assistant_messages é só um LOG (auditoria de quem perguntou o quê e
-- quais buscas o agente fez pra responder) — não é a fonte de verdade do
-- histórico da conversa, que o client mantém em memória e reenvia a cada
-- pergunta. Nunca bloqueia a resposta ao usuário se a gravação falhar (ver
-- lib/services/ai-assistant-service.ts, mesmo padrão de lib/audit-log.ts).
CREATE TABLE IF NOT EXISTS public.ai_assistant_messages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'model'
  content TEXT NOT NULL,
  tool_calls JSONB, -- quais funções de busca foram chamadas (nome + args) pra gerar a resposta — null pra mensagens do usuário
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_conversation ON public.ai_assistant_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_user ON public.ai_assistant_messages(user_id, created_at);

-- Libera o uso do agente pra quem já é Equipe/Time Interno hoje, sem exigir
-- que um admin vá lá conceder manualmente perfil por perfil — só nos
-- perfis de acesso (role_permissions) que algum profile com esse role usa
-- de verdade, pra não vazar a permissão pra perfis usados só por
-- Cliente/Funcionário. Administrador já tem tudo automaticamente
-- (lib/nav-items.ts#getUserPermissions), não precisa de UPDATE aqui.
UPDATE public.role_permissions
SET permissions = array_append(permissions, 'ai:assistant')
WHERE id IN (
  SELECT DISTINCT access_profile_id
  FROM public.profiles
  WHERE role IN ('Equipe', 'Time Interno') AND access_profile_id IS NOT NULL
)
AND NOT ('ai:assistant' = ANY(permissions));
