-- Roadmap "Time x Gerencial", Etapa 8 (R5 "Conta/Cliente"): limiares do
-- sinal de risco por conta (queda de satisfação + recorrência alta). Mesma
-- tabela de linha única de config_metric_thresholds.sql — nova migration em
-- vez de editar a existente, como o projeto exige.
-- Default: sinaliza risco quando a satisfação cai mais de 15 pontos
-- percentuais em relação ao período anterior de mesmo tamanho E a
-- recorrência de contato em 72h está acima de 20% no período atual.
-- Ajustável por SQL manual até existir tela de edição (mesmo estado dos
-- demais limiares hoje).

ALTER TABLE public.config_metric_thresholds
  ADD COLUMN IF NOT EXISTS risk_satisfaction_drop_points NUMERIC NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS risk_recurrence_rate_warning NUMERIC NOT NULL DEFAULT 20;
