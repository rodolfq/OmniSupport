-- Vincular um contato a um cliente que já tem OUTRA conversa aberta em outro
-- canal (ex.: conversa do Pyvon + conversa do WhatsApp por QR Code, mesma
-- pessoa) estourava:
--   duplicate key value violates unique constraint "uq_chat_sessions_open_customer"
--
-- Esse índice nasceu (migrations/chat_sessions_unique_open_customer.sql) pra
-- corrida do WIDGET: duas montagens quase simultâneas criando duas sessões do
-- mesmo cliente logado. Só o canal 'widget' precisa dessa garantia — conversa de
-- WhatsApp/Pyvon já é única por telefone (uq_chat_sessions_open_phone), e a
-- mesma pessoa pode ter, legitimamente, conversas abertas em canais/números
-- diferentes. Do jeito antigo, o mesmo índice também derrubava a entrada de
-- mensagem (pyvon-service/whatsapp-service: ON CONFLICT só trata o telefone) de
-- quem já tinha outra conversa aberta e cadastro com este telefone.
--
-- Estreitar um índice único só afrouxa a regra: o conjunto de linhas da versão
-- nova é subconjunto da antiga, então nenhum dado existente pode violá-la e não
-- há perda de dado. Idempotente (pode rodar de novo sem efeito).

DROP INDEX IF EXISTS public.uq_chat_sessions_open_customer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_open_customer
  ON public.chat_sessions (customer_id)
  WHERE status <> 'closed' AND customer_id IS NOT NULL AND channel = 'widget';
