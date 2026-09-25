-- Cursor do rodízio por fila: quem recebeu a ÚLTIMA distribuição automática.
--
-- Por que existe (2026-09-25): o rodízio (lib/services/queue-routing.ts,
-- pickNextQueueAssignee) descobria "quem recebeu por último" olhando o
-- responsável da conversa CRIADA mais recentemente. Devolver uma conversa ANTIGA
-- pra fila não mexe nisso (ela não é a mais recente por data de criação), então
-- toda devolução recalculava o MESMO ponteiro e caía sempre no mesmo analista —
-- foi o que aconteceu às 17h com as conversas do Mauro: as 4 foram pra Bianca
-- (o ponteiro era o Pedro, criado 17:05:13, e a próxima depois dele é a Bianca).
--
-- O cursor registra cada escolha do rodízio (criação, devolução, redistribuição).
-- O ponteiro passa a ser o mais RECENTE entre o cursor e a conversa criada mais
-- recentemente, então o fluxo normal continua igual e a devolução em sequência
-- anda pra frente (Bianca, Pablo, ...). Chave 'combined' = pool combinado do widget.
--
-- Aditiva: só cria uma tabela. Se ela não existir (deploy fora de ordem) o
-- rodízio cai no comportamento antigo, sem quebrar.

CREATE TABLE IF NOT EXISTS public.queue_rotation_cursor (
  queue_key TEXT PRIMARY KEY,
  assignee_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
