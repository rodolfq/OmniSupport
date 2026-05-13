-- ==========================================
-- NUCLEAR FIX V8 - THE UUID & RLS REBOOT
-- ==========================================

-- 0. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. LIMPEZA TOTAL DE POLÍTICAS (EVITA CONFLITOS RESIDUAIS)
DO $$ 
DECLARE 
    r RECORD;
BEGIN 
    FOR r IN (
        SELECT policyname, tablename 
        FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename IN ('tickets', 'companies', 'profiles', 'ticket_messages', 'chat_sessions', 'chat_messages')
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- 2. GARANTIR UUID AUTOMÁTICO (CORREÇÃO DO ERRO NULL VALUE IN COLUMN "ID")
ALTER TABLE public.tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.companies ALTER COLUMN id SET DEFAULT gen_random_uuid();
-- Se a tabela profiles usar UUID e não for apenas o ID do auth, adicione aqui. 
-- Normalmente profiles.id = auth.uid(), então não precisa de default gen_random_uuid.

-- 3. GARANTIR RLS ATIVO
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. POLÍTICAS PARA 'COMPANIES'
CREATE POLICY "co_select_v8" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "co_insert_v8" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "co_update_v8" ON public.companies FOR UPDATE TO authenticated USING (public.is_admin());

-- 5. POLÍTICAS PARA 'TICKETS'
-- Insert: Livre para logados (O banco gera o ID e preenche created_by se enviado nulo)
CREATE POLICY "tk_insert_v8" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);

-- Select: Dono, Criador, Atribuído ou Admin
CREATE POLICY "tk_select_v8" ON public.tickets FOR SELECT TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR 
    public.is_admin()
);

-- Update: Dono, Criador, Atribuído ou Admin
CREATE POLICY "tk_update_v8" ON public.tickets FOR UPDATE TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR 
    public.is_admin()
);

-- Delete: Apenas Admin
CREATE POLICY "tk_delete_v8" ON public.tickets FOR DELETE TO authenticated USING (public.is_admin());

-- 6. POLÍTICAS PARA 'PROFILES'
CREATE POLICY "pr_select_v8" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "pr_update_v8" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR public.is_admin());

-- 7. FORÇAR DEFAULTS DE SEGURANÇA NAS COLUNAS
ALTER TABLE tickets ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE tickets ALTER COLUMN customer_id SET DEFAULT auth.uid();

-- 8. RECARREGAR CONFIGURAÇÕES
NOTIFY pgrst, 'reload schema';
