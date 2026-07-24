-- Item 7 do roadmap de melhorias: histórico da conversa sob demanda no chat
-- em andamento. Contatos identificados só por telefone (sem customer_id
-- vinculado) ficariam com busca em chat_histories mais lenta sem este índice
-- (já existe idx_chat_histories_customer_id, faltava o de telefone).

CREATE INDEX IF NOT EXISTS idx_chat_histories_customer_phone ON public.chat_histories(customer_phone);
