-- Estende config_statuses para suportar: escopo (Chamados vs Tickets Internos,
-- cada um com sua própria lista), status que "finaliza o chamado" (além do
-- Concluído fixo), ordenação manual e sub-status (hierarquia simples).
ALTER TABLE public.config_statuses ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'ticket';
ALTER TABLE public.config_statuses ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.config_statuses ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.config_statuses ADD COLUMN IF NOT EXISTS parent_status_id UUID REFERENCES public.config_statuses(id) ON DELETE CASCADE;

-- "label" era único globalmente; agora só precisa ser único dentro do mesmo
-- escopo (Chamados e Tickets Internos podem ambos ter, por exemplo, "Concluído").
ALTER TABLE public.config_statuses DROP CONSTRAINT IF EXISTS config_statuses_label_key;
CREATE UNIQUE INDEX IF NOT EXISTS config_statuses_label_scope_key ON public.config_statuses(label, scope);

CREATE INDEX IF NOT EXISTS idx_config_statuses_scope ON public.config_statuses(scope);
CREATE INDEX IF NOT EXISTS idx_config_statuses_parent ON public.config_statuses(parent_status_id);

-- Todo o seed original era usado só por Chamados.
UPDATE public.config_statuses SET scope = 'ticket' WHERE scope IS NULL OR scope = '';

-- Marca como "finaliza o chamado" os que a lógica hardcoded (lib/ticket-status.ts)
-- já tratava como fechados.
UPDATE public.config_statuses SET is_closed = true WHERE label IN ('Fechado', 'Mesclado') AND scope = 'ticket';

-- Ordem manual pros status de Chamados já existentes, preservando a ordem em
-- que apareciam no seed original.
UPDATE public.config_statuses SET sort_order = 0 WHERE label = 'Novo' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 1 WHERE label = 'Em Atendimento' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 2 WHERE label = 'Pendente' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 3 WHERE label = 'Aguardando Cliente' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 4 WHERE label = 'Aguardando Aprovação' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 5 WHERE label = 'Resolvido' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 6 WHERE label = 'Fechado' AND scope = 'ticket';
UPDATE public.config_statuses SET sort_order = 7 WHERE label = 'Mesclado' AND scope = 'ticket';

-- Garante que "Concluído" sempre existe como opção que finaliza — tanto para
-- Chamados (não existia antes; só havia "Fechado") quanto para Tickets Internos.
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order)
VALUES ('Concluído', 'bg-emerald-100 text-emerald-700', 'ticket', true, 100)
ON CONFLICT (label, scope) DO UPDATE SET is_closed = true;

-- Status de Tickets Internos (hoje hardcoded em dashboard/page.tsx,
-- internal-tickets/page.tsx e internal-tickets/[id]/page.tsx) — passam a
-- viver no banco, editáveis pela tela de Configurações > Geral do Sistema.
INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order) VALUES
('Novo', 'bg-blue-100 text-blue-700', 'internal_ticket', false, 0),
('Em Andamento', 'bg-amber-100 text-amber-700', 'internal_ticket', false, 1),
('Em Espera', 'bg-slate-100 text-slate-700', 'internal_ticket', false, 2),
('Concluído', 'bg-emerald-100 text-emerald-700', 'internal_ticket', true, 3)
ON CONFLICT (label, scope) DO NOTHING;
