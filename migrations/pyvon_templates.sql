-- Templates de WhatsApp (HSM) aprovados na Meta, usados pelo Pyvon pra
-- iniciar conversa fora da janela de 24h (POST /api/webhook/bot-template) —
-- ver lib/services/pyvon-service.ts. Cadastro manual: o Pyvon não expõe um
-- jeito de listar templates aprovados por API, só o nome já combinado com
-- quem administra a WABA.
CREATE TABLE IF NOT EXISTS public.pyvon_templates (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'pt_BR',
  description TEXT,
  -- Array de { key, label }: key é o nome da variável tal como o template
  -- espera (numérica "1"/"2" ou nomeada "nome_unidade"), label é o rótulo
  -- amigável mostrado no formulário de preenchimento.
  variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
