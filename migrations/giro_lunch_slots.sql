-- Horários de almoço do Giro, configuráveis em Configuração > Horários de
-- almoço (antes eram fixos em código: GIRO_LUNCH_CAPACITY, lib/types.ts).
--
-- Cada LINHA é UMA vaga, não um horário com um número de capacidade — a
-- vagas de um horário é simplesmente quantas linhas existem com aquele
-- slot_time. Repetir a inserção de '12:00' três vezes cria 3 vagas às
-- 12:00; apagar uma linha tira 1 vaga daquele horário. Isso permite ao
-- administrador cadastrar tantas vagas quanto quiser por horário sem
-- precisar de uma coluna de capacidade separada, e faz "adicionar/remover
-- horário" ser sempre a mesma operação simples de inserir/apagar uma linha.
CREATE TABLE IF NOT EXISTS public.giro_lunch_slots (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  slot_time TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giro_lunch_slots_time ON public.giro_lunch_slots(slot_time);

-- Semeia com a configuração fixa que existia até aqui (1 vaga às 11h/14h, 4
-- vagas às 12h/13h), só se a tabela ainda estiver vazia — não sobrescreve
-- quem já rodou esta migration e mexeu na configuração depois.
INSERT INTO public.giro_lunch_slots (slot_time)
SELECT slot_time FROM (VALUES
  ('11:00'),
  ('12:00'), ('12:00'), ('12:00'), ('12:00'),
  ('13:00'), ('13:00'), ('13:00'), ('13:00'),
  ('14:00')
) AS seed(slot_time)
WHERE NOT EXISTS (SELECT 1 FROM public.giro_lunch_slots);
