-- =========================================================================
-- CLEANUP DUPLICATE FUNCTIONS
-- =========================================================================

-- Dropar todas as funções RPC existentes para recriar
DROP FUNCTION IF EXISTS public.create_user_account(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_user_account(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_user_with_auth(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_reset_user_password(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_complete_delete(uuid) CASCADE;

-- Notificar schema reload
NOTIFY pgrst, 'reload schema';

SELECT 'Functions cleanup completed' as result;