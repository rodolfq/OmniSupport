-- Diagnostic queries for employee creation issue

-- 1. Check current functions in public schema
SELECT proname, pg_get_function_arguments(p.oid)::text as args
FROM pg_proc p 
JOIN pg_namespace n ON p.pronamespace = n.oid 
WHERE n.nspname = 'public' AND p.proname = 'create_user_account';

-- 2. Check all users count
SELECT COUNT(*) as total_auth_users FROM auth.users;
SELECT COUNT(*) as total_profiles FROM public.profiles;

-- 3. Check last users created
SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 5;
SELECT id, email, name, role FROM public.profiles ORDER BY id DESC LIMIT 5;