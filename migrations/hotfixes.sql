-- Item 17 do roadmap: cadastro de Hotfix / janela de release.
-- Módulo novo e isolado — nome, responsável, data prevista de publicação.
-- alerted_at marca quando o scheduler de fundo (lib/services/hotfix-scheduler.ts)
-- já notificou o responsável por atraso, evitando alertar de novo a cada rodada.
CREATE TABLE IF NOT EXISTS public.hotfixes (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  name TEXT NOT NULL,
  description TEXT,
  responsible_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  expected_date DATE NOT NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  alerted_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hotfixes_expected_date ON public.hotfixes(expected_date);
