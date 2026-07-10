-- ==========================================
-- NUCLEAR FIX V7 (SOLUÇÃO DEFINITIVA)
-- ==========================================

-- 1. LIMPEZA AGRESSIVA DE TODAS AS POLÍTICAS DAS TABELAS CHAVE
DO $$ 
DECLARE 
    r RECORD;
BEGIN 
    -- Deleta TODAS as policies das tabelas especificadas, não importa o nome
    FOR r IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN ('tickets', 'companies', 'profiles', 'ticket_messages', 'chat_sessions', 'chat_messages')
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- 2. GARANTIR RLS ATIVO
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. POLÍTICAS PARA 'COMPANIES' (O erro que você viu agora)
-- Permitir SELECT para qualquer um logado
CREATE POLICY "co_select_v7" ON public.companies FOR SELECT TO authenticated USING (true);
-- Permitir INSERT para qualquer um logado (unblock onboarding)
CREATE POLICY "co_insert_v7" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
-- Update/Delete apenas para Admin
CREATE POLICY "co_admin_v7" ON public.companies FOR ALL TO authenticated USING (public.is_admin());

-- 4. POLÍTICAS PARA 'TICKETS'
-- Insert: Livre para logados
CREATE POLICY "tk_insert_v7" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
-- Select: Dono, Atribuído ou Admin
CREATE POLICY "tk_select_v7" ON public.tickets FOR SELECT TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR 
    public.is_admin()
);
-- Update: Dono, Atribuído ou Admin
CREATE POLICY "tk_update_v7" ON public.tickets FOR UPDATE TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR 
    public.is_admin()
);

-- 5. POLÍTICAS PARA 'PROFILES'
CREATE POLICY "pr_all_v7" ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. FORÇAR DEFAULTS DE SEGURANÇA
ALTER TABLE tickets ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE tickets ALTER COLUMN customer_id SET DEFAULT auth.uid();

-- 7. RECARREGAR POSTGREST
NOTIFY pgrst, 'reload schema';
