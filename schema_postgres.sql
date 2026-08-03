-- schema_postgres.sql - Pure PostgreSQL schema for OmniSupport

-- Drop existing tables/sequences if they exist
DROP TABLE IF EXISTS public.ticket_attachments CASCADE;
DROP TABLE IF EXISTS public.ticket_messages CASCADE;
DROP TABLE IF EXISTS public.ticket_tags_map CASCADE;
DROP TABLE IF EXISTS public.ticket_access CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_participants CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;
DROP TABLE IF EXISTS public.chat_histories CASCADE;
DROP TABLE IF EXISTS public.analyst_status CASCADE;
DROP TABLE IF EXISTS public.user_status_history CASCADE;
DROP TABLE IF EXISTS public.absence_reasons CASCADE;
DROP TABLE IF EXISTS public.whatsapp_sessions CASCADE;
DROP TABLE IF EXISTS public.whatsapp_instances CASCADE;
DROP TABLE IF EXISTS public.config_categories CASCADE;
DROP TABLE IF EXISTS public.config_priorities CASCADE;
DROP TABLE IF EXISTS public.config_tags CASCADE;
DROP TABLE IF EXISTS public.config_survey_settings CASCADE;
DROP TABLE IF EXISTS public.config_email_settings CASCADE;
DROP TABLE IF EXISTS public.automation_dispatches CASCADE;
DROP TABLE IF EXISTS public.automation_settings CASCADE;
DROP TABLE IF EXISTS public.config_statuses CASCADE;
DROP TABLE IF EXISTS public.quick_notes CASCADE;
DROP TABLE IF EXISTS public.queues CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;
DROP TABLE IF EXISTS public.internal_tickets CASCADE;
DROP TABLE IF EXISTS public.internal_teams CASCADE;
DROP TABLE IF EXISTS public.ticket_internal_links CASCADE;
DROP TABLE IF EXISTS public.internal_ticket_messages CASCADE;
DROP TABLE IF EXISTS public.internal_chats CASCADE;
DROP TABLE IF EXISTS public.internal_chat_messages CASCADE;
DROP TABLE IF EXISTS public.user_search_history CASCADE;
DROP TABLE IF EXISTS public.saved_views CASCADE;
DROP TABLE IF EXISTS public.role_permissions CASCADE;
DROP TABLE IF EXISTS public.hotfixes CASCADE;

DROP SEQUENCE IF EXISTS public.ticket_seq CASCADE;
DROP SEQUENCE IF EXISTS public.internal_ticket_seq CASCADE;

-- Create Public Sequences
CREATE SEQUENCE IF NOT EXISTS public.ticket_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS public.internal_ticket_seq START 1;

-- Companies Table
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  industry TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Profiles (Users) Table (Pure PostgreSQL)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'Funcionário', -- 'Funcionário', 'Equipe', 'Administrador', 'Cliente', 'Time Interno' — tipo estrutural (portal, FKs), não decide mais permissões
  is_admin BOOLEAN DEFAULT FALSE,
  lives_in_squad BOOLEAN DEFAULT FALSE,
  internal_team_ids UUID[] DEFAULT '{}',
  avatar_url TEXT,
  avatar_thumb_url TEXT, -- versão minúscula (ver migrations/profiles_avatar_thumb.sql) da avatar_url, pra listas que mostram muitos avatares de uma vez sem pagar o peso da foto original
  phone TEXT,
  password TEXT, -- PBKDF2 hashed password
  must_change_password BOOLEAN DEFAULT TRUE,
  view_all_company_tickets BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- CS Responsável / Comercial Responsável da empresa-cliente (usuário da
-- equipe interna) — coluna adicionada aqui, depois de public.profiles
-- existir, porque companies é criada antes de profiles (profiles.company_id
-- referencia companies.id).
ALTER TABLE public.companies ADD COLUMN cs_responsavel_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.companies ADD COLUMN comercial_responsavel_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Hotfixes Table (item 17 do roadmap — cadastro de hotfix / janela de release)
CREATE TABLE public.hotfixes (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  description TEXT,
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  expected_date DATE NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  alerted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hotfixes_expected_date ON public.hotfixes(expected_date);

-- Internal Teams Table
CREATE TABLE public.internal_teams (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  admin_ids UUID[] DEFAULT '{}', -- usuários que administram esta equipe: podem criar/editar usuários e perfis de acesso escopados a ela
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_internal_teams ON public.profiles USING gin (internal_team_ids);

-- Role Permissions Table ("Perfil de Acesso" na UI) — fonte única de quais
-- telas/ações um usuário tem. profiles.access_profile_id aponta pra cá; o
-- antigo join por profiles.role = role_permissions.role foi descontinuado
-- (role continua existindo em profiles só pro tipo estrutural do usuário).
CREATE TABLE public.role_permissions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  permissions TEXT[] DEFAULT '{}',
  internal_team_id UUID REFERENCES public.internal_teams(id) ON DELETE CASCADE, -- NULL = perfil global/sistema; preenchido = perfil criado por/para uma equipe interna específica
  is_system BOOLEAN DEFAULT FALSE, -- protege os perfis padrão (Administrador etc) de edição/exclusão por admins de equipe
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Nome só precisa ser único DENTRO do mesmo escopo — duas equipes diferentes
-- (ou uma equipe e o nível global) podem ter cada uma o seu "Acesso" sem
-- colidir. Dois índices parciais em vez de um UNIQUE(name, internal_team_id)
-- porque NULL != NULL pro Postgres — sem isso, perfis globais (internal_team_id
-- nulo) poderiam duplicar nome entre si.
CREATE UNIQUE INDEX role_permissions_name_global_idx ON public.role_permissions (name) WHERE internal_team_id IS NULL;
CREATE UNIQUE INDEX role_permissions_name_team_idx ON public.role_permissions (name, internal_team_id) WHERE internal_team_id IS NOT NULL;

-- "Perfil de Acesso" do usuário — única fonte de permissões/telas. Fica como
-- ALTER (não como coluna inline lá em cima) porque profiles é criada antes
-- de role_permissions existir neste script.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_profile_id UUID REFERENCES public.role_permissions(id) ON DELETE SET NULL;

-- Analyst Status
-- Nota: coluna "status" (online/away/offline) é gravada em produção por
-- updateUserStatus/log-status-change mas não existe aqui nem em nenhuma
-- migration rastreável — drift pré-existente, fora do escopo desta mudança.
CREATE TABLE public.analyst_status (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT FALSE,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT now(),
  current_load INTEGER DEFAULT 0,
  current_reason TEXT,
  status TEXT DEFAULT 'online',
  -- Início do status/motivo ATUAL (só muda quando status ou current_reason
  -- realmente mudam) — diferente de last_active, que o heartbeat de presença
  -- recarrega a cada ~60s mesmo sem o status mudar. O cronômetro de almoço
  -- (app-context.tsx) depende de status_since, não de last_active, pra
  -- sobreviver a fechar/reabrir o sistema no meio do almoço.
  status_since TIMESTAMP WITH TIME ZONE,
  -- Ordem do rodízio de atendimento (ver migrations/queue_daily_anchor.sql e
  -- lib/services/queue-routing.ts): gravada só na primeira vez que o analista
  -- fica online no dia, pra não perder a posição ao ficar ausente/reconectar.
  queue_anchor_at TIMESTAMP WITH TIME ZONE,
  queue_anchor_date DATE
);

-- User Status History
CREATE TABLE public.user_status_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  duration INTEGER DEFAULT 0,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX idx_user_status_history_user_time ON public.user_status_history(user_id, timestamp);

-- Absence Reasons
CREATE TABLE public.absence_reasons (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Config Statuses
CREATE TABLE public.config_statuses (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL,
  color TEXT,
  -- 'ticket' (Chamados) ou 'internal_ticket' (Tickets Internos) — cada um com
  -- sua própria lista configurável; label só precisa ser único dentro do escopo.
  scope TEXT NOT NULL DEFAULT 'ticket',
  is_closed BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_status_id UUID REFERENCES public.config_statuses(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (label, scope)
);
CREATE INDEX idx_config_statuses_scope ON public.config_statuses(scope);
CREATE INDEX idx_config_statuses_parent ON public.config_statuses(parent_status_id);

-- Config Categories
CREATE TABLE public.config_categories (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Config Request Types ("Tipo de Solicitação" do chamado)
CREATE TABLE public.config_request_types (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Config Products ("Produto" do chamado)
CREATE TABLE public.config_products (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Indicador de produto no Hotfix — mesma lista usada no campo "Produto" do
-- chamado. ALTER porque hotfixes é criada antes de config_products neste
-- script.
ALTER TABLE public.hotfixes
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.config_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hotfixes_product_id ON public.hotfixes(product_id);

-- Config Priorities
CREATE TABLE public.config_priorities (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  sla_hours INTEGER NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Config Tags
CREATE TABLE public.config_tags (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  domain TEXT DEFAULT 'ticket',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Config Survey Settings (linha única) - pesquisa de satisfação enviada ao finalizar conversa
CREATE TABLE public.config_survey_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT NOT NULL DEFAULT 'Diga-nos como nos saímos.

Basta enviar 1, se você estiver satisfeito, ou 0, se poderíamos fazer melhor.',
  response_window_hours INTEGER NOT NULL DEFAULT 24,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_survey_settings_single_row CHECK (id = 1)
);

-- Config E-mail (SMTP, linha única) — resposta ao cliente e notificação de
-- atribuição de chamado por e-mail (Configurações > E-mail).
CREATE TABLE public.config_email_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT false,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_secure BOOLEAN NOT NULL DEFAULT true,
  smtp_user TEXT,
  smtp_password TEXT,
  from_name TEXT,
  from_email TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_email_settings_single_row CHECK (id = 1)
);

-- Mensagens Automáticas: notificações por WhatsApp para ações do analista no chamado.
-- Seed dos 11 eventos (textos padrão) vive em migrations/add_automated_messages.sql;
-- novos eventos futuros só precisam de uma entrada no catálogo TS
-- (lib/automation-events.ts) + auto-seed on-read, sem alterar esta tabela.
CREATE TABLE public.automation_settings (
  event_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  first_occurrence_only BOOLEAN NOT NULL DEFAULT false,
  trigger_status TEXT,
  -- Canal de e-mail, independente do WhatsApp acima (enabled/message) —
  -- mesmo evento, atraso e "só primeira ocorrência" compartilhados.
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  email_subject TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

<<<<<<< HEAD
=======
-- Fila de envio atrasado (status='pending') e histórico/auditoria
-- (status='sent'|'failed'|'skipped') na mesma tabela.
CREATE TABLE public.automation_dispatches (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  event_key TEXT NOT NULL,
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_name TEXT,
  recipient_phone TEXT,
  -- 'whatsapp' (default, dados acima) ou 'email' (usa recipient_email/subject).
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  recipient_email TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  send_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_dispatches_pending ON public.automation_dispatches(status, send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_dispatches_ticket_event ON public.automation_dispatches(ticket_id, event_key, status);

>>>>>>> origin/main
-- Tickets Table
CREATE TABLE public.tickets (
  id TEXT PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::text),
  public_ticket_number BIGINT DEFAULT nextval('public.ticket_seq') NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Novo',
  -- Sub-status opcional (config_statuses.parent_status_id) — só um detalhe
  -- dentro do status principal acima, não substitui nem afeta ele.
  sub_status TEXT,
  priority TEXT NOT NULL DEFAULT 'Baixa',
  category TEXT NOT NULL DEFAULT 'Geral', -- legado: pré-split Fila/Categoria/Tipo de Solicitação, mantido só para compat com integrações externas
  category_id UUID REFERENCES public.config_categories(id) ON DELETE SET NULL,
  request_type_id UUID REFERENCES public.config_request_types(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.config_products(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_public_number ON public.tickets(public_ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_category_id ON public.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_request_type_id ON public.tickets(request_type_id);
CREATE INDEX IF NOT EXISTS idx_tickets_product_id ON public.tickets(product_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON public.tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON public.tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);

-- Fila de envio atrasado (status='pending') e histórico/auditoria
-- (status='sent'|'failed'|'skipped') na mesma tabela. Movida pra depois de
-- "Tickets Table" (bug corrigido: referenciava public.tickets antes da
-- tabela existir — nunca rodava do zero contra um banco vazio de verdade).
CREATE TABLE public.automation_dispatches (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  event_key TEXT NOT NULL,
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_name TEXT,
  recipient_phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  send_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_dispatches_pending ON public.automation_dispatches(status, send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_dispatches_ticket_event ON public.automation_dispatches(ticket_id, event_key, status);

-- Ticket Messages Table
CREATE TABLE public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  is_visible_to_customer BOOLEAN DEFAULT TRUE,
  attachments_data JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- WHERE ticket_id = $1 ORDER BY created_at — toda abertura de chamado bate
-- nisso.
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON public.ticket_messages(ticket_id, created_at);

-- Chat Sessions
CREATE TABLE public.chat_sessions (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  type TEXT DEFAULT 'support',
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  queue_id TEXT,
  status TEXT DEFAULT 'waiting',
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE SET NULL,
  ticket_number BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  last_message_at TIMESTAMP WITH TIME ZONE,
  awaiting_survey_until TIMESTAMP WITH TIME ZONE
);

-- Poll de 30s (GET /api/chats?action=sessions) e a subquery correlacionada
-- em app/api/tickets/route.ts rodam contra esta tabela o tempo todo.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON public.chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_queue_id ON public.chat_sessions(queue_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assignee_id ON public.chat_sessions(assignee_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_id ON public.chat_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_id ON public.chat_sessions(ticket_id);

-- Chamado -> conversa de origem (N:1, permite mais de um chamado pra mesma
-- conversa). Fica como ALTER porque chat_sessions é criada depois de tickets
-- neste script.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS chat_session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_chat_session_id ON public.tickets(chat_session_id);

-- Item 12 do roadmap: chamado absorvido numa mesclagem aponta para o chamado sobrevivente.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS merged_into_id TEXT REFERENCES public.tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_merged_into_id ON public.tickets(merged_into_id);

-- Chat Participants
CREATE TABLE public.chat_participants (
  chat_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (chat_id, user_id)
);

-- Chat Messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'text',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id, created_at);

-- Chat Histories Table
CREATE TABLE public.chat_histories (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    session_id UUID REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    customer_name TEXT,
    customer_phone TEXT,
    assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_seconds INTEGER,
    first_response_seconds INTEGER,
    rating INTEGER CHECK (rating IN (-1, 0, 1)),
    transcript TEXT,
    summary TEXT,
    summary_generated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_histories_finished_at ON public.chat_histories(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_id ON public.chat_histories(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_phone ON public.chat_histories(customer_phone);
CREATE INDEX IF NOT EXISTS idx_chat_histories_session_id ON public.chat_histories(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_histories_assignee_id ON public.chat_histories(assignee_id);

-- Quick Notes Table
CREATE TABLE public.quick_notes (
  id TEXT PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::text),
  shortcut TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Queues Table
CREATE TABLE public.queues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  whatsapp_instance_id TEXT,
  member_ids UUID[] DEFAULT '{}',
  include_internal_chats BOOLEAN NOT NULL DEFAULT true,
  routing_strategy TEXT NOT NULL DEFAULT 'round_robin',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- "Fila" do chamado: campo de seleção manual/exibição (não dispara
-- distribuição automática). Fica como ALTER porque queues é criada depois de
-- tickets neste script.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS queue_id TEXT REFERENCES public.queues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_queue_id ON public.tickets(queue_id);

-- Internal Tickets Table
CREATE TABLE public.internal_tickets (
  id TEXT PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::text),
  internal_ticket_number BIGINT DEFAULT nextval('public.internal_ticket_seq') NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  team_id TEXT,
  internal_team_id UUID REFERENCES public.internal_teams(id) ON DELETE SET NULL,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  priority INTEGER DEFAULT 1,
  tags TEXT[] DEFAULT '{}',
  creator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'Novo',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  sla_limit TIMESTAMP WITH TIME ZONE, -- calculado a partir da prioridade + SLA configurado em Configurações (ver InternalTicketService.saveWithDetails / handleUpdateTicket), não editado manualmente
  expected_publish_date TIMESTAMP WITH TIME ZONE, -- "Publicação prevista": estimativa do dev, independente do SLA
  hotfix_id UUID REFERENCES public.hotfixes(id) ON DELETE SET NULL -- marcador informativo: hotfix cadastrado ao qual este ticket se refere
);

CREATE INDEX IF NOT EXISTS idx_internal_tickets_number ON public.internal_tickets(internal_ticket_number);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_status ON public.internal_tickets(status);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_assignee_id ON public.internal_tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_internal_team_id ON public.internal_tickets(internal_team_id);

-- Ticket Internal Links Table
CREATE TABLE public.ticket_internal_links (
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  internal_ticket_id TEXT REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (ticket_id, internal_ticket_id)
);

-- WhatsApp Sessions Table (Baileys credentials)
CREATE TABLE public.whatsapp_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- WhatsApp Instances Table (for UI management)
CREATE TABLE public.whatsapp_instances (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'disconnected',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- WhatsApp Contact Photos (persistidas para não reconsultar o WhatsApp após obter sucesso)
CREATE TABLE public.whatsapp_contact_photos (
  instance_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  photo_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (instance_id, phone)
);

-- Internal Chats for messaging
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

-- Internal chat messages table
CREATE TABLE public.internal_chat_messages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  chat_id TEXT REFERENCES public.internal_chats(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name TEXT,
  text TEXT,
  type TEXT DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_chat_id ON public.internal_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_created_at ON public.internal_chat_messages(created_at DESC);

-- Internal ticket messages table
CREATE TABLE public.internal_ticket_messages (
    id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
    internal_ticket_id TEXT REFERENCES public.internal_tickets(id) ON DELETE CASCADE,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    attachments_data JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_internal_ticket_messages_internal_ticket_id ON public.internal_ticket_messages(internal_ticket_id, created_at);

-- User search history
CREATE TABLE public.user_search_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Saved custom views/filters
CREATE TABLE public.saved_views (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX idx_user_search_history_user_id ON public.user_search_history(user_id);
CREATE INDEX idx_saved_views_user_id ON public.saved_views(user_id);

-- Agente de IA (widget flutuante) — log de auditoria de pergunta/resposta e
-- das buscas feitas (chat cliente, chat de grupo interno, chamados, tickets
-- internos). Não é a fonte de verdade da conversa (o client mantém o
-- histórico em memória) — ver migrations/ai_assistant.sql.
CREATE TABLE public.ai_assistant_messages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL, -- 'user' | 'model'
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_conversation ON public.ai_assistant_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_assistant_messages_user ON public.ai_assistant_messages(user_id, created_at);

-- Busca semântica do Agente de IA (embeddings) — ver migrations/ai_embeddings.sql
-- para a explicação completa das decisões (sem pgvector, sem hook manual
-- por ponto de inserção). Vetores em array nativo (sem extensão) porque
-- pgvector não está disponível no Postgres de produção deste projeto.
CREATE TABLE public.ai_embeddings (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL, -- 'ticket_message' | 'internal_ticket_message' | 'chat_message' | 'internal_chat_message'
  source_id UUID NOT NULL,
  parent_id TEXT,
  content TEXT NOT NULL,
  embedding DOUBLE PRECISION[] NOT NULL,
  source_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  indexed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_embeddings_source ON public.ai_embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_parent ON public.ai_embeddings(parent_id);
CREATE INDEX IF NOT EXISTS idx_ai_embeddings_created_at ON public.ai_embeddings(source_created_at DESC);

CREATE TABLE public.ai_embedding_queue (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_ai_embedding_queue_pending ON public.ai_embedding_queue(created_at) WHERE processed_at IS NULL;

-- Trigger de banco em cada uma das 4 tabelas de mensagem — garante que
-- TODA inserção (não importa o caminho de código) entra na fila de
-- indexação sozinha, sem precisar de hook manual espalhado pelo app.
CREATE OR REPLACE FUNCTION public.ai_enqueue_embedding() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.ai_embedding_queue (source_type, source_id) VALUES (TG_ARGV[0], NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_embed_ticket_messages
  AFTER INSERT ON public.ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('ticket_message');

CREATE TRIGGER trg_ai_embed_internal_ticket_messages
  AFTER INSERT ON public.internal_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('internal_ticket_message');

CREATE TRIGGER trg_ai_embed_chat_messages
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('chat_message');

CREATE TRIGGER trg_ai_embed_internal_chat_messages
  AFTER INSERT ON public.internal_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.ai_enqueue_embedding('internal_chat_message');

-- =========================================================================
-- SEED DATA SETUP
-- =========================================================================

-- Seed Companies
INSERT INTO public.companies (id, name, industry, phone) VALUES
('11111111-1111-4111-8111-111111111111', 'Empresa Matriz Ltda', 'Tecnologia', '1140040000')
ON CONFLICT (id) DO NOTHING;

-- Seed Default Priorities
INSERT INTO public.config_priorities (label, sla_hours, color) VALUES 
('Baixa', 120, 'bg-slate-100 text-slate-600'),
('Média', 72, 'bg-blue-100 text-blue-700'),
('Alta', 24, 'bg-orange-100 text-orange-700'),
('Urgente', 12, 'bg-red-100 text-red-700')
ON CONFLICT (label) DO NOTHING;

-- Seed Default Statuses (Chamados)
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order) VALUES
('Novo', 'bg-blue-50 text-blue-700', 'ticket', false, 0),
('Em Atendimento', 'bg-amber-50 text-amber-700', 'ticket', false, 1),
('Pendente', 'bg-slate-50 text-slate-700', 'ticket', false, 2),
('Aguardando Cliente', 'bg-amber-100 text-amber-700', 'ticket', false, 3),
('Aguardando Aprovação', 'bg-purple-100 text-purple-700', 'ticket', false, 4),
('Resolvido', 'bg-emerald-50 text-emerald-700', 'ticket', false, 5),
('Fechado', 'bg-slate-100 text-slate-500', 'ticket', true, 6),
('Mesclado', 'bg-slate-200 text-slate-500', 'ticket', true, 7),
('Concluído', 'bg-emerald-100 text-emerald-700', 'ticket', true, 100)
ON CONFLICT (label, scope) DO NOTHING;

-- Seed Default Statuses (Tickets Internos)
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order) VALUES
('Novo', 'bg-blue-100 text-blue-700', 'internal_ticket', false, 0),
('Em Andamento', 'bg-amber-100 text-amber-700', 'internal_ticket', false, 1),
('Em Espera', 'bg-slate-100 text-slate-700', 'internal_ticket', false, 2),
('Concluído', 'bg-emerald-100 text-emerald-700', 'internal_ticket', true, 3)
ON CONFLICT (label, scope) DO NOTHING;

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

-- Seed Config E-mail (linha única, desativada até alguém preencher o SMTP)
INSERT INTO public.config_email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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

-- Seed Default Internal Teams
INSERT INTO public.internal_teams (name, description) VALUES
  ('Desenvolvimento', 'Equipe responsável por desenvolvimento e manutenção de código'),
  ('Infraestrutura', 'Equipe de infraestrutura e operações'),
  ('QA', 'Equipe de testes e qualidade'),
  ('Produto', 'Equipe de produto e experiência do usuário')
ON CONFLICT (name) DO NOTHING;

-- Seed Default Role Permissions
INSERT INTO public.role_permissions (name, role, permissions) VALUES
  ('Administrador', 'Administrador', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:delete', 'tickets:assign',
    'customers:read', 'customers:write',
    'team:read', 'team:write',
    'settings:read', 'settings:write',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view', 'chat:internal'
  ]::TEXT[]),
  ('Equipe', 'Equipe', ARRAY[
    'tickets:read', 'tickets:write', 'tickets:assign',
    'customers:read',
    'team:read',
    'reports:read',
    'internal:view', 'internal:edit',
    'tickets:outside_queue',
    'dashboard:view', 'chat:internal', 'ai:assistant'
  ]::TEXT[]),
  ('Cliente', 'Cliente', ARRAY[
    'tickets:read', 'tickets:write', 'customers:read'
  ]::TEXT[]),
  ('Funcionário', 'Funcionário', ARRAY[]::TEXT[]),
  ('Time Interno', 'Time Interno', ARRAY[
    'internal:view', 'internal:edit', 'chat:internal', 'ai:assistant'
  ]::TEXT[])
-- Único índice que cobre (name) sozinho é o parcial (role_permissions_name_global_idx,
-- WHERE internal_team_id IS NULL) — sem o WHERE aqui, ON CONFLICT (name) não
-- encontra o índice pra "casar" e o INSERT falha (nunca rodava do zero).
ON CONFLICT (name) WHERE internal_team_id IS NULL DO NOTHING;

-- DO block to seed Admin and Client users directly
DO $$
DECLARE
  v_admin_id UUID := '9ca681d2-06c7-4a9c-8ef0-cfe404078356'; -- Constant UUID for Admin Supremo
  v_client_id UUID := '1a72a112-2c67-4a9c-8ef0-cfe404078311'; -- Constant UUID for José Cliente
BEGIN
  -- Insert Admin profile with PBKDF2 hashed password ('admin123')
  INSERT INTO public.profiles (
    id, email, name, role, is_admin, lives_in_squad, company_id, 
    password, must_change_password, view_all_company_tickets
  )
  VALUES (
    v_admin_id, 'admin@systemsat.com.br', 'Admin Supremo', 'Administrador', TRUE, TRUE, 
    '11111111-1111-4111-8111-111111111111'::UUID,
    'pbkdf2$10000$1234567890abcdef$2c2f5a9e0367495e2de1b8ef307c2eba04340e3c011717887170ac1813de6c0afb36a3ae18277380cbe597de4b34fb51203a818527df3ef5be8cdfcad173cd20',
    FALSE, TRUE
  )
  ON CONFLICT (email) DO NOTHING;

  -- Insert Client profile with PBKDF2 hashed password ('senha123')
  INSERT INTO public.profiles (
    id, email, name, role, is_admin, lives_in_squad, company_id, 
    password, must_change_password, view_all_company_tickets
  )
  VALUES (
    v_client_id, 'jose@cliente.com', 'José Cliente', 'Cliente', TRUE, FALSE, 
    '11111111-1111-4111-8111-111111111111'::UUID,
    'pbkdf2$10000$1234567890abcdef$9f8c1b0ef34a31f95ad00aadf1585d3be04a2c273e703ec00dd304c0b0beb07dd782187e54cdb46638bc9a32acbf7f48a7681571f2f52e6aa4559b8106c86e78',
    FALSE, TRUE
  )
  ON CONFLICT (email) DO NOTHING;

  -- Analyst status for Admin
  INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
  VALUES (v_admin_id, FALSE, now(), 0)
  ON CONFLICT (user_id) DO NOTHING;
END $$;
