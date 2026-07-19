-- Permite que o admin desative, por fila, a participação no pool combinado de
-- chats internos (conversas de usuário logado via widget, sem instância de
-- WhatsApp vinculada) — ver resolveCombinedQueuePool em lib/services/queue-routing.ts.
-- Default true preserva o comportamento atual (todas as filas participam).
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS include_internal_chats BOOLEAN NOT NULL DEFAULT true;
