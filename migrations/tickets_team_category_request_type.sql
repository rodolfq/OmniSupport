-- Item 1 do roadmap de melhorias: separa tickets.category (hoje usado de
-- forma confusa como "Equipe" no modal de chamado e como "Categoria" na
-- tela de Configurações) em três conceitos independentes:
--   - Fila              -> tickets.queue_id        -> queues (já existente)
--   - Categoria         -> tickets.category_id     -> config_categories
--   - Tipo de Solicitação -> tickets.request_type_id -> config_request_types (nova)
--
-- "Fila" é só um campo de seleção manual/exibição — não dispara nenhuma
-- distribuição automática (lib/services/queue-routing.ts continua baseado só
-- em status online) e não é replicado em internal_tickets.
--
-- A coluna antiga tickets.category NÃO é tocada aqui de propósito: ela
-- continua existindo (lida hoje por app/api/integrations/v1/tickets/route.ts,
-- uma API pública de integração externa) e só deve ser renomeada/removida
-- numa migration futura separada, depois que o código novo estiver estável
-- em produção. Fase aditiva pura — segura para rodar antes do deploy.
--
-- Bugfix de brinde (mesma área de código): tickets.tags nunca existiu como
-- coluna, embora app/api/tickets/route.ts (PATCH em lote) e
-- TicketService.update() (modal de detalhe) já tentassem gravar nela.

CREATE TABLE IF NOT EXISTS public.config_request_types (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- queues.id é TEXT (ex: 'q1'), não UUID como as demais tabelas de lookup.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS queue_id TEXT REFERENCES public.queues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.config_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS request_type_id UUID REFERENCES public.config_request_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_tickets_queue_id ON public.tickets(queue_id);
CREATE INDEX IF NOT EXISTS idx_tickets_category_id ON public.tickets(category_id);
CREATE INDEX IF NOT EXISTS idx_tickets_request_type_id ON public.tickets(request_type_id);

-- Sem backfill: Fila, Categoria e Tipo de Solicitação ficam em branco nos
-- chamados existentes (não há como mapear o texto livre de category com
-- segurança para nenhuma das três listas novas), preenchidos só dali pra
-- frente.

-- Deixa disponível pro app genérico de compat Supabase (getNativeArrayColumns
-- em app/api/compat/supabase/route.ts) reconhecer a nova coluna array em
-- runtime; nenhuma ação manual adicional é necessária além de reiniciar o
-- processo Node depois de aplicar esta migration.
