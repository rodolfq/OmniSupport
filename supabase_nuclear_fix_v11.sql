-- ==========================================
-- NUCLEAR SIMPLIFICATION V11 - FULL AUTH ACCESS
-- ==========================================

-- 1. DESABILITAR RLS TEMPORARIAMENTE OU CRIAR POLÍTICAS GLOBAIS
-- Vamos manter o RLS ativo mas com políticas que permitem TUDO para usuários AUTENTICADOS.

DO $$ 
DECLARE 
    tab RECORD;
BEGIN 
    FOR tab IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
    LOOP 
        -- Dropa todas as políticas existentes para a tabela
        EXECUTE format('DROP POLICY IF EXISTS "authenticated_full_access" ON public.%I', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS "Allow All for Authenticated" ON public.%I', tab.tablename);
        EXECUTE format('DROP POLICY IF EXISTS "Enable all for authenticated" ON public.%I', tab.tablename);
        -- Adicione aqui outras políticas conhecidas se necessário ou use um script mais agressivo
    END LOOP;
END $$;

-- 2. FUNÇÃO AUXILIAR PARA CRIAR POLÍTICA GLOBAL
CREATE OR REPLACE FUNCTION create_global_policy(table_name TEXT) RETURNS VOID AS $$
BEGIN
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "global_auth_all" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "global_auth_all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', table_name);
END;
$$ LANGUAGE plpgsql;

-- 3. APLICAR EM TODAS AS TABELAS PRINCIPAIS
SELECT create_global_policy('profiles');
SELECT create_global_policy('tickets');
SELECT create_global_policy('ticket_messages');
SELECT create_global_policy('chat_sessions');
SELECT create_global_policy('chat_messages');
SELECT create_global_policy('companies');
SELECT create_global_policy('analyst_status');
SELECT create_global_policy('user_status_history');
SELECT create_global_policy('absence_reasons');
SELECT create_global_policy('config_tags');
SELECT create_global_policy('config_priorities');

-- 4. CORREÇÃO DA SEQUÊNCIA DE TICKETS (O PROBLEMA DO NULL)
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1000;
ALTER TABLE public.tickets ALTER COLUMN public_ticket_number SET DEFAULT nextval('ticket_number_seq');

-- 5. GARANTIR UUIDS E DEFAULTS
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tickets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.ticket_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.chat_sessions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.chat_messages ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tickets ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.ticket_messages ALTER COLUMN created_at SET DEFAULT now();

-- 6. TRIGGER DE PERFIL ROBUSTA (Sempre cria perfil no signup)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, is_admin)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    CASE 
      WHEN new.email = 'admin@systemsat.com.br' THEN 'Administrador'
      ELSE 'Cliente'
    END,
    CASE 
      WHEN new.email = 'admin@systemsat.com.br' THEN true
      ELSE false
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-aplicar trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. NOTIFICAR RECARGA
NOTIFY pgrst, 'reload schema';
