-- Empresa "em treinamento" atribuída pela importação da planilha de CS
-- (2026-09-28).
--
-- Regra de negócio (pedido do usuário): toda empresa com data de entrada
-- (coluna D da planilha, "4 - Entrada") de 2026 em diante entra em treinamento
-- AUTOMATICAMENTE pela importação — e só por ela. Depois que o status é
-- removido, a importação NUNCA o devolve; só volta manualmente, por quem tem a
-- permissão customers:training.
--
-- Para a regra valer em QUALQUER caminho de escrita (tela, API de integração,
-- SQL na mão) e não só onde a aplicação lembrar, quem registra a remoção é um
-- gatilho: toda vez que is_in_training vai de true para false, grava
-- training_removed_at — e é esse campo que a importação consulta pra não
-- reaplicar. Não é apagado quando o status volta manualmente: a partir da
-- primeira remoção a empresa está fora do automático para sempre.
--
--   training_origin      como o status atual começou: 'planilha' | 'manual' |
--                        'integracao' (NULL quando não está em treinamento, ou
--                        quando já estava marcada antes desta migration)
--   training_started_at  quando o status atual começou
--   training_removed_at  última remoção (NULL = nunca foi removido)
--
-- Aditiva: 3 colunas anuláveis, uma função e um gatilho. Idempotente.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS training_origin TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS training_started_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS training_removed_at TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION public.companies_training_track() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_in_training THEN
      NEW.training_started_at := COALESCE(NEW.training_started_at, now());
      NEW.training_origin := COALESCE(NEW.training_origin, 'manual');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_in_training IS DISTINCT FROM OLD.is_in_training THEN
    IF NEW.is_in_training THEN
      NEW.training_started_at := now();
      -- quem liga informa a origem no mesmo UPDATE; sem informar, é manual
      IF NEW.training_origin IS NOT DISTINCT FROM OLD.training_origin THEN
        NEW.training_origin := 'manual';
      END IF;
    ELSE
      NEW.training_removed_at := now();
      NEW.training_origin := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_training_track ON public.companies;
CREATE TRIGGER trg_companies_training_track
  BEFORE INSERT OR UPDATE OF is_in_training ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.companies_training_track();

-- Quem já podia mexer no status (o toggle era de customers:write) continua
-- podendo: a permissão nova customers:training é concedida aos perfis que têm
-- customers:write. Administrador recebe todas as permissões automaticamente.
UPDATE public.role_permissions
SET permissions = array_append(permissions, 'customers:training')
WHERE 'customers:write' = ANY(permissions)
  AND NOT ('customers:training' = ANY(permissions));
