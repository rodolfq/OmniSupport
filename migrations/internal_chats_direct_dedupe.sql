-- Evita duplicidade de conversa 1:1 no chat interno. Antes só existia
-- checagem de duplicata do lado do client (rooms.find em
-- app/(portal)/chat-internal/page.tsx), frágil a corrida entre abas/cliques
-- rápidos, e um segundo fluxo de criação (modal "Novo Grupo" com só 1 membro
-- selecionado) que nunca checava nada. Índice único parcial garante, no
-- banco, no máximo uma conversa type='direct' por par de membros.
--
-- Rodar scripts/diagnostics/apply_internal_chats_dedupe.ts ANTES desta
-- migration numa base com dados reais — ele mescla duplicatas existentes
-- (histórico de mensagens + preferências) antes de criar o índice, senão o
-- CREATE UNIQUE INDEX falha com dados que já violam a constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_chats_direct_pair
  ON public.internal_chats (
    (LEAST(member_ids[1], member_ids[2])),
    (GREATEST(member_ids[1], member_ids[2]))
  )
  WHERE type = 'direct' AND cardinality(member_ids) = 2;
