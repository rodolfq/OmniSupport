-- Roadmap "Time x Gerencial", Etapa 6 (R3 "Carga e Capacidade"): limite de
-- carga simultânea por analista online que marca uma faixa horária como
-- crítica. Mesma tabela de linha única de config_metric_thresholds.sql —
-- nova migration em vez de editar a existente, como o projeto exige.
-- Default: bom até 2 chats simultâneos por analista online, alerta até 4,
-- crítico acima disso — ponto de partida, ajustável por SQL manual até
-- existir tela de edição (mesmo estado dos demais limiares hoje).

ALTER TABLE public.config_metric_thresholds
  ADD COLUMN IF NOT EXISTS capacity_ratio_good NUMERIC NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS capacity_ratio_warning NUMERIC NOT NULL DEFAULT 4;
