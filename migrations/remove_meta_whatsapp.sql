-- Remove a integração direta com a Meta Cloud API (pedido do usuário,
-- 2026-09-17) — só Baileys e Pyvon a partir de agora. Zero linhas com
-- provider='meta' em produção na hora desta migration (confirmado antes de
-- rodar), então é seguro descartar as colunas Meta-específicas direto.
-- access_token NÃO é tocado: é reaproveitado pelo Pyvon (guarda o
-- X-Pyvon-Secret do tenant).
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS phone_number_id;
ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS verify_token;
