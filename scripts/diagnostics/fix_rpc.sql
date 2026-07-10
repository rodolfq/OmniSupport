-- Dropar função existente e recriar corretamente
DROP FUNCTION IF EXISTS public.create_user_account(text, text, text, text) CASCADE;

CREATE OR REPLACE FUNCTION public.create_user_account(
    p_email TEXT,
    p_password TEXT,
    p_name TEXT,
    p_role TEXT DEFAULT 'Cliente'
) RETURNS TABLE (
    user_id UUID,
    email TEXT,
    name TEXT,
    role TEXT,
    error TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_user_id UUID;
    v_role_new TEXT := p_role;
    v_is_admin BOOLEAN := FALSE;
    v_lives_in_squad BOOLEAN := FALSE;
    v_default_company UUID := '11111111-1111-4111-8111-111111111111'::UUID;
BEGIN
    -- Check if user already exists in auth.users
    SELECT u.id INTO v_user_id FROM auth.users u WHERE u.email = p_email;
    
    IF v_user_id IS NOT NULL THEN
        -- User exists, return info
        RETURN QUERY SELECT u.id, u.email, p_name, p_role, NULL::TEXT FROM auth.users u WHERE u.id = v_user_id;
        RETURN;
    END IF;
    
    -- Determine role defaults
    IF p_role IN ('Administrador', 'admin') THEN
        v_is_admin := TRUE;
        v_lives_in_squad := TRUE;
    END IF;
    IF p_role IN ('Equipe', 'support') THEN
        v_lives_in_squad := TRUE;
    END IF;
    
    -- Create user in auth.users
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, recovery_sent_at, last_sign_in_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
        p_email, crypt(p_password, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('name', p_name, 'role', p_role),
        now(), now()
    )
    RETURNING id INTO v_user_id;
    
    -- Create profile (trigger may also do this, but we ensure it)
    INSERT INTO public.profiles (
        id, email, name, role, is_admin, lives_in_squad,
        company_id, must_change_password, view_all_company_tickets
    )
    VALUES (
        v_user_id, p_email, p_name, v_role_new, v_is_admin, v_lives_in_squad,
        v_default_company, TRUE, FALSE
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        role = v_role_new;
    
    -- Create analyst status for support team members
    IF v_lives_in_squad THEN
        INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
        VALUES (v_user_id, FALSE, now(), 0)
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    
    RETURN QUERY SELECT v_user_id, p_email, p_name, p_role, NULL::TEXT;
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT NULL::UUID, p_email, p_name, p_role, SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_account(text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'create_user_account function fixed' as result;