-- Item 12 do roadmap: mesclar e duplicar chamado.
-- Novo status "Mesclado" (mesmo padrão de config_statuses já semeado) e
-- coluna de rastreio de para qual chamado um chamado absorvido foi mesclado.

INSERT INTO public.config_statuses (label, color) VALUES
  ('Mesclado', 'bg-slate-200 text-slate-500')
ON CONFLICT (label) DO NOTHING;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS merged_into_id TEXT REFERENCES public.tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_merged_into_id ON public.tickets(merged_into_id);
