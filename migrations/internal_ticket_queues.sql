-- Filas de ticket interno (2026-11-13, pedido do usuário).
--
-- Separa "do que o ticket interno trata" (fila) de "onde a pessoa trabalha"
-- (equipe, internal_teams — que continua igual: perfis, permissões,
-- administradores). A fila substitui o campo "Equipe" no ticket interno: cada
-- fila tem os próprios membros (uma pessoa pode estar em várias), e o
-- Responsável do ticket é escolhido entre os membros da fila.
--
-- NÃO confundir com public.queues (filas de ATENDIMENTO, distribuição de
-- conversa de chat/WhatsApp) — são coisas diferentes.
--
-- Tickets que já existem ficam SEM fila (decisão do usuário): continuam
-- mostrando a equipe antiga (team_id / internal_team_id), só para consulta.
--
-- Postgres de produção é antigo, sem gen_random_uuid() — mesmo padrão md5 das
-- outras migrations. Idempotente.

CREATE TABLE IF NOT EXISTS public.internal_ticket_queues (
  id UUID PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text)::uuid,
  name TEXT NOT NULL,
  member_ids UUID[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_ticket_queues_name
  ON public.internal_ticket_queues (lower(name));
CREATE INDEX IF NOT EXISTS idx_internal_ticket_queues_members
  ON public.internal_ticket_queues USING GIN (member_ids);

ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS internal_queue_id UUID
  REFERENCES public.internal_ticket_queues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_internal_tickets_queue
  ON public.internal_tickets (internal_queue_id);

-- As 13 filas pedidas, sem membros (cada uma é configurada pela tela).
INSERT INTO public.internal_ticket_queues (name, sort_order)
SELECT v.name, v.ord
  FROM (VALUES
    ('Backlog', 1),
    ('CS - Pós vendas', 2),
    ('Desenvolvimento - Câmeras', 3),
    ('Desenvolvimento - Exceção Portal', 4),
    ('Desenvolvimento - Globalbus', 5),
    ('Desenvolvimento - Infinity', 6),
    ('Desenvolvimento - Mobile', 7),
    ('Desenvolvimento - Serviços', 8),
    ('Desenvolvimento - Testes', 9),
    ('Desenvolvimento - Web', 10),
    ('Fábrica de software', 11),
    ('Infra - Banco de Dados', 12),
    ('Suporte - MOVA', 13)
  ) AS v(name, ord)
 WHERE NOT EXISTS (SELECT 1 FROM public.internal_ticket_queues q WHERE lower(q.name) = lower(v.name));

-- Permissão nova "internal:queues_manage" (configurar filas e membros):
-- concedida a quem já configura ticket interno (settings:system_internal ou
-- settings:system), pra ninguém perder acesso. Administrador tem sempre.
UPDATE public.role_permissions
   SET permissions = array_append(permissions, 'internal:queues_manage')
 WHERE ('settings:system_internal' = ANY(permissions) OR 'settings:system' = ANY(permissions))
   AND NOT ('internal:queues_manage' = ANY(permissions));
