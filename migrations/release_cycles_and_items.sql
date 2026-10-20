-- Reestruturação do ciclo de publicação (pedido do usuário, 2026-10-19,
-- mesmo dia da primeira versão): "Ciclo" passa a ser um intervalo de tempo
-- com UMA timeline compartilhada; "Hotfix" e "Publicação" (Emergencial/
-- Prevista) deixam de ser uma categoria de UM registro e passam a ser
-- ITENS independentes — vários de cada — dentro do mesmo ciclo.
--
-- Substitui por completo hotfix_stages/hotfix_stage_tickets (criadas hoje
-- mais cedo, migrations/release_timeline.sql) — confirmado por leitura
-- antes de aplicar que só havia dado de TESTE (2 publicações "Exemplo",
-- zero chamado vinculado), nada de produção pra migrar. A tabela legada
-- `hotfixes` (fluxo achatado, sem ciclo, já existia antes de hoje) e
-- `release_templates`/`release_template_stages` continuam existindo —
-- só perdem a coluna `category`/`category` respectivamente, que não faz
-- mais sentido nesse nível (ver abaixo).

-- 1) Ciclo: intervalo de tempo com a timeline compartilhada.
CREATE TABLE public.release_cycles (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  description TEXT,
  template_id UUID REFERENCES public.release_templates(id) ON DELETE SET NULL,
  anchor_date DATE,
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at TIMESTAMP WITH TIME ZONE, -- trava o ciclo inteiro quando a ÚLTIMA etapa é concluída
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 2) Etapas do ciclo — a timeline COMPARTILHADA (mesma forma de antes,
-- só que agora pertence ao ciclo, não a um hotfix).
CREATE TABLE public.release_cycle_stages (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  cycle_id UUID NOT NULL REFERENCES public.release_cycles(id) ON DELETE CASCADE,
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
  notified_start_at TIMESTAMP WITH TIME ZONE,
  notified_overdue_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CHECK (end_date >= start_date),
  CHECK (planned_end_date >= planned_start_date)
);
CREATE INDEX IF NOT EXISTS idx_release_cycle_stages_cycle_id ON public.release_cycle_stages(cycle_id);
CREATE INDEX IF NOT EXISTS idx_release_cycle_stages_dates ON public.release_cycle_stages(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_release_cycle_stages_team_id ON public.release_cycle_stages(team_id);

-- 3) Item dentro do ciclo: um Hotfix ou uma Publicação (Emergencial/
-- Prevista) de verdade. Vários itens, de tipos diferentes, no mesmo ciclo.
-- current_stage_id é só a posição NA timeline compartilhada pra exibição —
-- mover um item de etapa não toca em datas de ninguém.
CREATE TABLE public.release_items (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  cycle_id UUID NOT NULL REFERENCES public.release_cycles(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotfix', 'emergencial', 'prevista')),
  name TEXT NOT NULL,
  description TEXT,
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  current_stage_id UUID REFERENCES public.release_cycle_stages(id) ON DELETE SET NULL,
  completed_at TIMESTAMP WITH TIME ZONE, -- um item pode terminar antes do ciclo inteiro travar
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_release_items_cycle_id ON public.release_items(cycle_id);
CREATE INDEX IF NOT EXISTS idx_release_items_current_stage_id ON public.release_items(current_stage_id);

-- 4) Chamado de CLIENTE vinculado ao ITEM (antes era à etapa — não fazia
-- sentido linkar chamado a um estágio genérico do pipeline).
CREATE TABLE public.release_item_tickets (
  release_item_id UUID NOT NULL REFERENCES public.release_items(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (release_item_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_release_item_tickets_ticket ON public.release_item_tickets(ticket_id);

-- 5) Ticket interno passa a linkar no ITEM, não na etapa.
ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS release_item_id UUID REFERENCES public.release_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_internal_tickets_release_item_id ON public.internal_tickets(release_item_id);

-- 6) Limpeza do que a 1ª versão (migrations/release_timeline.sql) criou
-- hoje mais cedo, sem uso real (confirmado antes de rodar: só dado de
-- teste). category sai de release_templates (modelo de ciclo não é mais
-- por categoria — categoria agora é do ITEM) e de hotfixes (idem; o fluxo
-- achatado nunca teve ciclo de verdade).
ALTER TABLE public.internal_tickets DROP COLUMN IF EXISTS hotfix_stage_id;
DROP TABLE IF EXISTS public.hotfix_stage_tickets;
DROP TABLE IF EXISTS public.hotfix_stages;
ALTER TABLE public.hotfixes DROP COLUMN IF EXISTS category;
ALTER TABLE public.hotfixes DROP COLUMN IF EXISTS template_id;
ALTER TABLE public.hotfixes DROP COLUMN IF EXISTS anchor_date;
ALTER TABLE public.release_templates DROP COLUMN IF EXISTS category;
