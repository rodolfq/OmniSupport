-- "Prosseguir" não deve mais abrir/expor um chat sozinho (2026-10-21, pedido
-- do usuário). Hoje, a PRIMEIRA mensagem do cliente (mesmo sendo só a
-- palavra "Prosseguir") já cria a conversa via findOrCreateSession, antes
-- até de checar o texto. A mudança: "Prosseguir" entrega o conteúdo da nota
-- e marca a nota do chamado como lida, SEM criar conversa — só a mensagem
-- SEGUINTE (uma resposta de verdade) cria a conversa, já vinculada ao
-- chamado e com a tag "Atualização de Chamado".
--
-- ⚠️ MORATÓRIA DE BANCO (ver CLAUDE.md) — escrito e espelhado em
-- schema_postgres.sql, mas NÃO aplicado contra o DATABASE_URL atual.
-- Aplicar só com autorização explícita do usuário. Tudo aditivo: 4 colunas
-- nullable, nenhum DROP/RENAME/reescrita de dado.

-- Fonte de verdade do "check azul": gravado direto na nota do chamado
-- assim que o cliente digita "Prosseguir" — sobrevive mesmo depois que o
-- pyvon_pending_outbound correspondente for consumido/apagado (ver abaixo).
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS read_by_customer_at TIMESTAMP WITH TIME ZONE;

-- ticket_id/ticket_message_id: de qual chamado/nota este template pendente
-- veio — precisos pra, na resposta de verdade, vincular a conversa nova ao
-- chamado e marcar a nota como lida. read_at: trava de idempotência (uma
-- retentativa de webhook do mesmo "Prosseguir" não reenvia a nota 2x).
ALTER TABLE public.pyvon_pending_outbound
  ADD COLUMN IF NOT EXISTS ticket_id TEXT REFERENCES public.tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ticket_message_id UUID REFERENCES public.ticket_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_pyvon_pending_outbound_ticket_message ON public.pyvon_pending_outbound(ticket_message_id) WHERE ticket_message_id IS NOT NULL;
