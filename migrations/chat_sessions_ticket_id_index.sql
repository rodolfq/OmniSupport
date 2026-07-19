-- Indice pro lookup reverso ticket -> sessao de chat vinculada (usado pela aba
-- "Conversa" do chamado, que busca a sessao por ticket_id em vez de duplicar
-- o historico do chat na descricao do chamado).
CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_id ON public.chat_sessions(ticket_id);
