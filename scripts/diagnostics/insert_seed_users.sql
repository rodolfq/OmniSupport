-- =========================================================================
-- INSERT SEED USERS DIRECTLY (if RPC didn't create them)
-- =========================================================================

-- Criar usuário admin diretamente no auth.users
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    is_admin
) VALUES (
    '00000000-0000-0000-0000-000000000000', 
    '11111111-1111-4111-8111-111111111111'::UUID, 
    'authenticated', 'authenticated',
    'admin@systemsat.com.br', 
    crypt('admin123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', 
    '{"name":"Admin Supremo","role":"Administrador"}',
    now(), now(),
    FALSE
) ON CONFLICT (email) DO NOTHING;

-- Inserir perfil admin
INSERT INTO public.profiles (
    id, email, name, role, is_admin, lives_in_squad,
    company_id, must_change_password, view_all_company_tickets
) VALUES (
    '11111111-1111-4111-8111-111111111111'::UUID,
    'admin@systemsat.com.br',
    'Admin Supremo',
    'Administrador',
    TRUE,
    TRUE,
    '11111111-1111-4111-8111-111111111111'::UUID,
    FALSE,
    TRUE
) ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = EXCLUDED.role;

-- Criar usuário cliente diretamente no auth.users
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    is_admin
) VALUES (
    '00000000-0000-0000-0000-000000000000', 
    gen_random_uuid(), 
    'authenticated', 'authenticated',
    'jose@cliente.com', 
    crypt('senha123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', 
    '{"name":"José Cliente","role":"Cliente"}',
    now(), now(),
    FALSE
) ON CONFLICT (email) DO NOTHING;

-- Inserir perfil cliente
DO $$
DECLARE
    client_id UUID;
BEGIN
    SELECT id INTO client_id FROM auth.users WHERE email = 'jose@cliente.com';
    
    IF client_id IS NOT NULL THEN
        INSERT INTO public.profiles (
            id, email, name, role, is_admin, lives_in_squad,
            company_id, must_change_password, view_all_company_tickets
        ) VALUES (
            client_id,
            'jose@cliente.com',
            'José Cliente',
            'Cliente',
            FALSE,
            FALSE,
            '11111111-1111-4111-8111-111111111111'::UUID,
            FALSE,
            FALSE
        ) ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Seed users inserted' as result;