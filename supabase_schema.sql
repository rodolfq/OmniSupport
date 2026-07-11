-- =========================================================================
-- MASTER INITIALIZATION SCRIPT FOR OMNISUPPORT DATABASE (SUPABASE SLATE)
-- Version: 3.0 (Flawless Complete Script)
-- =========================================================================

-- Drop all existing tables, triggers, and functions to ensure a perfect clean state
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.create_global_policy(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.create_user_account(TEXT,TEXT,TEXT,TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_user_password(TEXT,TEXT) CASCADE;

DROP TABLE IF EXISTS public.ticket_attachments CASCADE;
DROP TABLE IF EXISTS public.ticket_messages CASCADE;
DROP TABLE IF EXISTS public.ticket_tags_map CASCADE;
DROP TABLE IF EXISTS public.ticket_access CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_participants CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;
DROP TABLE IF EXISTS public.analyst_status CASCADE;
DROP TABLE IF EXISTS public.user_status_history CASCADE;
DROP TABLE IF EXISTS public.absence_reasons CASCADE;
DROP TABLE IF EXISTS public.whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS public.whatsapp_instances CASCADE;
DROP TABLE IF EXISTS public.config_categories CASCADE;
DROP TABLE IF EXISTS public.config_priorities CASCADE;
DROP TABLE IF EXISTS public.config_tags CASCADE;
DROP TABLE IF EXISTS public.config_statuses CASCADE;
DROP TABLE IF EXISTS public.quick_notes CASCADE;
DROP TABLE IF EXISTS public.queues CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.internal_tickets CASCADE;
DROP TABLE IF EXISTS public.internal_chats CASCADE;

-- Drop sequence if exists to start fresh
DROP SEQUENCE IF EXISTS public.ticket_seq CASCADE;
DROP SEQUENCE IF EXISTS public.internal_ticket_seq CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create Public Sequences
CREATE SEQUENCE IF NOT EXISTS public.ticket_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS public.internal_ticket_seq START 1;

-- 2. Companies Table
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  industry TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 3. Profiles (Users) Table (Linked safely to Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
email TEXT NOT NULL UNIQUE,
   role TEXT NOT NULL DEFAULT 'Funcionário', -- 'Funcionário', 'Equipe', 'Administrador'
   is_admin BOOLEAN DEFAULT FALSE,
   lives_in_squad BOOLEAN DEFAULT FALSE,
   internal_team_ids UUID[] DEFAULT '{}', -- Array of internal team IDs this user belongs to
   avatar_url TEXT, -- Base64 avatar image
   phone TEXT,
   password TEXT,
   must_change_password BOOLEAN DEFAULT TRUE,
   view_all_company_tickets BOOLEAN DEFAULT FALSE,
   created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Internal Teams Table for better organization
CREATE TABLE IF NOT EXISTS public.internal_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_internal_teams ON public.profiles USING gin (internal_team_ids);

-- Seed default teams
INSERT INTO public.internal_teams (name, description) VALUES
  ('Desenvolvimento', 'Equipe responsável por desenvolvimento e manutenção de código'),
  ('Infraestrutura', 'Equipe de infraestrutura e operações'),
  ('QA', 'Equipe de testes e qualidade'),
  ('Produto', 'Equipe de produto e experiência do usuário')
ON CONFLICT (name) DO NOTHING;

-- 3.5 Role Permissions Table (Custom roles with granular permissions)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- e.g., 'admin', 'Equipe', 'Funcionário'
  role TEXT NOT NULL, -- matches profile role value
  permissions TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed default role permissions
INSERT INTO public.role_permissions (name, role, permissions) VALUES
  ('Administrador', 'Administrador', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:delete', 'tickets:assign',
    'customers:read', 'customers:write',
    'team:read', 'team:write',
    'settings:read', 'settings:write',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view'
  ]::TEXT[]),
  ('Equipe', 'Equipe', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:assign',
    'customers:read',
    'team:read',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view'
  ]::TEXT[]),
  ('Cliente', 'Cliente', ARRAY[
    'tickets:read', 'tickets:write', 'customers:read'
  ]::TEXT[]),
  ('Funcionário', 'Funcionário', ARRAY[]::TEXT[]),
  ('Time Interno', 'Time Interno', ARRAY[
    'internal:view', 'internal:edit'
  ]::TEXT[])
ON CONFLICT (name) DO NOTHING;

-- 4. Analyst Status (For tracking support agents capacity and reasons)
CREATE TABLE public.analyst_status (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT FALSE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT now(),
  current_load INTEGER DEFAULT 0,
  current_reason TEXT
);

-- 5. User Status History (History log of breaks, pauses and online state)
CREATE TABLE public.user_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'online', 'away', 'offline'
  reason TEXT, -- e.g. 'Almoço', 'Reunião', etc.
  duration INTEGER DEFAULT 0, -- in seconds
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 6. Absence Reasons (Standard config)
CREATE TABLE public.absence_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 7. Config Tables
CREATE TABLE public.config_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE TABLE public.config_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE TABLE public.config_priorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  sla_hours INTEGER NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE TABLE public.config_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  domain TEXT DEFAULT 'ticket',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 8. Tickets Table
CREATE TABLE public.tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  public_ticket_number BIGINT DEFAULT nextval('public.ticket_seq') NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Novo',
  priority TEXT NOT NULL DEFAULT 'Baixa',
  category TEXT NOT NULL DEFAULT 'Geral',
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  employee_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Index for Ticket Sequentials
CREATE INDEX IF NOT EXISTS idx_tickets_public_number ON public.tickets(public_ticket_number);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_number ON public.internal_tickets(internal_ticket_number);

-- Search and filter indexes
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON public.tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON public.tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON public.tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_title_gin ON public.tickets USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_description_gin ON public.tickets USING gin (description gin_trgm_ops);

-- For internal_tickets
CREATE INDEX IF NOT EXISTS idx_internal_tickets_team_id ON public.internal_tickets(team_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_title_gin ON public.internal_tickets USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_ticket_id ON public.internal_ticket_messages(internal_ticket_id);
CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_created_at ON public.internal_ticket_messages(created_at);

-- 9. Ticket Messages Table (With attachments payload inside JSONB)
CREATE TABLE public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- 'text', 'system', 'internal'
  is_visible_to_customer BOOLEAN DEFAULT TRUE,
  attachments_data JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 10. Chat Sessions (WhatsApp and live chat interactions)
CREATE TABLE public.chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT DEFAULT 'support', -- 'support', 'internal'
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  queue_id TEXT,
  status TEXT DEFAULT 'waiting', -- 'waiting', 'active', 'closed'
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  ticket_number BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  last_message_at TIMESTAMP WITH TIME ZONE
);

-- 11. Chat Participants
CREATE TABLE public.chat_participants (
  chat_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);

-- 12. Chat Messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'text', -- 'text', 'image', 'file', 'system'
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 13. Quick Notes Table
CREATE TABLE public.quick_notes (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  shortcut TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 14. Queues (Support tiers) Table
CREATE TABLE public.queues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  whatsapp_instance_id TEXT,
  member_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 14.5 Internal Tickets Table (Internal tracking for complex issues)
CREATE TABLE public.internal_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_ticket_number BIGINT DEFAULT nextval('public.internal_ticket_seq') NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  team_id TEXT,
  internal_team_id UUID REFERENCES public.internal_teams(id) ON DELETE SET NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 1,
  tags TEXT[] DEFAULT '{}',
  creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  sla_limit TIMESTAMP WITH TIME ZONE
);

-- N:N relationship between tickets and internal_tickets
CREATE TABLE public.ticket_internal_links (
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  internal_ticket_id UUID REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (ticket_id, internal_ticket_id)
);

-- 15. WhatsApp Sessions Tables (Baileys credentials)
CREATE TABLE public.whatsapp_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 15.5 WhatsApp Instances Table (for UI management)
CREATE TABLE public.whatsapp_instances (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'disconnected',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- internal_chats for internal messaging
CREATE TABLE public.internal_chats (
    id TEXT PRIMARY KEY,
    name TEXT,
    image_url TEXT,
    type TEXT DEFAULT 'direct',
    member_ids UUID[] DEFAULT '{}',
    messages JSONB DEFAULT '[]',
    last_message_at TIMESTAMP WITH TIME ZONE,
    pinned_by UUID[] DEFAULT '{}',
    pinned_message_ids TEXT[] DEFAULT '{}',
    muted_by UUID[] DEFAULT '{}',
    read_later_by UUID[] DEFAULT '{}',
    hidden_by UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Internal ticket messages table (for internal ticket conversation history)
CREATE TABLE IF NOT EXISTS public.internal_ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_ticket_id UUID REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    attachments_data JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);


-- User search history for suggestions
CREATE TABLE public.user_search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Saved custom views/filters
CREATE TABLE public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX idx_user_search_history_user_id ON public.user_search_history(user_id);
CREATE INDEX idx_saved_views_user_id ON public.saved_views(user_id);

ALTER TABLE public.user_search_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_views DISABLE ROW LEVEL SECURITY;

-- =========================================================================
-- SEED DATA SETUP
-- =========================================================================

-- Seed Companies
INSERT INTO public.companies (id, name, industry, phone) VALUES
('11111111-1111-4111-8111-111111111111', 'Empresa Matriz Ltda', 'Tecnologia', '1140040000')
ON CONFLICT DO NOTHING;

-- Seed Default Priorities
INSERT INTO public.config_priorities (label, sla_hours, color) VALUES 
('Baixa', 120, 'bg-slate-100 text-slate-600'),
('Média', 72, 'bg-blue-100 text-blue-700'),
('Alta', 24, 'bg-orange-100 text-orange-700'),
('Urgente', 12, 'bg-red-100 text-red-700')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Statuses
INSERT INTO public.config_statuses (label, color) VALUES 
('Novo', 'bg-blue-50 text-blue-700'),
('Em Atendimento', 'bg-amber-50 text-amber-700'),
('Pendente', 'bg-slate-50 text-slate-700'),
('Resolvido', 'bg-emerald-50 text-emerald-700'),
('Fechado', 'bg-slate-100 text-slate-500')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Categories
INSERT INTO public.config_categories (label) VALUES 
('Suporte Técnico'), 
('Financeiro'), 
('Comercial'), 
('Dúvidas'), 
('Reclamação')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Tags
INSERT INTO public.config_tags (label, color, domain) VALUES 
('Bug', 'bg-red-100 text-red-700', 'ticket'), 
('Melhoria', 'bg-blue-100 text-blue-700', 'ticket'), 
('Urgente', 'bg-rose-100 text-rose-700', 'ticket')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Absence Reasons
INSERT INTO public.absence_reasons (label) VALUES 
('Almoço'), 
('Reunião'), 
('Pessoal'), 
('Pausa')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Quick Notes
INSERT INTO public.quick_notes (shortcut, content, category) VALUES 
('oi', 'Olá! Sou o analista de suporte. Como posso te ajudar hoje?', 'Saudação'), 
('aguarde', 'Por favor, aguarde um momento enquanto verifico essa informação no sistema.', 'Padrão'), 
('encerrar', 'Foi um prazer te ajudar! Tem algo mais em que eu possa ser útil?', 'Encerramento')
ON CONFLICT (shortcut) DO NOTHING;

-- Seed Default Queues
INSERT INTO public.queues (id, name, description, whatsapp_instance_id, member_ids) VALUES 
('q1', 'Nível 1 - Triagem', 'Primeiro atendimento e triagem de chamados', 'wa1', '{}'),
('q2', 'Nível 2 - Técnico', 'Suporte avançado e infraestrutura', 'wa2', '{}')
ON CONFLICT (id) DO UPDATE SET 
  name = EXCLUDED.name, 
  description = EXCLUDED.description;


-- =========================================================================
-- SECURITY AND ROW LEVEL SECURITY (RLS) POLICIES (MAXIMUM FREEDOM - NO BARRIERS)
-- =========================================================================

-- Disable RLS on all tables to ensure absolute ease of use and zero access blockages
ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyst_status DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.absence_reasons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_statuses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_priorities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_tags DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.queues DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_tickets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_internal_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_ticket_messages DISABLE ROW LEVEL SECURITY;

-- Auxiliary trigger/function structure to automatically create permissive fallback policies
CREATE OR REPLACE FUNCTION public.create_permissive_policy(table_name TEXT) RETURNS VOID AS $$
BEGIN
    EXECUTE format('DROP POLICY IF EXISTS "global_all" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "global_auth_all" ON public.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "global_anon_all" ON public.%I', table_name);
    EXECUTE format('CREATE POLICY "global_permissive_all" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true)', table_name);
END;
$$ LANGUAGE plpgsql;

-- Apply permissive fallback policies (in case RLS is manually enabled later)
SELECT public.create_permissive_policy('companies');
SELECT public.create_permissive_policy('profiles');
SELECT public.create_permissive_policy('role_permissions');
SELECT public.create_permissive_policy('analyst_status');
SELECT public.create_permissive_policy('user_status_history');
SELECT public.create_permissive_policy('absence_reasons');
SELECT public.create_permissive_policy('config_statuses');
SELECT public.create_permissive_policy('config_categories');
SELECT public.create_permissive_policy('config_priorities');
SELECT public.create_permissive_policy('config_tags');
SELECT public.create_permissive_policy('tickets');
SELECT public.create_permissive_policy('ticket_messages');
SELECT public.create_permissive_policy('chat_sessions');
SELECT public.create_permissive_policy('chat_participants');
SELECT public.create_permissive_policy('chat_messages');
SELECT public.create_permissive_policy('quick_notes');
SELECT public.create_permissive_policy('queues');
SELECT public.create_permissive_policy('whatsapp_sessions');
SELECT public.create_permissive_policy('internal_tickets');
SELECT public.create_permissive_policy('internal_teams');
SELECT public.create_permissive_policy('ticket_internal_links');
SELECT public.create_permissive_policy('internal_ticket_messages');

-- Drop the helper function
DROP FUNCTION IF EXISTS public.create_permissive_policy(TEXT);


-- =========================================================================
-- COMPREHENSIVE AUTOMATIC TRIGGERS (AUTH SYNCHRONIZATION)
-- =========================================================================

-- Trigger to automatically synchronize Auth sign-ups with public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_role TEXT;
  v_name TEXT;
  v_is_admin BOOLEAN := FALSE;
  v_lives_in_squad BOOLEAN := FALSE;
BEGIN
  -- Default mapping based on emails
  IF (new.email = 'admin@systemsat.com.br' OR new.email = 'rodolfo.design23@gmail.com') THEN
    v_role := 'Administrador';
    v_name := 'Admin Supremo';
    v_is_admin := TRUE;
    v_lives_in_squad := TRUE;
  ELSE
    v_role := COALESCE(new.raw_user_meta_data->>'role', 'Cliente');
    v_name := COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
    v_is_admin := (v_role = 'Cliente');
    v_lives_in_squad := (v_role IN ('Equipe', 'Administrador'));
  END IF;

  -- Insert profile securely, handling conflicts if already in public.profiles
  INSERT INTO public.profiles (
    id, 
    email, 
    name, 
    role, 
    is_admin, 
    lives_in_squad,
    company_id, 
    must_change_password, 
    view_all_company_tickets
  )
  VALUES (
    new.id,
    new.email,
    v_name,
    v_role,
    v_is_admin,
    v_lives_in_squad,
    COALESCE((new.raw_user_meta_data->>'company_id')::uuid, '11111111-1111-4111-8111-111111111111'::uuid),
    COALESCE((new.raw_user_meta_data->>'mustChangePassword')::boolean, false),
    COALESCE((new.raw_user_meta_data->>'viewAllCompanyTickets')::boolean, v_role = 'Cliente')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name),
    role = COALESCE(EXCLUDED.role, profiles.role),
    is_admin = COALESCE(EXCLUDED.is_admin, profiles.is_admin),
    lives_in_squad = COALESCE(EXCLUDED.lives_in_squad, profiles.lives_in_squad);

  -- Log analyst status automatically if user is part of the support squad
  IF (v_lives_in_squad) THEN
    INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
    VALUES (new.id, FALSE, now(), 0)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind the trigger to auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =========================================================================
-- SEED SUPER USER AND CLIENT
-- =========================================================================
DO $$
DECLARE
  v_admin_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
BEGIN
  -- Insert Admin user inside auth.users if not present
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@systemsat.com.br') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, 
      email_confirmed_at, recovery_sent_at, last_sign_in_at, 
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000', v_admin_id, 'authenticated', 'authenticated', 
      'admin@systemsat.com.br', crypt('admin123', gen_salt('bf')), 
      now(), now(), now(), 
      '{"provider":"email","providers":["email"]}', '{"name":"Admin Supremo","role":"Administrador"}', 
      now(), now()
    );
  END IF;

  -- Insert Client user inside auth.users if not present
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'jose@cliente.com') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, 
      email_confirmed_at, recovery_sent_at, last_sign_in_at, 
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000', v_client_id, 'authenticated', 'authenticated', 
      'jose@cliente.com', crypt('senha123', gen_salt('bf')), 
      now(), now(), now(), 
      '{"provider":"email","providers":["email"]}', '{"name":"José Cliente","company_id":"11111111-1111-4111-8111-111111111111","role":"Cliente"}', 
      now(), now()
    );
  END IF;
END $$;


-- =========================================================================
-- STORAGE BUCKETS CONFIGURATION (ATTACHMENTS)
-- =========================================================================
-- Note: Supabase Storage buckets are tracked inside the `storage.buckets` table
-- Ensure the storage bucket exists for attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage security policies
DROP POLICY IF EXISTS "Allow All Storage Access" ON storage.objects;
CREATE POLICY "Allow All Storage Access" ON storage.objects 
  FOR ALL TO authenticated, anon 
  USING (bucket_id = 'attachments') 
  WITH CHECK (bucket_id = 'attachments');


-- =========================================================================
-- ENABLE REALTIME ON CORE TABLES
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tickets') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ticket_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ticket_messages;
  END If;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
  END IF;
IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
 END $$;

 -- =========================================================================
 -- RPC FUNCTIONS FOR USER MANAGEMENT
 -- =========================================================================

 -- RPC: create_user_account - Creates auth user and profile
 CREATE OR REPLACE FUNCTION public.create_user_account(
   p_email TEXT,
   p_password TEXT,
   p_name TEXT,
   p_role TEXT DEFAULT 'Cliente'
 ) RETURNS TABLE (
   id UUID,
   email TEXT,
   name TEXT,
   role TEXT,
   error TEXT
 ) LANGUAGE plpgsql SECURITY DEFINER AS $$
 DECLARE
   v_user_id UUID;
   v_role TEXT := p_role;
   v_is_admin BOOLEAN := FALSE;
   v_lives_in_squad BOOLEAN := FALSE;
   v_default_company UUID := '11111111-1111-4111-8111-111111111111'::UUID;
 BEGIN
   -- Check if user already exists
   SELECT u.id INTO v_user_id FROM auth.users u WHERE u.email = p_email;
   IF v_user_id IS NOT NULL THEN
     RETURN QUERY SELECT u.id, u.email, p_name, p_role, NULL::TEXT FROM auth.users u WHERE u.id = v_user_id;
     RETURN;
   END IF;

   -- Determine role defaults
   IF p_role IN ('Administrador', 'admin') THEN
     v_is_admin := TRUE;
     v_lives_in_squad := TRUE;
   END IF;
   IF p_role = 'Cliente' THEN
     v_is_admin := TRUE;
   END IF;
   IF p_role IN ('Equipe', 'support') THEN
     v_lives_in_squad := TRUE;
   END IF;

   -- Create user in auth.users
   INSERT INTO auth.users (
     instance_id, id, aud, role, email, encrypted_password,
     email_confirmed_at, recovery_sent_at, last_sign_in_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at
   )
   VALUES (
     '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
     p_email, crypt(p_password, gen_salt('bf')),
     now(), now(), now(),
     '{"provider":"email","providers":["email"]}',
     jsonb_build_object('name', p_name, 'role', p_role),
     now(), now()
   )
   RETURNING id INTO v_user_id;

   -- Insert profile (trigger also handles this)
   INSERT INTO public.profiles (
     id, email, name, role, is_admin, lives_in_squad,
     company_id, must_change_password, view_all_company_tickets
   )
   VALUES (
     v_user_id, p_email, p_name, v_role, v_is_admin, v_lives_in_squad,
     v_default_company, TRUE, p_role = 'Cliente'
   )
   ON CONFLICT (id) DO UPDATE SET
     email = EXCLUDED.email,
     name = EXCLUDED.name,
     role = EXCLUDED.role;

   -- Create analyst status for support team members
   IF v_lives_in_squad THEN
     INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
     VALUES (v_user_id, FALSE, now(), 0)
     ON CONFLICT (user_id) DO NOTHING;
   END IF;

   RETURN QUERY SELECT v_user_id, p_email, p_name, p_role, NULL::TEXT;
 EXCEPTION
   WHEN OTHERS THEN
     RETURN QUERY SELECT NULL::UUID, p_email, p_name, p_role, SQLERRM::TEXT;
 END;
 $$;

 -- RPC: admin_delete_user - Deletes user from auth
 CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id UUID)
 RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
 BEGIN
   DELETE FROM auth.users WHERE id = p_user_id;
 END;
 $$;

 -- RPC: admin_update_user_password - Updates user password
 CREATE OR REPLACE FUNCTION public.admin_update_user_password(p_email TEXT, p_password TEXT)
 RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
 BEGIN
   UPDATE auth.users 
   SET encrypted_password = crypt(p_password, gen_salt('bf')),
       updated_at = now()
   WHERE email = p_email;
 END;
 $$;

 -- Grant permissions
 GRANT EXECUTE ON FUNCTION public.create_user_account TO authenticated;
 GRANT EXECUTE ON FUNCTION public.admin_delete_user TO authenticated;
 GRANT EXECUTE ON FUNCTION public.admin_update_user_password TO authenticated;

 -- Reload Schema Cache
 NOTIFY pgrst, 'reload schema';
