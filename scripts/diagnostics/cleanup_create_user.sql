-- Dropar todas as versões da função create_user_account
DROP FUNCTION IF EXISTS public.create_user_account(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_user_account(text, text, text, text, uuid, text, boolean) CASCADE;

NOTIFY pgrst, 'reload schema';

SELECT 'Functions cleaned' as result;