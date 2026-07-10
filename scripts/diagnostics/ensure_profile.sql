-- Criar perfil para admin@suporte.com caso não exista
DO $$
DECLARE
    user_id UUID;
BEGIN
    SELECT id INTO user_id FROM auth.users WHERE email = 'admin@suporte.com';
    
    IF user_id IS NOT NULL THEN
        INSERT INTO public.profiles (
            id, email, name, role, is_admin, lives_in_squad,
            company_id, must_change_password, view_all_company_tickets
        ) VALUES (
            user_id,
            'admin@suporte.com',
            'Admin Suporte',
            'Administrador',
            TRUE,
            TRUE,
            '11111111-1111-4111-8111-111111111111'::UUID,
            FALSE,
            TRUE
        ) ON CONFLICT (id) DO UPDATE SET
            role = 'Administrador',
            is_admin = TRUE;
        
        RAISE NOTICE 'Perfil criado/atualizado para admin@suporte.com';
    ELSE
        RAISE NOTICE 'Usuário admin@suporte.com não existe em auth.users - execute create_admin_suporte.sql primeiro';
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Profile ensured for admin@suporte.com' as result;