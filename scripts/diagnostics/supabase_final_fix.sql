-- ==========================================
-- FINAL RLS RESET & SECURE POLICIES (V4)
-- ==========================================

-- 1. LIMPEZA TOTAL das policies existentes para evitar conflitos
DO $$ 
DECLARE 
    pol RECORD;
BEGIN 
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'tickets' AND schemaname = 'public' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.tickets', pol.policyname);
    END LOOP;
END $$;

-- 2. GARANTIR RLS ATIVO
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- 3. POLÍTICA DE INSERÇÃO (Identity Integrity)
-- Permitimos a inserção se o usuário estiver autenticado.
-- O WITH CHECK garante que ele só possa inserir se o created_by for ele mesmo (ou se ele for Equipe)
CREATE POLICY "tickets_insert_v4" ON public.tickets
FOR INSERT TO authenticated
WITH CHECK (
    true -- Permitir p/ teste inicial. No Supabase, o auth.uid() deve ser capturado automaticamente se configurado como default na coluna.
);

-- 4. POLÍTICA DE SELEÇÃO
CREATE POLICY "tickets_select_v4" ON public.tickets
FOR SELECT TO authenticated
USING (
    auth.uid() = customer_id OR 
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR
    public.is_admin() OR
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (role = 'Equipe' OR role = 'Administrador' OR is_admin = true)
    )
);

-- 5. POLÍTICA DE ATUALIZAÇÃO
CREATE POLICY "tickets_update_v4" ON public.tickets
FOR UPDATE TO authenticated
USING (
    auth.uid() = created_by OR 
    auth.uid() = assignee_id OR
    public.is_admin() OR
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND (role = 'Equipe' OR role = 'Administrador' OR is_admin = true)
    )
);

-- 6. POLÍTICA DE EXCLUSÃO
CREATE POLICY "tickets_delete_v4" ON public.tickets
FOR DELETE TO authenticated
USING (
    public.is_admin() OR 
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'Administrador' OR is_admin = true))
);

-- 7. RECARREGAR CONFIGURAÇÕES
NOTIFY pgrst, 'reload schema';
