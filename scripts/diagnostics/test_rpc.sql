-- Verificar estrutura da tabela profiles
SELECT column_name, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'profiles' 
ORDER BY ordinal_position;

-- Testar RPC manualmente (substitua dados de teste)
SELECT * FROM public.create_user_account('teste@exemplo.com', 'teste123', 'Usuario Teste', 'Funcionário') as result;