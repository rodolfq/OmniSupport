-- Item 14 do roadmap: estratégia de distribuição configurável por fila.
-- 'round_robin' preserva o comportamento atual (default); 'daily_balance' é
-- a nova opção, nivela pela quantidade de chats recebidos hoje.
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS routing_strategy TEXT NOT NULL DEFAULT 'round_robin';
