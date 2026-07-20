-- API de integração externa: chaves usadas por plataformas terceiras para
-- consultar/cadastrar funcionários e consultar chamados/conversas via
-- /api/integrations/v1/*. Tabela nova e independente — não altera nada
-- existente. Ver components/integrations-content.tsx para a UI de gestão.
CREATE TABLE IF NOT EXISTS public.integration_api_keys (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_api_keys_prefix ON public.integration_api_keys(key_prefix);
