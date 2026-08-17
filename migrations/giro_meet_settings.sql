-- Link da sala de reunião (Meet) do Giro de Atendimento.
--
-- Não é por dia — é a sala FIXA que o time usa, cadastrada uma vez em
-- Configuração e reaproveitada por todo mundo. Singleton (id sempre
-- 'default', travado pelo CHECK) em vez de uma linha solta em alguma tabela
-- de sistema: fica isolado, óbvio de achar, e não exige migration nova se
-- amanhã este cadastro ganhar mais campos (ex.: link alternativo).
CREATE TABLE IF NOT EXISTS public.giro_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  meet_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_settings_singleton CHECK (id = 'default')
);
