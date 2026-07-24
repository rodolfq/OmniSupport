-- Complemento ao item 17 do roadmap: marcador "Hotfix" no ticket interno,
-- referência informativa a um hotfix cadastrado (não afeta o scheduler de alerta).
ALTER TABLE public.internal_tickets
  ADD COLUMN IF NOT EXISTS hotfix_id UUID REFERENCES public.hotfixes(id) ON DELETE SET NULL;
