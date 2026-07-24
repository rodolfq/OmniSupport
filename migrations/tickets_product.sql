-- Item 2 do roadmap de melhorias: campo de Produto no chamado.
-- Seleção única (não N:N), lista simples sem toggle ativo/inativo — mesmo
-- padrão de config_categories/config_request_types (ver
-- migrations/tickets_team_category_request_type.sql).
-- Sem seed inicial (lista nova) e sem backfill (não existe dado anterior).

CREATE TABLE IF NOT EXISTS public.config_products (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.config_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_product_id ON public.tickets(product_id);
