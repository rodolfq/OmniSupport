UPDATE public.role_permissions
SET permissions = array_append(permissions, 'settings:system')
WHERE role = 'Administrador'
  AND NOT ('settings:system' = ANY(permissions));
