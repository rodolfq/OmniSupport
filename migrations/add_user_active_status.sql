-- Permite desativar o login de um usuário sem excluir a conta.
-- Todos os usuários existentes continuam ativos (comportamento atual preservado).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
