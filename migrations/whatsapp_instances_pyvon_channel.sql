-- Canal padrão (Pyvon) a usar quando o tenant tem mais de um canal oficial
-- ativo (Suporte, Comercial, etc.) — sem isso, bot-response/bot-template
-- respondem 422 "Mais de um canal oficial ativo: informe channel_id".
-- NULL continua funcionando normal em tenants com um canal só.
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS pyvon_channel_id INTEGER;
