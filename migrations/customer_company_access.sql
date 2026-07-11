UPDATE public.role_permissions
SET permissions = array_append(permissions, 'customers:read')
WHERE role = 'Cliente'
  AND NOT ('customers:read' = ANY(permissions));

UPDATE public.profiles
SET is_admin = TRUE,
    view_all_company_tickets = TRUE
WHERE role = 'Cliente'
  AND company_id IS NOT NULL;
