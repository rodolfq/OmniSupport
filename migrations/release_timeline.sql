-- Ciclo de publicação com etapas (templates + timeline interativa).
-- Pedido do usuário, 2026-10-19: generalizar "Hotfix" (hoje um registro
-- achatado, 1 data só) num ciclo de várias etapas, com modelos reutilizáveis
-- por categoria (Hotfix / Publicação Emergencial / Publicação Prevista),
-- vínculo de chamado (cliente e/ou ticket interno) por etapa, responsável por
-- pessoa e/ou equipe, log de mudança de data (audit_log) e trava só no fim do
-- ciclo (quando a ÚLTIMA etapa é concluída — reaproveita hotfixes.published_at
-- como o marcador de "ciclo inteiro travado", mesmo campo que já existia).
--
-- Tudo aditivo: tabelas novas + colunas novas com DEFAULT, nenhum DROP/RENAME
-- em coluna ou tabela existente. hotfixes, internal_tickets e tickets
-- continuam com o mesmo nome e as mesmas colunas de sempre — só ganham
-- colunas novas, nunca obrigatórias para quem não usa o recurso novo.
--
-- Idempotente: pode ser rodada de novo contra um banco que já a tem.

-- 1) Modelos reutilizáveis de ciclo (ex.: "Ciclo Padrão de Hotfix").
CREATE TABLE IF NOT EXISTS public.release_templates (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'hotfix' CHECK (category IN ('hotfix', 'emergencial', 'prevista')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_templates_category ON public.release_templates(category);

-- 2) Etapas do modelo — datas guardadas como deslocamento (em dias) a partir
-- da "data-âncora" que cada publicação concreta vai informar na criação.
CREATE TABLE IF NOT EXISTS public.release_template_stages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  template_id UUID NOT NULL REFERENCES public.release_templates(id) ON DELETE CASCADE,
  stage_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  icon TEXT,
  offset_start_days INTEGER NOT NULL DEFAULT 0,
  offset_end_days INTEGER NOT NULL DEFAULT 0,
  default_team_id UUID REFERENCES public.internal_teams(id) ON DELETE SET NULL,
  default_responsible_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CHECK (offset_end_days >= offset_start_days)
);
CREATE INDEX IF NOT EXISTS idx_release_template_stages_template_id ON public.release_template_stages(template_id);

-- 3) hotfixes ganha o conceito de categoria + de onde nasceu (modelo + data-
-- âncora). expected_date/published_at/responsible_id/product_id continuam
-- exatamente como eram — quem não usa modelo nem etapa nunca percebe a
-- diferença (fluxo achatado de sempre, só com category default 'hotfix').
ALTER TABLE public.hotfixes
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'hotfix' CHECK (category IN ('hotfix', 'emergencial', 'prevista')),
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.release_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anchor_date DATE;
CREATE INDEX IF NOT EXISTS idx_hotfixes_category ON public.hotfixes(category);

-- 4) Etapas de UMA publicação concreta (geradas do modelo, ou criadas à mão).
-- planned_start_date/planned_end_date são congeladas na criação da etapa e
-- NUNCA mudam depois — servem de referência pro "planejado x realizado" na
-- timeline (ghost bar) mesmo depois de start_date/end_date serem arrastados.
CREATE TABLE IF NOT EXISTS public.hotfix_stages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  hotfix_id UUID NOT NULL REFERENCES public.hotfixes(id) ON DELETE CASCADE,
  template_stage_id UUID REFERENCES public.release_template_stages(id) ON DELETE SET NULL,
  stage_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#2563eb',
  icon TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  team_id UUID REFERENCES public.internal_teams(id) ON DELETE SET NULL,
  responsible_ids UUID[] NOT NULL DEFAULT '{}',
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  -- Dedupe de notificação por etapa (mesmo padrão de hotfixes.alerted_at):
  -- evita mandar o mesmo aviso de "começa em breve"/"atrasada" a cada rodada
  -- do scheduler.
  notified_start_at TIMESTAMP WITH TIME ZONE,
  notified_overdue_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (planned_end_date >= planned_start_date)
);
CREATE INDEX IF NOT EXISTS idx_hotfix_stages_hotfix_id ON public.hotfix_stages(hotfix_id);
CREATE INDEX IF NOT EXISTS idx_hotfix_stages_dates ON public.hotfix_stages(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_hotfix_stages_team_id ON public.hotfix_stages(team_id);

-- 5) Vínculo de CHAMADO DE CLIENTE por etapa (tickets internos já tinham
-- hotfix_id solto — ganham hotfix_stage_id granular abaixo). Mesmo padrão de
-- public.ticket_internal_links (tabela de junção simples).
CREATE TABLE IF NOT EXISTS public.hotfix_stage_tickets (
  hotfix_stage_id UUID NOT NULL REFERENCES public.hotfix_stages(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (hotfix_stage_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_hotfix_stage_tickets_ticket ON public.hotfix_stage_tickets(ticket_id);

-- 6) Ticket interno ganha o vínculo fino por etapa. hotfix_id (coluna antiga)
-- continua existindo e é mantido em sincronia pela própria aplicação ao
-- linkar/deslinkar por aqui — nenhum código antigo que só lê hotfix_id
-- precisa mudar.
ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS hotfix_stage_id UUID REFERENCES public.hotfix_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_internal_tickets_hotfix_stage_id ON public.internal_tickets(hotfix_stage_id);

-- 7) Permissão nova: ver a timeline sem poder editar. hotfixes:manage
-- continua existindo e passa a significar "editar" (criar/editar
-- publicação, arrastar data, linkar chamado, gerenciar modelo). Backfill:
-- quem já tinha hotfixes:manage ganha hotfixes:view também, pra não perder
-- nenhum acesso que já tinha de forma implícita (hoje manage também servia
-- pra ver).
UPDATE public.role_permissions
   SET permissions = array_append(permissions, 'hotfixes:view')
 WHERE 'hotfixes:manage' = ANY(permissions)
   AND NOT ('hotfixes:view' = ANY(permissions));
