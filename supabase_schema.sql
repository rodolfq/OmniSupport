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
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  priority TEXT NOT NULL DEFAULT 'Low',
  category TEXT NOT NULL DEFAULT 'General',
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  employee_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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

-- Profiles: Anyone can view (to resolve names). Own profile updates. Admin updates.
CREATE POLICY "Everyone views profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Own profile update" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Admins full manage profiles" ON profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles px WHERE px.id = auth.uid() AND px.is_admin = true)
);

-- Tickets: Equipe sees all. Funcionario sees own. Funcionario can insert. Funcionario cannot edit ticket core data.
CREATE POLICY "Equipe full tickets" ON tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles px WHERE px.id = auth.uid() AND px.role = 'Equipe')
);
CREATE POLICY "Funcionario view own tickets" ON tickets FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "Funcionario insert own tickets" ON tickets FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Ticket Messages: Equipe sees and inserts all. Funcionario sees/inserts on their customer_id associated tickets.
CREATE POLICY "Equipe full ticket messages" ON ticket_messages FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles px WHERE px.id = auth.uid() AND px.role = 'Equipe')
);
CREATE POLICY "Funcionario view own ticket messages" ON ticket_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_messages.ticket_id AND t.customer_id = auth.uid())
);
CREATE POLICY "Funcionario insert own ticket messages" ON ticket_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM tickets t WHERE t.id = ticket_messages.ticket_id AND t.customer_id = auth.uid())
);

-- Chat Sessions: Equipe sees all. Funcionario sees support chats tied to them. Funcionario can create.
CREATE POLICY "Equipe full chat_sessions" ON chat_sessions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles px WHERE px.id = auth.uid() AND px.role = 'Equipe')
);
CREATE POLICY "Funcionario view own chat_sessions" ON chat_sessions FOR SELECT USING (customer_id = auth.uid());
CREATE POLICY "Funcionario create chat_sessions" ON chat_sessions FOR INSERT WITH CHECK (customer_id = auth.uid());

-- Chat Messages: Equipe sees all. Funcionario sees/inserts in their sessions.
CREATE POLICY "Equipe full chat_messages" ON chat_messages FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles px WHERE px.id = auth.uid() AND px.role = 'Equipe')
);
CREATE POLICY "Funcionario view own chat_messages" ON chat_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM chat_sessions s WHERE s.id = chat_messages.session_id AND s.customer_id = auth.uid())
);
CREATE POLICY "Funcionario insert own chat_messages" ON chat_messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM chat_sessions s WHERE s.id = chat_messages.session_id AND s.customer_id = auth.uid())
);
