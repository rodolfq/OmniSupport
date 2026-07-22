-- Origem da avaliação (pesquisa automática ao fechar chat vs. edição manual
-- no cadastro da empresa) e contato opcional de quem gerou o atendimento —
-- ambos só pra contexto/relatório, não afetam a média por empresa.
ALTER TABLE public.customer_evaluations
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('chat_close', 'manual')),
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_evaluations_contact_id ON public.customer_evaluations(contact_id);
