-- Texto literal aprovado na Meta (com os marcadores {{1}}, {{2}}...) — sem
-- isso não dava pra montar um preview fiel da mensagem enviada no nosso
-- próprio chat (o preview antigo só concatenava os VALORES das variáveis).
-- Ver lib/services/pyvon-service.ts (renderTemplateBody).
ALTER TABLE public.pyvon_templates ADD COLUMN IF NOT EXISTS body_text TEXT;
