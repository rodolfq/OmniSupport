-- Update role_permissions table with correct structure
-- Run this if role_permissions already exists but needs seed data

-- Clear existing data and re-seed
DELETE FROM public.role_permissions;

-- Re-insert with correct permissions
INSERT INTO public.role_permissions (name, role, permissions) VALUES
  ('Administrador', 'Administrador', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:delete', 'tickets:assign',
    'customers:read', 'customers:write',
    'team:read', 'team:write',
    'settings:read', 'settings:write',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view'
  ]::TEXT[]),
  ('Equipe', 'Equipe', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:assign',
    'customers:read',
    'team:read',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view'
  ]::TEXT[]),
  ('Cliente', 'Cliente', ARRAY[
    'tickets:read', 'tickets:write'
  ]::TEXT[]),
  ('Funcionário', 'Funcionário', ARRAY[]::TEXT[]);