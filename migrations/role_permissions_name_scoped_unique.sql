-- Nome de Perfil de Acesso deixa de ser único globalmente e passa a ser único
-- só dentro do mesmo escopo (mesma equipe, ou nível global) — duas equipes
-- diferentes podem ter cada uma um perfil chamado "Acesso" sem colidir.
-- Dois índices parciais em vez de UNIQUE(name, internal_team_id) porque
-- NULL != NULL pro Postgres: um único índice composto não pegaria dois
-- perfis globais (internal_team_id nulo) com o mesmo nome.

ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS role_permissions_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_name_global_idx
  ON public.role_permissions (name) WHERE internal_team_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_name_team_idx
  ON public.role_permissions (name, internal_team_id) WHERE internal_team_id IS NOT NULL;
