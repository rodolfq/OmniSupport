-- Inserir perfil admin (se faltar)
DO $$
DECLARE
    admin_id UUID;
BEGIN
    -- Encontrar o ID do admin no auth.users
    SELECT id INTO admin_id FROM auth.users WHERE email = 'admin@systemsat.com.br';
    
    IF admin_id IS NOT NULL THEN
        -- Inserir perfil se não existir
        INSERT INTO public.profiles (
            id, email, name, role, is_admin, lives_in_squad,
            company_id, must_change_password, view_all_company_tickets
        ) VALUES (
            admin_id,
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
        
        RAISE NOTICE 'Admin profile ensured';
    ELSE
        RAISE NOTICE 'Admin user not found in auth.users - need to create it';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';