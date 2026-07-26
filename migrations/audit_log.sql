-- Log de alterações do sistema (quem fez o quê, quando) — cobre as ações
-- administrativas mais sensíveis (empresas, usuários, filas, hotfixes,
-- perfis de acesso). actor_id pode ficar nulo se o autor for excluído depois
-- (ON DELETE SET NULL) — por isso actor_name é sempre gravado como uma foto
-- do nome no momento da ação, pra nunca perder essa informação.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create' | 'update' | 'delete' | outro verbo curto
  entity_type TEXT NOT NULL, -- 'company' | 'user' | 'queue' | 'hotfix' | 'access_profile' | ...
  entity_id TEXT,
  entity_label TEXT, -- nome legível (nome da empresa, do usuário etc.) no momento da ação
  changes JSONB, -- campos alterados, quando fizer sentido registrar
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON public.audit_log(actor_id);
