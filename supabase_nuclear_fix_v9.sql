-- ==========================================
-- NUCLEAR FIX V9 - SUPORTE TOTAL RLS & UUID
-- ==========================================

-- 0. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABELAS ADICIONAIS (CASO NÃO EXISTAM)
CREATE TABLE IF NOT EXISTS public.user_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    reason TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT now(),
    duration INTEGER
);

CREATE TABLE IF NOT EXISTS public.absence_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL
);

-- 2. GARANTIR UUID AUTOMÁTICO E DEFAULTS
ALTER TABLE public.tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.companies ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tickets ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.tickets ALTER COLUMN customer_id SET DEFAULT auth.uid();

-- 3. FUNÇÃO IS_ADMIN REFORÇADA
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS BOOLEAN AS $$
DECLARE
  u_email TEXT;
BEGIN
  u_email := auth.jwt() ->> 'email';
  IF u_email = 'admin@systemsat.com.br' OR u_email = 'rodolfo.design23@gmail.com' THEN
    RETURN TRUE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (is_admin = true OR role IN ('Administrador', 'Equipe', 'Admin'))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. LIMPEZA DE POLÍTICAS CONFLITANTES
DO $$ 
DECLARE r RECORD;
BEGIN 
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- 5. POLÍTICAS: COMPANIES (EMPRESAS)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "co_select_v9" ON public.companies FOR SELECT USING (true); -- Permitir ver empresas mesmo anon (onboarding)
CREATE POLICY "co_all_v9" ON public.companies FOR ALL TO authenticated USING (public.is_admin());

-- 6. POLÍTICAS: PROFILES (PERFIS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_select_v9" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "pr_insert_v9" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id OR public.is_admin());
CREATE POLICY "pr_update_v9" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR public.is_admin());

-- 7. POLÍTICAS: TICKETS
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tk_insert_v9" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tk_all_v9" ON public.tickets FOR ALL TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR 
    public.is_admin()
);

-- 8. POLÍTICAS: ANALYST_STATUS & HISTORY
ALTER TABLE public.analyst_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "as_select_v9" ON public.analyst_status FOR SELECT TO authenticated USING (true);
CREATE POLICY "as_update_v9" ON public.analyst_status FOR ALL TO authenticated USING (user_id = auth.uid() OR public.is_admin());

ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ush_all_v9" ON public.user_status_history FOR ALL TO authenticated USING (user_id = auth.uid() OR public.is_admin());

-- 9. OUTRAS TABELAS (CHATS E CONFIGS)
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs_all_v9" ON public.chat_sessions FOR ALL TO authenticated USING (true);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cm_all_v9" ON public.chat_messages FOR ALL TO authenticated USING (true);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tm_all_v9" ON public.ticket_messages FOR ALL TO authenticated USING (true);

-- RECARREGAR
NOTIFY pgrst, 'reload schema';
