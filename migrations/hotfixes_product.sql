-- Indicador de produto no Hotfix — filtra pelos produtos já cadastrados em
-- Configurações (config_products), mesma lista usada no campo "Produto" do
-- chamado (ver migrations/tickets_product.sql).
ALTER TABLE public.hotfixes ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.config_products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hotfixes_product_id ON public.hotfixes(product_id);
