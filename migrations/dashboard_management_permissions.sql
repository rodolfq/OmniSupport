-- Roadmap "Time x Gerencial", etapa 1: concede as 3 novas permissões
-- gerenciais só ao perfil de sistema Administrador (decisão do usuário —
-- nenhum outro perfil ganha acesso nesta etapa; promoção de perfis
-- customizados fica manual, via /permissions, quando houver um "Gerente"
-- de verdade). Mesmo padrão de settings_system_permission.sql/
-- internal_chat_permission.sql: idempotente (array_append só se ainda não
-- tiver), escopado ao perfil global (internal_team_id IS NULL) por causa do
-- índice único parcial (role_permissions_name_scoped_unique.sql).

UPDATE public.role_permissions
SET permissions = array_append(permissions, 'dashboard:management')
WHERE name = 'Administrador'
  AND internal_team_id IS NULL
  AND NOT ('dashboard:management' = ANY(COALESCE(permissions, '{}'::text[])));

UPDATE public.role_permissions
SET permissions = array_append(permissions, 'reports:individual')
WHERE name = 'Administrador'
  AND internal_team_id IS NULL
  AND NOT ('reports:individual' = ANY(COALESCE(permissions, '{}'::text[])));

UPDATE public.role_permissions
SET permissions = array_append(permissions, 'reports:export')
WHERE name = 'Administrador'
  AND internal_team_id IS NULL
  AND NOT ('reports:export' = ANY(COALESCE(permissions, '{}'::text[])));
