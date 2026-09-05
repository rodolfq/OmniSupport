-- Status de encaminhamento pro WhatsApp (Baileys/Meta/Pyvon) de uma mensagem
-- enviada pelo chat — sem isso, uma falha de envio (instância desconectada,
-- limite da Meta atingido, Pyvon em modo de teste, etc.) só aparecia como um
-- toast passageiro, sem nada persistido na mensagem em si. Ver
-- components/chat-widget.tsx (forwardMessageToWhatsApp) e
-- app/api/chats/route.ts (action=update-message-whatsapp-status).
--
-- Só 'sending' / 'sent' / 'failed': 'delivered'/'read' não são incluídos de
-- propósito — o contrato do Pyvon não fornece confirmação de entrega hoje
-- ("hoje o contrato não a fornece"), então mostrar esse estado pra esse canal
-- seria inventar um dado que não temos. NULL = mensagem sem canal WhatsApp
-- associado (chat só-portal) ou anterior a esta coluna.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS whatsapp_status TEXT;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS whatsapp_error TEXT;
