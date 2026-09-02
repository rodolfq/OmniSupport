-- Id do cliente no sistema "Central", vindo da planilha de CS que substitui
-- o sync do Bitrix24 para empresas (ver lib/services/customer-sheet-service.ts).
-- Não é único: um mesmo id_central pode aparecer em mais de uma empresa
-- quando duas marcas/CNPJs compartilham a mesma conta central.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS id_central TEXT;
