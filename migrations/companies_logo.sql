-- Logo da empresa-cliente, mesmo padrão de profiles.avatar_url/avatar_thumb_url:
-- logo_url guarda a imagem inteira como `data:` URL (servida via
-- /api/companies/[id]/logo, nunca embutida em listagem); logo_thumb_url é uma
-- miniatura pequena (gerada com sharp, ver lib/services/logo-thumb-service.ts)
-- barata o bastante para ir embutida direto na sidebar/header do portal.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_thumb_url TEXT;
