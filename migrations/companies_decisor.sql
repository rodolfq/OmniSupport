-- Decisor (nome do contato decisor na empresa-cliente) e telefone dele,
-- importados da planilha de CS (colunas AE/AF) — ver
-- lib/services/customer-sheet-service.ts. TEXT simples: é um contato externo,
-- não um usuário do sistema (diferente de cs_responsavel_id/comercial_responsavel_id).
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS decisor_nome TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS decisor_telefone TEXT;
