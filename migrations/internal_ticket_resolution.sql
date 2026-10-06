-- Ticket interno: status "Resolvido" (não fecha, continua na fila), sub-status, Entrega Real,
-- Reprovação de QA e Atraso na entrega.
--
-- Entrega Real (resolved_at) é gravada na PRIMEIRA vez que o ticket vira Resolvido e não muda depois.
-- Atraso na entrega (late_delivery) é calculado no mesmo momento: resolvido depois do prazo (sla_limit,
-- em horas úteis, mesma regra do SLA). Reprovação de QA é marcação manual, sem pontuação.
--
-- Aditiva e idempotente. Para reverter: ALTER TABLE ... DROP COLUMN das quatro colunas e DELETE dos
-- status 'Resolvido' e dos sub-status criados aqui (scope = 'internal_ticket').

ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS sub_status TEXT;
ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS qa_rejected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.internal_tickets ADD COLUMN IF NOT EXISTS late_delivery BOOLEAN NOT NULL DEFAULT false;

-- Status "Resolvido": fica na fila (não é is_closed). Concluído passa a vir depois dele.
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order)
VALUES ('Resolvido', 'bg-teal-100 text-teal-700', 'internal_ticket', false, 3)
ON CONFLICT (label, scope) DO NOTHING;

UPDATE public.config_statuses SET sort_order = 4
 WHERE scope = 'internal_ticket' AND label = 'Concluído' AND parent_status_id IS NULL;

-- Sub-status de Resolvido.
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order, parent_status_id)
SELECT s.label, 'bg-teal-50 text-teal-700', 'internal_ticket', false, s.ord, p.id
  FROM (VALUES ('Aguardando Publicação', 0), ('Aguardando Data de Hotfix', 1)) AS s(label, ord)
  CROSS JOIN LATERAL (
    SELECT id FROM public.config_statuses
     WHERE label = 'Resolvido' AND scope = 'internal_ticket' AND parent_status_id IS NULL
  ) p
ON CONFLICT (label, scope) DO NOTHING;

-- Permissões novas, concedidas a quem já tinha a permissão de relatórios (ou de configurar pontuação),
-- para não tirar acesso de ninguém. Administrador já tem todas automaticamente.
UPDATE public.role_permissions
   SET permissions = array_append(permissions, 'reports:internal')
 WHERE 'reports:read' = ANY(permissions) AND NOT ('reports:internal' = ANY(permissions));

UPDATE public.role_permissions
   SET permissions = array_append(permissions, 'internal:rules_config')
 WHERE 'reports:ranking_config' = ANY(permissions) AND NOT ('internal:rules_config' = ANY(permissions));
