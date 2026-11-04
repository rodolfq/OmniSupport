-- "Ciente" na mensagem do cliente (pedido do usuário, 2026-11-04): marcado só
-- pela equipe, numa mensagem do cliente/funcionário, tira o chamado do card
-- "Chamados sem Resposta" do Dashboard sem precisar responder de fato — serve
-- pro caso do cliente só agradecer e o chamado ficar preso lá. Aditiva,
-- idempotente.
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES public.profiles(id);
