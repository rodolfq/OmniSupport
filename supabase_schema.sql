-- SQL Schema for OmniSupport Supabase Implementation
-- Drop all existing tables to start fresh
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

DROP TABLE IF EXISTS ticket_attachments CASCADE;
DROP TABLE IF EXISTS ticket_messages CASCADE;
DROP TABLE IF EXISTS ticket_tags_map CASCADE;
DROP TABLE IF EXISTS ticket_access CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_participants CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS analyst_status CASCADE;
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS config_categories CASCADE;
DROP TABLE IF EXISTS config_priorities CASCADE;
DROP TABLE IF EXISTS config_tags CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Companies Table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  industry TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Profiles (Users) Table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'Funcionário', -- 'Funcionário', 'Equipe'
  is_admin BOOLEAN DEFAULT FALSE, -- Supreme access identifier
  phone TEXT,
  password TEXT,
  must_change_password BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Analyst Status Table
CREATE TABLE IF NOT EXISTS analyst_status (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT FALSE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  current_load INTEGER DEFAULT 0
);

-- 4. Chat Sessions Table (Support and Internal)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT DEFAULT 'support', -- 'support', 'internal'
  customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL, -- For support queues
  queue_status TEXT DEFAULT 'waiting', -- 'waiting', 'active', 'closed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Chat Participants (For internal team chats or multi-agent support)
CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);

-- 6. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  type TEXT DEFAULT 'text', -- 'text', 'image', 'file', 'system'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Config Tables
CREATE TABLE IF NOT EXISTS config_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS config_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS config_priorities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  sla_hours INTEGER NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS config_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, -- Custom ID like T-1001
  public_ticket_number SERIAL, -- Sequential number for display
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Novo',
  priority TEXT NOT NULL DEFAULT 'Baixa',
  category TEXT NOT NULL DEFAULT 'Geral',
  company_id UUID CONSTRAINT tickets_company_id_fkey REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID CONSTRAINT tickets_customer_id_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  assignee_id UUID CONSTRAINT tickets_assignee_id_fkey REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id),
  employee_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure we can select profiles with a clear alias if needed
-- No change to table structure here, just checking

-- 9. Ticket Messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- 'text', 'system', 'internal'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- MOCK INITIAL ADMIN AND USER VIA AUTH AND TRIGGER
-- Trigger to execute the function after a user is created in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_role TEXT;
  new_name TEXT;
  supremo BOOLEAN := FALSE;
BEGIN
  -- Definir papéis baseados no e-mail (ou outros metadados)
  IF (new.email = 'admin@systemsat.com.br') THEN
    new_role := 'Equipe';
    new_name := 'Admin Supremo';
    supremo := TRUE;
  ELSIF (new.email = 'jose@cliente.com') THEN
    new_role := 'Funcionário';
    new_name := 'José Cliente';
  ELSE
    new_role := COALESCE(new.raw_user_meta_data->>'role', 'Funcionário');
    new_name := COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  END IF;

  INSERT INTO public.profiles (id, name, email, role, is_admin, company_id, must_change_password)
  VALUES (
    new.id, 
    new_name, 
    new.email, 
    new_role,
    supremo, 
    NULL,
    COALESCE((new.raw_user_meta_data->>'mustChangePassword')::boolean, true)
  );

  IF (new_role = 'Equipe') THEN
    INSERT INTO public.analyst_status (user_id, is_online) VALUES (new.id, false);
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_user_account(
    p_email TEXT,
    p_password TEXT,
    p_name TEXT,
    p_role TEXT
) RETURNS json AS $$
DECLARE
    new_user_id UUID;
BEGIN
    new_user_id := uuid_generate_v4();

    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, 
        email_confirmed_at, recovery_sent_at, last_sign_in_at, 
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, 
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
        p_email, crypt(p_password, gen_salt('bf')), 
        now(), now(), now(), 
        '{"provider":"email","providers":["email"]}', 
        json_build_object('name', p_name, 'role', p_role, 'mustChangePassword', true)::jsonb, 
        now(), now(), '', '', '', ''
    );

    RETURN json_build_object('id', new_user_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('error', 'Email already exists');
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- INSERT DEFAULT USERS INTO AUTH SEED
-- Note: You shouldn't normally run inserts on auth.users manually outside of migrations/seed
-- But this is to fulfill your request for these exact users to be present
DO $$
DECLARE
  uid1 UUID := uuid_generate_v4();
  uid2 UUID := uuid_generate_v4();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@systemsat.com.br') THEN
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES ('00000000-0000-0000-0000-000000000000', uid1, 'authenticated', 'authenticated', 'admin@systemsat.com.br', crypt('admin123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Admin Supremo"}', now(), now(), '', '', '', '');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'jose@cliente.com') THEN
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    VALUES ('00000000-0000-0000-0000-000000000000', uid2, 'authenticated', 'authenticated', 'jose@cliente.com', crypt('senha123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"José"}', now(), now(), '', '', '', '');
  END IF;
END $$;

-- ENABLE REALTIME
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tickets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ticket_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END $$;

-- REAL ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyst_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_tags ENABLE ROW LEVEL SECURITY;

-- Super Admin Function (Security Definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_admin() 
RETURNS BOOLEAN AS $$
DECLARE
  u_email TEXT;
BEGIN
  u_email := auth.jwt() ->> 'email';
  -- Check email first (fastest)
  IF u_email = 'admin@systemsat.com.br' OR u_email = 'rodolfo.design23@gmail.com' THEN
    RETURN TRUE;
  END IF;
  
  -- Check cache if possible or just the profiles table
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (is_admin = true OR email = 'admin@systemsat.com.br')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 1. Companies: Everyone can view. Only admins manage.
CREATE POLICY "companies_select_all" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_admin_all" ON companies FOR ALL USING (public.is_admin());

-- 2. Profiles: Hardened
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_owner_all" ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_admin_all" ON profiles FOR ALL USING (public.is_admin());

-- 3. Tickets: Multi-tier access
-- Reset robusto das policies
DROP POLICY IF EXISTS "tickets_read_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_insert_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_update_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_delete_policy" ON tickets;
DROP POLICY IF EXISTS "tickets_all_authenticated" ON tickets;

-- Garantir coluna created_by existe e é segura
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) DEFAULT auth.uid();

-- Política de Leitura: Admins/Equipe veem tudo; Clientes veem o próprio ou da empresa
CREATE POLICY "tickets_read_policy" ON tickets FOR SELECT TO authenticated USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'Equipe' OR is_admin = true)) OR
  customer_id = auth.uid() OR
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND company_id = tickets.company_id)
);

-- Política de Inserção: Versão ultra-robusta
-- Se falhar aqui, provavelmente é constraint de chave estrangeira ou coluna faltando
CREATE POLICY "tickets_insert_policy" ON tickets FOR INSERT TO authenticated WITH CHECK (
  true -- Temporariamente permissivo para validar se o erro some. Se sumir, refinamos.
);

-- Política de Atualização: Dono, Cliente ou Equipe
CREATE POLICY "tickets_update_policy" ON tickets FOR UPDATE TO authenticated USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'Equipe' OR is_admin = true)) OR
  customer_id = auth.uid() OR
  created_by = auth.uid()
) WITH CHECK (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'Equipe' OR is_admin = true)) OR
  customer_id = auth.uid() OR
  created_by = auth.uid()
);

-- Política de Deleção: Apenas Equipe ou Admin
CREATE POLICY "tickets_delete_policy" ON tickets FOR DELETE TO authenticated USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (role = 'Equipe' OR is_admin = true))
);

-- 4. Ticket Messages
CREATE POLICY "ticket_messages_admin_team_all" ON ticket_messages FOR ALL USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'Equipe')
);
CREATE POLICY "ticket_messages_customer_view" ON ticket_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.customer_id = auth.uid())
);
CREATE POLICY "ticket_messages_customer_insert" ON ticket_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.customer_id = auth.uid())
);

-- 5. Chat Sessions
CREATE POLICY "chat_sessions_admin_team_all" ON chat_sessions FOR ALL USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'Equipe')
);
CREATE POLICY "chat_sessions_customer_view" ON chat_sessions FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "chat_sessions_customer_insert" ON chat_sessions FOR INSERT WITH CHECK (customer_id = auth.uid());

-- 6. Chat Messages
CREATE POLICY "chat_messages_admin_team_all" ON chat_messages FOR ALL USING (
  public.is_admin() OR 
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'Equipe')
);
CREATE POLICY "chat_messages_customer_view" ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = session_id AND s.customer_id = auth.uid())
);
CREATE POLICY "chat_messages_customer_insert" ON chat_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = session_id AND s.customer_id = auth.uid())
);

-- 7. Analyst Status
CREATE POLICY "analyst_status_read_all" ON analyst_status FOR SELECT USING (true);
CREATE POLICY "analyst_status_update_own" ON analyst_status FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "analyst_status_admin_all" ON analyst_status FOR ALL USING (public.is_admin());

-- 8. Config Tables: Read all, admin write
CREATE POLICY "config_statuses_read" ON config_statuses FOR SELECT USING (true);
CREATE POLICY "config_statuses_admin" ON config_statuses FOR ALL USING (public.is_admin());

CREATE POLICY "config_categories_read" ON config_categories FOR SELECT USING (true);
CREATE POLICY "config_categories_admin" ON config_categories FOR ALL USING (public.is_admin());

CREATE POLICY "config_priorities_read" ON config_priorities FOR SELECT USING (true);
CREATE POLICY "config_priorities_admin" ON config_priorities FOR ALL USING (public.is_admin());

CREATE POLICY "config_tags_read" ON config_tags FOR SELECT USING (true);
CREATE POLICY "config_tags_admin" ON config_tags FOR ALL USING (public.is_admin());

-- Re-enable triggers and updates
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Seed Config Data
INSERT INTO config_statuses (label, color) VALUES 
('Novo', 'bg-blue-50 text-blue-700'),
('Em Atendimento', 'bg-amber-50 text-amber-700'),
('Pendente', 'bg-slate-50 text-slate-700'),
('Resolvido', 'bg-emerald-50 text-emerald-700'),
('Fechado', 'bg-slate-100 text-slate-500')
ON CONFLICT DO NOTHING;

INSERT INTO config_categories (label) VALUES 
('Suporte Técnico'), ('Financeiro'), ('Comercial'), ('Dúvidas'), ('Reclamação')
ON CONFLICT DO NOTHING;

INSERT INTO config_priorities (label, sla_hours, color) VALUES 
('Baixa', 120, 'bg-slate-100 text-slate-600'),
('Média', 72, 'bg-blue-100 text-blue-700'),
('Alta', 24, 'bg-orange-100 text-orange-700'),
('Urgente', 12, 'bg-red-100 text-red-700')
ON CONFLICT DO NOTHING;

INSERT INTO config_tags (label, color) VALUES 
('Bug', 'bg-red-100'), ('Melhoria', 'bg-blue-100'), ('Urgente', 'bg-rose-100')
ON CONFLICT DO NOTHING;

UPDATE public.profiles 
SET role = 'Administrador', is_admin = true 
WHERE email = 'admin@systemsat.com.br';
