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
-- GET /api/integrations/v1/employees filtra sempre por role IN (...) e
-- ordena por created_at DESC, e opcionalmente por company_id — ver
-- migrations/integration_v1_indexes.sql.
CREATE INDEX IF NOT EXISTS idx_profiles_role_created_at ON public.profiles(role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);

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

-- Classificação de solução do TICKET INTERNO (ver
-- migrations/internal_ticket_effort_outcome.sql). Dois campos preenchidos na
-- conclusão: Esforço responde "quanto custou" e Desfecho responde "qual foi a
-- natureza da solução". São dimensões independentes — um ticket trivial pode
-- exigir ação e um complexo pode terminar sem alteração nenhuma.
CREATE TABLE public.config_effort_levels (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  -- Peso da carga ponderada nos relatórios: contar chamado por cabeça premia
  -- quem pega os fáceis.
  weight NUMERIC(5,2) NOT NULL DEFAULT 1,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE TABLE public.config_outcomes (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  -- Marca o que é defeito de produto, para a taxa de "bug que escapou ao
  -- cliente" não depender do rótulo literal continuar se chamando "Bug".
  counts_as_defect BOOLEAN NOT NULL DEFAULT false,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

INSERT INTO public.config_effort_levels (label, weight, color, sort_order) VALUES
  ('Imediato', 1, '#22c55e', 1),
  ('Rotina', 2, '#3b82f6', 2),
  ('Complexo', 5, '#f59e0b', 3),
  ('Crítico', 8, '#ef4444', 4)
ON CONFLICT (label) DO NOTHING;

INSERT INTO public.config_outcomes (label, counts_as_defect, color, sort_order) VALUES
  ('Orientação/dúvida', false, '#3b82f6', 1),
  ('Configuração', false, '#8b5cf6', 2),
  ('Correção de dado', false, '#06b6d4', 3),
  ('Bug (virou ticket interno)', true, '#ef4444', 4),
  ('Melhoria/pedido novo', false, '#f59e0b', 5),
  ('Não reproduzido', false, '#64748b', 6),
  ('Duplicado', false, '#94a3b8', 7)
ON CONFLICT (label) DO NOTHING;

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

-- Controle do Agente de IA em Configurações (prompt/modelo/busca semântica
-- editáveis em runtime) — ver lib/services/ai-assistant-config-service.ts.
-- Todos os campos NULL = usa o padrão hardcoded/env de sempre.
CREATE TABLE public.ai_assistant_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  system_prompt TEXT,
  model TEXT,
  semantic_search_enabled BOOLEAN,
  dissatisfaction_detector_enabled BOOLEAN,
  dissatisfaction_extra_instructions TEXT,
  avatar_source TEXT,
  avatar_crop_overrides JSONB,
  -- Chave Groq trocável por aqui (Configurações > Agente de IA), sem editar
  -- o .env — NULL = usa GROQ_API_KEY do ambiente (ver lib/groq-client.ts).
  groq_api_key TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ai_assistant_settings_singleton CHECK (id = 1)
);
INSERT INTO public.ai_assistant_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Link da planilha do Google publicada como "Escala Fim de Semana" (ver
-- migrations/weekend_schedule_settings.sql), trocável em Configurações sem
-- deploy. NULL = usa o link padrão embutido em weekend-schedule-service.ts.
CREATE TABLE public.weekend_schedule_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  published_sheet_id TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT weekend_schedule_settings_singleton CHECK (id = 1)
);
INSERT INTO public.weekend_schedule_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  -- Full-text search (Agente de IA, search_tickets — ver
  -- lib/services/ai-assistant-service.ts) — gerada sozinha em todo
  -- INSERT/UPDATE, sem trigger manual.
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED
);

CREATE INDEX IF NOT EXISTS idx_tickets_public_number ON public.tickets(public_ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_category_id ON public.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_request_type_id ON public.tickets(request_type_id);
CREATE INDEX IF NOT EXISTS idx_tickets_product_id ON public.tickets(product_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON public.tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON public.tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_search_vector ON public.tickets USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);
-- Sincronização incremental da API de integração (?updatedSince=) —
-- migrations/integration_v1_indexes.sql.
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON public.tickets(updated_at DESC);

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
  awaiting_survey_until TIMESTAMP WITH TIME ZONE,
  -- Tags vinculadas em tempo real pelo atendente (ids de config_tags, domain='chat').
  -- Array de texto solto, sem FK — mesmo padrão já usado em tickets.tags.
  tags TEXT[] DEFAULT '{}'
);

-- Poll de 30s (GET /api/chats?action=sessions) e a subquery correlacionada
-- em app/api/tickets/route.ts rodam contra esta tabela o tempo todo.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON public.chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_queue_id ON public.chat_sessions(queue_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assignee_id ON public.chat_sessions(assignee_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_customer_id ON public.chat_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_id ON public.chat_sessions(ticket_id);
-- Listagem da API de integração ordena por created_at e filtra por
-- updated_at (?updatedSince=) — migrations/integration_v1_indexes.sql.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON public.chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON public.chat_sessions(updated_at DESC);

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  -- Full-text search (Agente de IA, search_client_chats) — ver comentário
  -- equivalente em public.tickets.
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(text, ''))) STORED
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_search_vector ON public.chat_messages USING GIN (search_vector);

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
    -- Detector de insatisfação (ver lib/services/dissatisfaction-service.ts)
    -- — dissatisfaction_processed_at NULL = ainda não processado.
    dissatisfaction_processed_at TIMESTAMP WITH TIME ZONE,
    dissatisfaction_detected BOOLEAN,
    dissatisfaction_department TEXT,
    dissatisfaction_category TEXT,
    dissatisfaction_reason TEXT,
    dissatisfaction_attempts INTEGER NOT NULL DEFAULT 0,
    dissatisfaction_last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_histories_finished_at ON public.chat_histories(finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_id ON public.chat_histories(customer_id);
CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_phone ON public.chat_histories(customer_phone);
CREATE INDEX IF NOT EXISTS idx_chat_histories_dissatisfaction_pending
  ON public.chat_histories (finished_at ASC) WHERE dissatisfaction_processed_at IS NULL;
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
  hotfix_id UUID REFERENCES public.hotfixes(id) ON DELETE SET NULL, -- marcador informativo: hotfix cadastrado ao qual este ticket se refere
  -- Classificação da solução, preenchida na conclusão (ver
  -- config_effort_levels / config_outcomes). Esforço = quanto custou resolver;
  -- Desfecho = natureza da solução. Base do relatório de Carga e Complexidade.
  effort_id UUID REFERENCES public.config_effort_levels(id) ON DELETE SET NULL,
  outcome_id UUID REFERENCES public.config_outcomes(id) ON DELETE SET NULL,
  -- Full-text search (Agente de IA, search_internal_tickets) — ver
  -- comentário equivalente em public.tickets.
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED
);

CREATE INDEX IF NOT EXISTS idx_internal_tickets_number ON public.internal_tickets(internal_ticket_number);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_status ON public.internal_tickets(status);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_assignee_id ON public.internal_tickets(assignee_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_internal_team_id ON public.internal_tickets(internal_team_id);
CREATE INDEX IF NOT EXISTS idx_internal_tickets_search_vector ON public.internal_tickets USING GIN (search_vector);

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

-- WhatsApp Instances Table (for UI management) — cada linha é um "canal" de
-- WhatsApp, com provider 'baileys' (QR Code) ou 'meta' (Cloud API oficial).
-- Os campos meta-específicos ficam NULL em canais Baileys.
CREATE TABLE public.whatsapp_instances (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'disconnected',
  provider TEXT NOT NULL DEFAULT 'baileys',
  access_token TEXT,
  phone_number_id TEXT,
  verify_token TEXT,
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  -- Full-text search (Agente de IA, search_internal_chats) — ver comentário
  -- equivalente em public.tickets.
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(text, ''))) STORED
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_chat_id ON public.internal_chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_created_at ON public.internal_chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_search_vector ON public.internal_chat_messages USING GIN (search_vector);

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
-- ALINHAMENTO COM O BANCO DE PRODUÇÃO
-- =========================================================================
-- Este arquivo é a fonte de verdade do schema, mas tinha ficado para trás do
-- banco real: 9 tabelas e 16 colunas existiam em produção (aplicadas à mão via
-- migrations/) sem nunca terem voltado para cá. Na prática o arquivo NÃO
-- conseguia provisionar um banco novo — o login quebrava logo de cara, porque
-- profiles.is_active não existia.
--
-- O DDL abaixo foi gerado a partir do catálogo do próprio Postgres de
-- produção (information_schema + pg_constraint + pg_indexes), não escrito de
-- memória, para que tipos, defaults, nulidade, chaves e índices batam com o
-- que roda hoje.
--
-- Fica nesta seção, e não junto de cada CREATE TABLE original, por dois
-- motivos: as chaves estrangeiras exigem que profiles/companies/chat_sessions/
-- chat_messages/internal_chat_messages já existam; e manter o bloco separado
-- deixa explícito o que veio de migração posterior — útil na próxima
-- conferência de drift.
--
-- Ao aplicar uma migration nova em produção, acrescente-a aqui também. É o que
-- deixou de ser feito e gerou o descompasso.

-- Log de auditoria (lib/audit-log.ts) --------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  actor_id uuid,
  actor_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  entity_label text,
  changes jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON public.audit_log USING btree (actor_id);

-- Web Push / VAPID (lib/services/push-service.ts) --------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_seen_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
  CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);

-- Avaliação interna de empresa-cliente (não visível ao cliente) ------------
CREATE TABLE IF NOT EXISTS public.customer_evaluations (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  company_id uuid NOT NULL,
  analyst_id uuid,
  chat_session_id uuid,
  knowledge_score smallint,
  autonomy_score smallint,
  learning_score smallint,
  engagement_score smallint,
  organization_score smallint,
  communication_score smallint,
  profile_tag text,
  created_at timestamptz DEFAULT now() NOT NULL,
  origin text DEFAULT 'manual'::text NOT NULL,
  contact_id uuid,
  CONSTRAINT customer_evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT customer_evaluations_analyst_id_fkey FOREIGN KEY (analyst_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT customer_evaluations_chat_session_id_fkey FOREIGN KEY (chat_session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL,
  CONSTRAINT customer_evaluations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT customer_evaluations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT customer_evaluations_autonomy_score_check CHECK (((autonomy_score >= 1) AND (autonomy_score <= 5))),
  CONSTRAINT customer_evaluations_communication_score_check CHECK (((communication_score >= 1) AND (communication_score <= 5))),
  CONSTRAINT customer_evaluations_engagement_score_check CHECK (((engagement_score >= 1) AND (engagement_score <= 5))),
  CONSTRAINT customer_evaluations_knowledge_score_check CHECK (((knowledge_score >= 1) AND (knowledge_score <= 5))),
  CONSTRAINT customer_evaluations_learning_score_check CHECK (((learning_score >= 1) AND (learning_score <= 5))),
  CONSTRAINT customer_evaluations_organization_score_check CHECK (((organization_score >= 1) AND (organization_score <= 5))),
  CONSTRAINT customer_evaluations_origin_check CHECK ((origin = ANY (ARRAY['chat_close'::text, 'manual'::text]))),
  CONSTRAINT customer_evaluations_profile_tag_check CHECK ((profile_tag = ANY (ARRAY['technical'::text, 'beginner'::text, 'challenging'::text])))
);
CREATE INDEX IF NOT EXISTS idx_customer_evaluations_company_id ON public.customer_evaluations USING btree (company_id);
CREATE INDEX IF NOT EXISTS idx_customer_evaluations_created_at ON public.customer_evaluations USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_evaluations_contact_id ON public.customer_evaluations USING btree (contact_id);

-- API de integração externa (lib/integration-auth.ts) ----------------------
CREATE TABLE IF NOT EXISTS public.integration_api_keys (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] DEFAULT '{}'::text[] NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT integration_api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT integration_api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_api_keys_prefix ON public.integration_api_keys USING btree (key_prefix);

-- Google Agenda (lib/services/google-calendar-service.ts) -------------------
-- Vínculo pessoal por usuário: cada um conecta a própria conta Google, só
-- leitura (calendar.readonly). refresh_token não expira sozinho — só quando a
-- pessoa revoga o acesso pela própria conta Google ou desvincula por aqui.
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  user_id uuid NOT NULL,
  google_email text,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT google_calendar_connections_pkey PRIMARY KEY (user_id),
  CONSTRAINT google_calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Registro de lembretes já disparados (lib/services/google-calendar-scheduler.ts)
-- — o UNIQUE em (user_id, event_id, event_start) é o que evita avisar duas
-- vezes o mesmo evento: o scheduler faz INSERT ... ON CONFLICT DO NOTHING
-- antes de notificar, e só notifica se a linha for realmente inserida.
-- event_start entra na chave porque um evento reagendado (novo horário) deve
-- gerar um lembrete novo.
CREATE TABLE IF NOT EXISTS public.google_calendar_reminder_log (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id text NOT NULL,
  event_title text,
  event_start timestamptz NOT NULL,
  event_url text,
  notified_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT google_calendar_reminder_log_pkey PRIMARY KEY (id),
  CONSTRAINT google_calendar_reminder_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT google_calendar_reminder_log_unique UNIQUE (user_id, event_id, event_start)
);
CREATE INDEX IF NOT EXISTS idx_google_calendar_reminder_log_user_time ON public.google_calendar_reminder_log USING btree (user_id, notified_at);

-- Quem está olhando uma conversa agora — persistido no banco (e não na
-- memória do processo) porque decide se o push é enviado.
CREATE TABLE IF NOT EXISTS public.chat_session_viewers (
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_seen_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT chat_session_viewers_pkey PRIMARY KEY (session_id, user_id),
  CONSTRAINT chat_session_viewers_session_id_fkey FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT chat_session_viewers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_session_viewers_last_seen ON public.chat_session_viewers USING btree (last_seen_at);

-- Limiares das métricas do dashboard (linha única) -------------------------
CREATE TABLE IF NOT EXISTS public.config_metric_thresholds (
  id integer DEFAULT 1 NOT NULL,
  first_response_good_seconds integer DEFAULT 120 NOT NULL,
  first_response_warning_seconds integer DEFAULT 300 NOT NULL,
  pct_2min_good_percentage numeric DEFAULT 80 NOT NULL,
  pct_2min_warning_percentage numeric DEFAULT 60 NOT NULL,
  duration_good_minutes numeric DEFAULT 10 NOT NULL,
  duration_warning_minutes numeric DEFAULT 20 NOT NULL,
  satisfaction_good_percentage numeric DEFAULT 85 NOT NULL,
  satisfaction_warning_percentage numeric DEFAULT 70 NOT NULL,
  individual_peak_good integer DEFAULT 3 NOT NULL,
  individual_peak_warning integer DEFAULT 5 NOT NULL,
  waiting_now_good integer DEFAULT 2 NOT NULL,
  waiting_now_warning integer DEFAULT 5 NOT NULL,
  volume_min_expected integer DEFAULT 1 NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  capacity_ratio_good numeric DEFAULT 2 NOT NULL,
  capacity_ratio_warning numeric DEFAULT 4 NOT NULL,
  risk_satisfaction_drop_points numeric DEFAULT 15 NOT NULL,
  risk_recurrence_rate_warning numeric DEFAULT 20 NOT NULL,
  CONSTRAINT config_metric_thresholds_pkey PRIMARY KEY (id),
  CONSTRAINT config_metric_thresholds_single_row CHECK ((id = 1))
);

-- Histórico de edição e reações de mensagem --------------------------------
CREATE TABLE IF NOT EXISTS public.chat_message_edits (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  message_id uuid NOT NULL,
  previous_text text,
  edited_by uuid,
  edited_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT chat_message_edits_pkey PRIMARY KEY (id),
  CONSTRAINT chat_message_edits_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT chat_message_edits_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_message_edits_message_id ON public.chat_message_edits USING btree (message_id);

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT chat_message_reactions_message_id_user_id_key UNIQUE (message_id, user_id),
  CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT chat_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message_id ON public.chat_message_reactions USING btree (message_id);

CREATE TABLE IF NOT EXISTS public.internal_chat_message_reactions (
  id uuid DEFAULT (md5(((random())::text || (clock_timestamp())::text)))::uuid NOT NULL,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT internal_chat_message_reactions_message_id_user_id_key UNIQUE (message_id, user_id),
  CONSTRAINT internal_chat_message_reactions_pkey PRIMARY KEY (id),
  CONSTRAINT internal_chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES internal_chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT internal_chat_message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_internal_chat_message_reactions_message_id ON public.internal_chat_message_reactions USING btree (message_id);

-- Colunas acrescentadas por migração ---------------------------------------
-- profiles.is_active é a mais crítica da lista: sem ela o login falha na
-- primeira consulta, e era o que impedia este arquivo de subir um banco novo.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS read_by uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS delivered_by uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_in_training boolean DEFAULT false NOT NULL;
-- Logo da empresa-cliente (ver migrations/companies_logo.sql) — mesmo padrão
-- de profiles.avatar_url/avatar_thumb_url.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_thumb_url TEXT;
ALTER TABLE public.internal_chat_messages ADD COLUMN IF NOT EXISTS read_by uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.internal_chat_messages ADD COLUMN IF NOT EXISTS delivered_by uuid[] DEFAULT '{}'::uuid[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_ticket_new boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_ticket_assigned boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_ticket_update boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_ticket_closed boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_chat_new boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_chat_message boolean DEFAULT true;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachments_data jsonb DEFAULT '[]'::jsonb;

-- Arquivamento das listas de configuração (migrations/config_lists_archive.sql)
ALTER TABLE public.config_categories    ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_request_types ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_products      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_effort_levels ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_outcomes      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_config_categories_active    ON public.config_categories (label)    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_config_request_types_active ON public.config_request_types (label) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_config_products_active      ON public.config_products (label)      WHERE archived_at IS NULL;

-- Não incluídas de propósito:
--   public.users             — tabela vazia, sem nenhuma referência no código;
--                              sobra da fase Supabase, não deve ser provisionada.
--   public.schema_migrations — criada e mantida por scripts/run-migrations.js,
--                              que é o dono dela.

-- =========================================================================
-- GIRO DE ATENDIMENTO (migrations/giro_atendimento.sql)
-- =========================================================================
-- Rodízio diário da equipe de suporte. Não confundir com public.queues
-- ("Fila"): a Fila distribui a conversa que CHEGA; o Giro é a ordem em que a
-- equipe se reveza para PEGAR o próximo atendimento, reordenada a cada dia.
-- O detalhamento de cada decisão está na migration; aqui fica só o DDL, para
-- este arquivo continuar provisionando um banco novo por completo.

CREATE TABLE IF NOT EXISTS public.giro_checklist_items (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.giro_participants (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_schedule TEXT,
  position_type TEXT NOT NULL DEFAULT 'free',
  fixed_position INTEGER,
  out_of_rotation BOOLEAN NOT NULL DEFAULT false,
  absent_until TIMESTAMP WITH TIME ZONE,
  absence_note TEXT,
  -- Ordem "programada" dos livres, definida arrastando a lista em
  -- Configuração (migrations/giro_base_order.sql) — base da rotação quando
  -- não há giro anterior pra herdar.
  base_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_participants_position_type_check CHECK (position_type IN ('free', 'fixed'))
);
CREATE INDEX IF NOT EXISTS idx_giro_participants_absent ON public.giro_participants(absent_until);
CREATE INDEX IF NOT EXISTS idx_giro_participants_base_order ON public.giro_participants(base_order);

CREATE TABLE IF NOT EXISTS public.giro_days (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  giro_date DATE NOT NULL UNIQUE,
  handoff_mode TEXT NOT NULL DEFAULT 'auto',
  handoff_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_days_handoff_mode_check CHECK (handoff_mode IN ('auto', 'pinned', 'none'))
);

CREATE TABLE IF NOT EXISTS public.giro_day_rows (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  day_id UUID NOT NULL REFERENCES public.giro_days(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'Chamado',
  service_time TEXT,
  note TEXT,
  lunch_time TEXT,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  work_schedule TEXT,
  is_fixed BOOLEAN NOT NULL DEFAULT false,
  -- Quantas vezes esta linha já foi concluída hoje — quem tem menos vai na
  -- frente (migrations/giro_completed_count.sql). Reseta a cada dia porque a
  -- tabela é recriada do zero.
  completed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_day_rows_unique_user UNIQUE (day_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_giro_day_rows_day ON public.giro_day_rows(day_id, position);
CREATE INDEX IF NOT EXISTS idx_giro_day_rows_user ON public.giro_day_rows(user_id);

CREATE TABLE IF NOT EXISTS public.giro_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  day_id UUID NOT NULL REFERENCES public.giro_days(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  service_time TEXT,
  note TEXT,
  -- Posição que a linha tinha ANTES desta conclusão — permite reverter de
  -- verdade ao excluir o registro (ver deleteHistoryEntry).
  position_before INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giro_history_day ON public.giro_history(day_id, created_at);

INSERT INTO public.giro_checklist_items (label, sort_order) VALUES
  ('VPN',      1),
  ('Bitrix',   2),
  ('Odoo',     3),
  ('Telefone', 4),
  ('Almoço',   5)
ON CONFLICT (label) DO NOTHING;

-- Link da sala de reunião (Meet) do Giro — singleton, cadastrado em
-- Configuração (migrations/giro_meet_settings.sql).
CREATE TABLE IF NOT EXISTS public.giro_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  meet_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_settings_singleton CHECK (id = 'default')
);

-- Horários de almoço configuráveis (migrations/giro_lunch_slots.sql). Cada
-- LINHA é uma vaga — a capacidade de um horário é quantas linhas existem com
-- o mesmo slot_time, não uma coluna de contagem à parte.
CREATE TABLE IF NOT EXISTS public.giro_lunch_slots (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  slot_time TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giro_lunch_slots_time ON public.giro_lunch_slots(slot_time);

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

-- Seed Horários de almoço do Giro (1 vaga às 11h/14h, 4 vagas às 12h/13h)
INSERT INTO public.giro_lunch_slots (slot_time)
SELECT slot_time FROM (VALUES
  ('11:00'),
  ('12:00'), ('12:00'), ('12:00'), ('12:00'),
  ('13:00'), ('13:00'), ('13:00'), ('13:00'),
  ('14:00')
) AS seed(slot_time)
WHERE NOT EXISTS (SELECT 1 FROM public.giro_lunch_slots);

-- Seed Default WhatsApp Channel — a tela de Configurações > WhatsApp sempre
-- usou o id fixo 'default' pro canal Baileys (ver components/whatsapp-
-- connect.tsx), então uma linha correspondente precisa existir pra Fila
-- conseguir listar/vincular esse canal.
INSERT INTO public.whatsapp_instances (id, name, phone, status, provider) VALUES
('default', 'WhatsApp Principal', NULL, 'disconnected', 'baileys')
ON CONFLICT (id) DO NOTHING;

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
  -- Usuário administrador de seed, com senha em hash PBKDF2.
  --
  -- SEM SENHA UTILIZÁVEL, de propósito. Estas mesmas contas existem no banco
  -- de produção e este arquivo é versionado: o hash que ficava aqui usava salt
  -- fixo e correspondia a uma senha trivial, ou seja, quem lesse o repositório
  -- entrava como Administrador. Foi substituído por um marcador que nenhuma
  -- senha satisfaz (o prefixo pbkdf2$ é obrigatório para não cair na
  -- comparação em texto puro de verifyPassword, em lib/auth-utils.ts).
  --
  -- Para liberar o acesso num ambiente novo, gere o hash com a própria função
  -- do projeto e faça o UPDATE:
  --   node -e "console.log(require('./lib/auth-utils').hashPassword('SUA_SENHA'))"
  --   UPDATE public.profiles SET password = '<hash>', must_change_password = TRUE
  --    WHERE email = 'admin@systemsat.com.br';
  INSERT INTO public.profiles (
    id, email, name, role, is_admin, lives_in_squad, company_id, 
    password, must_change_password, view_all_company_tickets
  )
  VALUES (
    v_admin_id, 'admin@systemsat.com.br', 'Admin Supremo', 'Administrador', TRUE, TRUE, 
    '11111111-1111-4111-8111-111111111111'::UUID,
    'pbkdf2$SEM_SENHA_DEFINIDA$SEM_SENHA_DEFINIDA$SEM_SENHA_DEFINIDA',
    TRUE, TRUE
  )
  ON CONFLICT (email) DO NOTHING;

  -- Cliente de seed, mesma observação do administrador acima.
  INSERT INTO public.profiles (
    id, email, name, role, is_admin, lives_in_squad, company_id, 
    password, must_change_password, view_all_company_tickets
  )
  VALUES (
    v_client_id, 'jose@cliente.com', 'José Cliente', 'Cliente', TRUE, FALSE, 
    '11111111-1111-4111-8111-111111111111'::UUID,
    'pbkdf2$SEM_SENHA_DEFINIDA$SEM_SENHA_DEFINIDA$SEM_SENHA_DEFINIDA',
    TRUE, TRUE
  )
  ON CONFLICT (email) DO NOTHING;

  -- Analyst status for Admin
  INSERT INTO public.analyst_status (user_id, is_online, last_active, current_load)
  VALUES (v_admin_id, FALSE, now(), 0)
  ON CONFLICT (user_id) DO NOTHING;
END $$;
