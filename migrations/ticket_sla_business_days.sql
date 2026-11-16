-- SLA de chamado em DIAS ÚTEIS inteiros, não mais em horas úteis corridas
-- (pedido do usuário, 2026-11-16 — chamado #7054: SLA "15 dias" = 360h
-- úteis virava vencimento em 04/01/2027 em vez de ~04/12/2026, porque a
-- conta somava horas dentro do expediente de 8h-18h em vez de dias inteiros).
--
-- Regra nova (mesma de lib/sla.ts::addBusinessDays, espelhada aqui em SQL
-- pra não divergir do card "SLA Vencido" do Dashboard/filtros rápidos —
-- ver app/api/search/route.ts):
--   - o dia da ABERTURA nunca conta (a contagem começa no dia seguinte);
--   - a hora da abertura não importa — não há fração de dia;
--   - cada dia útil (seg-sex, sem feriado cadastrado) que vier depois
--     consome 1 dia do prazo;
--   - o vencimento cai no início do expediente (8h) do dia útil que fecha
--     a contagem.
--
-- "Urgente" fica de FORA desta regra (decisão do usuário): viraria quase o
-- dobro do prazo real (ex.: aberto sexta à tarde só venceria na segunda).
-- Continua em horas úteis (8h-18h, seg-sex) — mesmo rótulo hardcoded
-- espelhado em lib/sla.ts (HOURLY_SLA_PRIORITY_LABEL). Mudar o rótulo aqui
-- sem mudar lá (ou vice-versa) quebra a consistência entre a tela do
-- chamado e esta função.
--
-- Fuso: America/Sao_Paulo, mesma convenção de lib/report-period.ts e do
-- Giro de Atendimento — "dia" e "8h"/"18h" são sempre hora de Brasília, não
-- UTC (o container roda em UTC).
--
-- Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.ticket_sla_deadline_business_hours(
  p_created_at timestamptz,
  p_sla_hours integer
) RETURNS timestamptz AS $$
DECLARE
  v_local timestamp;
  v_remaining_minutes numeric;
  v_end_of_day timestamp;
  v_available_minutes numeric;
BEGIN
  v_local := p_created_at AT TIME ZONE 'America/Sao_Paulo';

  -- snapToBusinessStart (lib/sla.ts): fora do expediente (antes das 8h,
  -- depois das 18h ou fim de semana) empurra pro próximo início de
  -- expediente.
  IF EXTRACT(HOUR FROM v_local) >= 18 THEN
    v_local := date_trunc('day', v_local) + interval '1 day' + interval '8 hours';
  ELSIF EXTRACT(HOUR FROM v_local) < 8 THEN
    v_local := date_trunc('day', v_local) + interval '8 hours';
  END IF;
  WHILE EXTRACT(DOW FROM v_local) IN (0, 6) LOOP
    v_local := date_trunc('day', v_local) + interval '1 day' + interval '8 hours';
  END LOOP;

  v_remaining_minutes := p_sla_hours * 60;
  WHILE v_remaining_minutes > 0 LOOP
    v_end_of_day := date_trunc('day', v_local) + interval '18 hours';
    v_available_minutes := EXTRACT(EPOCH FROM (v_end_of_day - v_local)) / 60;

    IF v_remaining_minutes <= v_available_minutes THEN
      v_local := v_local + make_interval(mins => v_remaining_minutes::int);
      v_remaining_minutes := 0;
    ELSE
      v_remaining_minutes := v_remaining_minutes - v_available_minutes;
      v_local := v_end_of_day;
      LOOP
        v_local := date_trunc('day', v_local) + interval '1 day' + interval '8 hours';
        EXIT WHEN EXTRACT(DOW FROM v_local) NOT IN (0, 6);
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_local AT TIME ZONE 'America/Sao_Paulo';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.ticket_sla_deadline_business_days(
  p_created_at timestamptz,
  p_sla_days integer
) RETURNS timestamptz AS $$
DECLARE
  v_cursor date;
  v_remaining integer;
BEGIN
  v_cursor := (p_created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1; -- nunca conta o dia da abertura
  v_remaining := GREATEST(1, p_sla_days);

  LOOP
    IF EXTRACT(DOW FROM v_cursor) NOT IN (0, 6) THEN
      v_remaining := v_remaining - 1;
      EXIT WHEN v_remaining = 0;
    END IF;
    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN (v_cursor::timestamp + interval '8 hours') AT TIME ZONE 'America/Sao_Paulo';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Função pública usada pelo resto do sistema: decide sozinha, pelo RÓTULO da
-- prioridade, se usa horas úteis (Urgente) ou dias úteis (as demais) — mesmo
-- branch de lib/sla.ts::computeTicketSlaLimit.
CREATE OR REPLACE FUNCTION public.ticket_sla_deadline(
  p_created_at timestamptz,
  p_priority_label text,
  p_sla_hours integer
) RETURNS timestamptz AS $$
BEGIN
  IF p_sla_hours IS NULL OR p_sla_hours <= 0 THEN
    RETURN NULL;
  END IF;

  IF p_priority_label = 'Urgente' THEN
    RETURN public.ticket_sla_deadline_business_hours(p_created_at, p_sla_hours);
  END IF;

  RETURN public.ticket_sla_deadline_business_days(p_created_at, GREATEST(1, ROUND(p_sla_hours / 24.0)::int));
END;
$$ LANGUAGE plpgsql IMMUTABLE;
