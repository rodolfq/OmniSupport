-- =========================================================================
-- CREATE ADMIN USER AND PROFILE COMPLETELY
-- =========================================================================

-- Primeiro, criar o usuário no auth.users
DO $$
DECLARE
    new_id UUID := gen_random_uuid();
BEGIN
    -- Verificar se já existe
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@systemsat.com.br') THEN
        INSERT INTO auth.users (
            instance_id, id, aud, role, email, encrypted_password,
            email_confirmed_at, recovery_sent_at, last_sign_in_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
            is_admin
        ) VALUES (
            '00000000-0000-0000-0000-000000000000', 
            new_id, 
            'authenticated', 'authenticated',
            'admin@systemsat.com.br', 
            crypt('admin123', gen_salt('bf')),
            now(), now(), now(),
            '{"provider":"email","providers":["email"]}', 
            '{"name":"Admin Supremo","role":"Administrador"}',
            now(), now(),
            FALSE
        );
        
        -- Criar perfil correspondente
        INSERT INTO public.profiles (
            id, email, name, role, is_admin, lives_in_squad,
            company_id, must_change_password, view_all_company_tickets
        ) VALUES (
            new_id,
            'admin@systemsat.com.br',
            'Admin Supremo',
            'Administrador',
            TRUE,
            TRUE,
            '11111111-1111-4111-8111-111111111111'::UUID,
            FALSE,
            TRUE
        );
        
        RAISE NOTICE 'Admin user created with ID: %', new_id;
    ELSE
        RAISE NOTICE 'Admin user already exists';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Admin setup complete' as result;