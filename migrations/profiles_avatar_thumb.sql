-- Versão minúscula (48px, JPEG comprimido) de avatar_url, gerada a partir da
-- foto original — pra listas que mostram muitos avatares de uma vez (Chamados,
-- Tickets Internos) não precisarem baixar a foto original de cada analista
-- (algumas com MBs, vindas do sync do Bitrix24 sem redimensionar).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_thumb_url TEXT;
