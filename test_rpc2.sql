-- Teste manual da RPC com logs
SELECT id, email, name, role, error FROM public.create_user_account('teste2@exemplo.com', 'senha123', 'Usuario Teste', 'Funcionário');

-- Verificar se foi criado
SELECT id, email FROM auth.users WHERE email = 'teste2@exemplo.com';
SELECT id, email FROM public.profiles WHERE email = 'teste2@exemplo.com';