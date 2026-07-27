-- Canal de e-mail em Mensagens Automáticas — cada evento passa a ter, além
-- do WhatsApp, um toggle e assunto próprios de e-mail. automation_dispatches
-- ganha `channel` pra diferenciar despachos atrasados de cada canal.
ALTER TABLE public.automation_settings ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.automation_settings ADD COLUMN IF NOT EXISTS email_subject TEXT;
ALTER TABLE public.automation_dispatches ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public.automation_dispatches ADD COLUMN IF NOT EXISTS recipient_email TEXT;
ALTER TABLE public.automation_dispatches ADD COLUMN IF NOT EXISTS subject TEXT;

-- Ativa e-mail agora pros 2 eventos pedidos (abertura/fechamento pro
-- cliente) — os demais eventos ficam com e-mail desligado por padrão, o
-- admin liga quando quiser em Configurações > Mensagens Automáticas.
UPDATE public.automation_settings SET email_enabled = true, email_subject = 'Chamado {{numero_chamado}} aberto — {{titulo}}' WHERE event_key = 'novo_chamado';
UPDATE public.automation_settings SET email_enabled = true, email_subject = 'Chamado {{numero_chamado}} finalizado — {{titulo}}' WHERE event_key = 'chamado_finalizado';
