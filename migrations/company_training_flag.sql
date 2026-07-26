-- "Sincronismo com Radar" nunca chegou a ser usado (rótulo antigo já dizia
-- "uso futuro em integração") — reaproveita a mesma coluna booleana pra um
-- propósito real: marcar empresa em treinamento, com indicação visível só
-- pra equipe interna no chat (ver components/chat-widget.tsx).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'radar_sync'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'is_in_training'
  ) THEN
    ALTER TABLE public.companies RENAME COLUMN radar_sync TO is_in_training;
  END IF;
END $$;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_in_training BOOLEAN NOT NULL DEFAULT false;
