-- Canal de origem da conversa ('whatsapp_baileys' | 'whatsapp_meta' | 'pyvon' |
-- 'widget') — antes disso, forwardMessageToWhatsApp (chat-widget.tsx) decidia
-- se espelhava a resposta pro WhatsApp só pela presença de customer_phone, e
-- todo cliente/funcionário logado com telefone cadastrado tinha suas
-- conversas 100% pelo widget tentando (e falhando) enviar pro WhatsApp.
-- NULL = sessão criada antes desta coluna existir (mantém o comportamento
-- antigo, baseado em telefone, até não haver mais sessão aberta assim).
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS channel TEXT;
