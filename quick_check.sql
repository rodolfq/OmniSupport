-- Verificação completa
SELECT 'AUTH USERS:' as section, email, id FROM auth.users;
SELECT 'PROFILES:' as section, email, name, role FROM public.profiles;
SELECT 'COMPANIES:' as section, name FROM public.companies;