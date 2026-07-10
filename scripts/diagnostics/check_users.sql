-- Query simples para verificar usuários
SELECT au.email as auth_email, p.role, p.name 
FROM auth.users au 
LEFT JOIN public.profiles p ON au.id = p.id;