-- Roadmap "Time x Gerencial", Etapa 3: limites verde/âmbar/vermelho dos
-- KPIs do Dashboard Gerencial (e dos alertas equivalentes — mesma fonte,
-- por decisão do usuário: alerta de espera/pico dispara exatamente quando o
-- card correspondente já está na faixa vermelha). Linha única, mesmo padrão
-- de config_survey_settings. Só leitura nesta etapa — sem tela de edição
-- ainda; ajustar valor é SQL manual até uma etapa futura construir a UI em
-- Configurações.

CREATE TABLE IF NOT EXISTS public.config_metric_thresholds (
  id INTEGER PRIMARY KEY DEFAULT 1,
  -- 1ª resposta (mediana, segundos) — menor é melhor.
  first_response_good_seconds INTEGER NOT NULL DEFAULT 120,
  first_response_warning_seconds INTEGER NOT NULL DEFAULT 300,
  -- % respondido em até 2 min — maior é melhor.
  pct_2min_good_percentage NUMERIC NOT NULL DEFAULT 80,
  pct_2min_warning_percentage NUMERIC NOT NULL DEFAULT 60,
  -- Duração do chat (mediana, minutos) — menor é melhor.
  duration_good_minutes NUMERIC NOT NULL DEFAULT 10,
  duration_warning_minutes NUMERIC NOT NULL DEFAULT 20,
  -- % satisfação (positivos / avaliados) — maior é melhor.
  satisfaction_good_percentage NUMERIC NOT NULL DEFAULT 85,
  satisfaction_warning_percentage NUMERIC NOT NULL DEFAULT 70,
  -- Pico individual simultâneo (chats ao mesmo tempo, 1 analista) — menor é melhor.
  individual_peak_good INTEGER NOT NULL DEFAULT 3,
  individual_peak_warning INTEGER NOT NULL DEFAULT 5,
  -- Chats em espera agora — menor é melhor.
  waiting_now_good INTEGER NOT NULL DEFAULT 2,
  waiting_now_warning INTEGER NOT NULL DEFAULT 5,
  -- Volume mínimo esperado no período — abaixo disso pode ser sinal de
  -- problema (instância caída, fila zerada), não necessariamente "bom".
  volume_min_expected INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT config_metric_thresholds_single_row CHECK (id = 1)
);

INSERT INTO public.config_metric_thresholds (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
