-- Prazo em dias ÚTEIS a partir de um instante, para a regra de 2 dias do ticket interno
-- (Prazo do Desenvolvimento). É a inversa de ticket_business_minutes: andando minuto a
-- minuto pela mesma janela (8h às 18h, segunda a sexta, horário de Brasília), devolve o
-- instante em que se completam p_days × 600 minutos úteis.
--
-- Exemplos (Brasília):
--   sexta 16h, 2 dias  -> terça 16h   (sexta 16-18 = 120 min; segunda 600; terça 08-16 = 480)
--   sábado 12h, 2 dias -> terça 18h   (começa segunda 08h; segunda + terça = 1200 min)
--
-- Aditiva e idempotente. Para reverter: DROP FUNCTION public.ticket_business_deadline(timestamptz, integer);

CREATE OR REPLACE FUNCTION public.ticket_business_deadline(p_from timestamptz, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  restante numeric := COALESCE(p_days, 0) * 600;
  cursor_local timestamp;
  d date;
  janela_ini timestamp;
  janela_fim timestamp;
  inicio timestamp;
  disponivel numeric;
BEGIN
  IF p_from IS NULL THEN
    RETURN NULL;
  END IF;
  IF restante <= 0 THEN
    RETURN p_from;
  END IF;

  cursor_local := p_from AT TIME ZONE 'America/Sao_Paulo';
  LOOP
    d := cursor_local::date;
    IF EXTRACT(ISODOW FROM d) > 5 THEN
      cursor_local := (d + 1) + time '08:00';
      CONTINUE;
    END IF;

    janela_ini := d + time '08:00';
    janela_fim := d + time '18:00';
    inicio := GREATEST(cursor_local, janela_ini);
    IF inicio < janela_fim THEN
      disponivel := EXTRACT(EPOCH FROM (janela_fim - inicio)) / 60;
      IF restante <= disponivel THEN
        RETURN (inicio + restante::double precision * interval '1 minute') AT TIME ZONE 'America/Sao_Paulo';
      END IF;
      restante := restante - disponivel;
    END IF;

    cursor_local := (d + 1) + time '08:00';
  END LOOP;
END;
$$;
