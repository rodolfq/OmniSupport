-- Template Pyvon usado como fallback quando a automação resolve o canal
-- Pyvon e a janela de 24h está fechada (bot-response não entrega texto livre
-- fora dela) — ver lib/services/automation-service.ts e pyvon-service.ts.
ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS pyvon_template_id UUID REFERENCES public.pyvon_templates(id) ON DELETE SET NULL;
