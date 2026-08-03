-- Adiciona suporte à Meta Cloud API como segundo provedor de canal de
-- WhatsApp, ao lado do Baileys/QR Code já existente. Cada linha de
-- whatsapp_instances passa a ter um provider ('baileys' ou 'meta'); os
-- campos meta-específicos ficam NULL para canais Baileys.
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'baileys';
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS access_token TEXT;
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS phone_number_id TEXT;
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS verify_token TEXT;

-- A tela de Configurações > WhatsApp sempre usou o id fixo 'default' pro
-- canal Baileys (ver components/whatsapp-connect.tsx), mas nunca gravou uma
-- linha correspondente em whatsapp_instances — a tabela ficava vazia mesmo
-- com o WhatsApp conectado, e a Fila não tinha o que listar pra vincular um
-- canal. Semeia essa linha pra representar o canal Baileys que já existe na
-- prática, sem depender de alguém abrir a nova tela de canais primeiro.
INSERT INTO public.whatsapp_instances (id, name, phone, status, provider)
VALUES ('default', 'WhatsApp Principal', NULL, 'disconnected', 'baileys')
ON CONFLICT (id) DO NOTHING;
