-- Tags vinculadas em tempo real pelo atendente durante o atendimento (ids de
-- config_tags, domain='chat'). Array de texto solto, sem FK — mesmo padrão já
-- usado em tickets.tags.
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
