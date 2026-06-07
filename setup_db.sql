-- =========================================================================
-- ULTIMATE DATABASE SETUP - DISABLES ALL SECURITY, JUST MAKES IT WORK
-- =========================================================================

-- Desativar RLS em todas as tabelas existentes
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
        RAISE NOTICE 'RLS disabled for %', tbl;
    END LOOP;
END $$;

-- Criar policies permissivas simples para cada tabela
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS permissive_all ON public.%I', tbl);
        EXECUTE format('CREATE POLICY permissive_all ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', tbl);
    END LOOP;
END $$;

-- Dropar funções duplicadas
DROP FUNCTION IF EXISTS public.create_user_account(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_user_account(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_user_with_auth(text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_reset_user_password(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.admin_complete_delete(uuid) CASCADE;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy (permite tudo)
DROP POLICY IF EXISTS "Allow All Storage Access" ON storage.objects;
CREATE POLICY "Allow All Storage Access" ON storage.objects 
  FOR ALL TO authenticated, anon 
  USING (true) 
  WITH CHECK (true);

-- Realtime - use separate ALTER without IF NOT EXISTS
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
EXCEPTION WHEN duplicate_object THEN
    -- já existe, ignora
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ticket_messages;
EXCEPTION WHEN duplicate_object THEN
    -- já existe, ignora
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
EXCEPTION WHEN duplicate_object THEN
    -- já existe, ignora
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
EXCEPTION WHEN duplicate_object THEN
    -- já existe, ignora
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Database setup completed - all security disabled' as result;