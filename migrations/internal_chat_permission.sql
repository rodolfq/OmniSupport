UPDATE public.role_permissions
SET permissions = array_append(permissions, 'chat:internal')
WHERE name IN ('Administrador', 'Equipe', 'Time Interno')
  AND NOT ('chat:internal' = ANY(COALESCE(permissions, '{}'::text[])));
