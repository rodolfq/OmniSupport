-- Minutos ÚTEIS entre dois instantes, para o SLA e o backlog de chamado.
-- Regra igual à de lib/sla.ts (decisão do usuário, 31/08/2026): 8h às 18h, segunda a sexta,
-- horário de Brasília, sem desconto de almoço e sem cadastro de feriados.
-- Feito no servidor: o cálculo antes rodava só no navegador, com a hora local do cliente.
--
-- Aditiva e idempotente. Para reverter: DROP FUNCTION public.ticket_business_minutes(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.ticket_business_minutes(p_from timestamptz, p_to timestamptz)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  d date;
  day_start timestamptz;
  day_end timestamptz;
  total numeric := 0;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RETURN 0;
  END IF;
  FOR d IN
    SELECT gs::date
      FROM generate_series(
        (p_from AT TIME ZONE 'America/Sao_Paulo')::date,
        (p_to AT TIME ZONE 'America/Sao_Paulo')::date,
        interval '1 day'
      ) AS gs
  LOOP
    CONTINUE WHEN EXTRACT(ISODOW FROM d) > 5;
    day_start := (d + time '08:00') AT TIME ZONE 'America/Sao_Paulo';
    day_end := (d + time '18:00') AT TIME ZONE 'America/Sao_Paulo';
    total := total + GREATEST(0, EXTRACT(EPOCH FROM (LEAST(day_end, p_to) - GREATEST(day_start, p_from)))) / 60;
  END LOOP;
  RETURN total;
END;
$$;
