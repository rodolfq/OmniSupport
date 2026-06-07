-- Drop existing function
DROP FUNCTION IF EXISTS public.create_user_profile_only(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_user_profile_only(UUID, TEXT, TEXT, TEXT, UUID);

-- Simple RPC that creates just the profile (auth user must be created via signup or admin API)
CREATE OR REPLACE FUNCTION public.create_user_profile_only(
 p_id UUID,
 p_email TEXT,
 p_name TEXT,
 p_role TEXT,
 p_company_id UUID DEFAULT NULL
) RETURNS TABLE (
 user_id UUID,
 user_email TEXT,
 user_name TEXT,
 user_role TEXT,
 error_msg TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
 v_company UUID := COALESCE(p_company_id, '11111111-1111-4111-8111-111111111111'::UUID);
 v_is_admin BOOLEAN := FALSE;
 v_lives_in_squad BOOLEAN := FALSE;
BEGIN
 -- Determine role defaults
 IF p_role IN ('Administrador', 'admin') THEN
   v_is_admin := TRUE;
   v_lives_in_squad := TRUE;
 END IF;
 IF p_role IN ('Equipe', 'support') THEN
   v_lives_in_squad := TRUE;
 END IF;

 -- Insert profile only
 INSERT INTO public.profiles (
   id, email, name, role, is_admin, lives_in_squad,
   company_id, must_change_password, view_all_company_tickets
 )
 VALUES (
   p_id, 
   p_email, 
   p_name, 
   p_role, 
   v_is_admin, 
   v_lives_in_squad,
   v_company, 
   TRUE, 
   FALSE
 )
 ON CONFLICT (id) DO UPDATE SET
   email = EXCLUDED.email,
   name = EXCLUDED.name,
   role = EXCLUDED.role;

 -- Create analyst status for support team members
 IF v_lives_in_squad THEN
   INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
   VALUES (p_id, FALSE, now(), 0)
   ON CONFLICT (user_id) DO NOTHING;
 END IF;

 RETURN QUERY SELECT 
   p_id,
   p_email,
   p_name,
   p_role,
   NULL::TEXT;
   
EXCEPTION
 WHEN OTHERS THEN
   RETURN QUERY SELECT 
     NULL::UUID,
     p_email,
     p_name,
     p_role,
     SQLERRM::TEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_profile_only(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role;