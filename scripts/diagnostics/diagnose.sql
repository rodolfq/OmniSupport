-- Diagnostic query to check if we can query the profile table
SELECT COUNT(*) as total FROM public.profiles;
SELECT COUNT(*) as total FROM auth.users;

-- Check specific user
SELECT p.id, p.email, p.role, u.email as auth_email 
FROM public.profiles p 
JOIN auth.users u ON p.id = u.id 
WHERE u.email = 'admin@suporte.com';