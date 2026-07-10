-- Verificar policies RLS
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' AND tablename IN ('profiles', 'auth.users');

-- Verificar se policies permissive_all existem
SELECT * FROM pg_policies WHERE policyname = 'permissive_all' AND schemaname = 'public';

-- Garantir que RLS está desativado
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY;

-- Recarregar schema
NOTIFY pgrst, 'reload schema';

SELECT 'RLS disabled for profiles and companies' as result;