-- Status de treinamento da empresa vira 3 estados (2026-11-19, pedido do
-- usuário) — substitui o campo booleano is_in_training ("Cliente em
-- Treinamento") por training_status TEXT: NULL (nenhum status),
-- 'em_treinamento' ou 'treinamento_concluido'.
--
-- training_origin / training_started_at / training_removed_at
-- (migrations/company_training_auto.sql) continuam existindo com o mesmo
-- papel — só passam a rastrear o campo novo em vez do booleano antigo:
--   training_started_at  quando o status atual virou 'em_treinamento'
--   training_removed_at  última vez que SAIU de 'em_treinamento' (pra vazio
--                        OU pra 'treinamento_concluido') — é o que impede a
--                        importação da Planilha de CS de reaplicar sozinha
--   training_origin      de onde veio o status atual ('planilha' | 'manual'
--                        | 'integracao'), NULL quando o status é vazio
--
-- Backfill (decisão do usuário, 2026-11-19 — conferido contra o banco de dev
-- antes de aplicar: 79 empresas 'em_treinamento', 7 já removidas do
-- treinamento antes, 363 sem nunca ter entrado):
--   is_in_training = true                                    -> 'em_treinamento'
--   is_in_training = false AND training_removed_at NOT NULL  -> 'treinamento_concluido'
--   caso contrário                                           -> NULL
--
-- Aditiva (coluna + constraint) + troca do gatilho + DROP de is_in_training
-- no final. Idempotente: segura pra rodar de novo mesmo depois do DROP já
-- ter acontecido (guardada por information_schema/pg_constraint).

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS training_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_training_status_check'
  ) THEN
    ALTER TABLE public.companies ADD CONSTRAINT companies_training_status_check
      CHECK (training_status IS NULL OR training_status IN ('em_treinamento', 'treinamento_concluido'));
  END IF;
END $$;

-- O gatilho antigo (BEFORE ... OF is_in_training) trava o DROP COLUMN
-- abaixo por depender dela — precisa sair ANTES do backfill/drop. A versão
-- nova (sobre training_status) é recriada depois, mais abaixo.
DROP TRIGGER IF EXISTS trg_companies_training_track ON public.companies;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'is_in_training'
  ) THEN
    UPDATE public.companies SET training_status = CASE
      WHEN is_in_training = true THEN 'em_treinamento'
      WHEN is_in_training = false AND training_removed_at IS NOT NULL THEN 'treinamento_concluido'
      ELSE NULL
    END
    WHERE training_status IS NULL;

    ALTER TABLE public.companies DROP COLUMN is_in_training;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.companies_training_track() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.training_status = 'em_treinamento' THEN
      NEW.training_started_at := COALESCE(NEW.training_started_at, now());
    END IF;
    IF NEW.training_status IS NOT NULL THEN
      NEW.training_origin := COALESCE(NEW.training_origin, 'manual');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.training_status IS DISTINCT FROM OLD.training_status THEN
    IF NEW.training_status IS NOT NULL THEN
      IF NEW.training_status = 'em_treinamento' THEN
        NEW.training_started_at := now();
      END IF;
      -- quem muda informa a origem no mesmo UPDATE; sem informar, é manual.
      IF NEW.training_origin IS NOT DISTINCT FROM OLD.training_origin THEN
        NEW.training_origin := 'manual';
      END IF;
    ELSE
      NEW.training_origin := NULL;
    END IF;
    -- Saiu de "em_treinamento" (pra vazio OU pra "treinamento_concluido") —
    -- mesma marca de "não reaplicar automaticamente" de antes.
    IF OLD.training_status = 'em_treinamento' THEN
      NEW.training_removed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_training_track ON public.companies;
CREATE TRIGGER trg_companies_training_track
  BEFORE INSERT OR UPDATE OF training_status ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.companies_training_track();
