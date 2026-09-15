-- Nota do "Histórico Cliente" enviada via template atualizacao_chamado,
-- aguardando a PRÓXIMA mensagem do cliente pra saber se sai automaticamente
-- (só quando ela for exatamente "prosseguir", sem diferenciar maiúsculas) —
-- ver PyvonService.handleWebhook. NULL = nenhuma nota pendente.
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS pyvon_pending_note_text TEXT;
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS pyvon_pending_note_set_at TIMESTAMP WITH TIME ZONE;
