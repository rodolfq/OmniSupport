-- Pedido do usuário (2026-10-06): chamar o cliente pelo WhatsApp quando ele já
-- tem uma conversa aberta pelo portal fazia a mensagem cair na conversa do
-- portal — aparecia como "enviada" no chat, mas nunca saía pro WhatsApp
-- (forwardMessageToWhatsApp ignora sessão de canal 'widget' de propósito).
--
-- Com o índice antigo (uma conversa aberta por TELEFONE, qualquer canal), não
-- havia como ter a conversa do WhatsApp e a do portal abertas ao mesmo tempo
-- pro mesmo número. Passa a ser uma por telefone POR CANAL: a conversa do
-- WhatsApp (channel 'pyvon') e a do portal (channel 'widget') convivem.
--
-- Estreitar um índice único só afrouxa a regra: o conjunto de linhas da versão
-- nova é um superconjunto da antiga, então nenhum dado existente pode violá-la
-- e não há perda de dado. Idempotente (pode rodar de novo sem efeito).

DROP INDEX IF EXISTS public.uq_chat_sessions_open_phone;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_open_phone
  ON public.chat_sessions (customer_phone, channel)
  WHERE status <> 'closed' AND customer_phone IS NOT NULL;
