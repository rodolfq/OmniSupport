-- ==========================================
-- NUCLEAR RLS REBOOT (SOLUÇÃO DEFINITIVA)
-- ==========================================

-- 1. LIMPEZA TOTAL DE POLICIES ANTIGAS (EVITA DUPLICIDADE E CONFLITOS)
DO $$ 
DECLARE 
    tab RECORD;
BEGIN 
    FOR tab IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('tickets', 'companies', 'profiles')) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %s ON public.%s', 'tickets_nuclear_insert', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS %s ON public.%s', 'tickets_nuclear_select', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS %s ON public.%s', 'tickets_nuclear_update', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admins full manage companies', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow authenticated read', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Anyone can view companies', tab.tablename);
    END LOOP;
END $$;

-- 2. RESET TOTAL DE TICKETS
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tickets_v6_all" ON public.tickets;

-- Permissões CRUD para TICKETS (V6)
CREATE POLICY "tickets_v6_insert" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "tickets_v6_select" ON public.tickets FOR SELECT TO authenticated USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR
    public.is_admin()
);
CREATE POLICY "tickets_v6_update" ON public.tickets FOR UPDATE TO authenticated USING (
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR
    public.is_admin()
);
CREATE POLICY "tickets_v6_delete" ON public.tickets FOR DELETE TO authenticated USING (public.is_admin());

-- 3. RESET TOTAL DE COMPANIES
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "companies_v6_all" ON public.companies;

-- Permissões CRUD para COMPANIES (V6)
-- IMPORTANTE: Permitir insert para todos autenticados para viabilizar onboarding
CREATE POLICY "companies_v6_insert" ON public.companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "companies_v6_select" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "companies_v6_update" ON public.companies FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "companies_v6_delete" ON public.companies FOR DELETE TO authenticated USING (public.is_admin());

-- 4. GARANTIR QUE COLUNAS DEFAULT FUNCIONAM
ALTER TABLE tickets ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE tickets ALTER COLUMN customer_id SET DEFAULT auth.uid();

-- 5. RECARREGAR
NOTIFY pgrst, 'reload schema';
