-- Guarda quem escreveu a nota que está esperando o "Prosseguir" do cliente
-- (ver chat_sessions_pyvon_pending_note.sql) — sem isso, quando a nota
-- finalmente sai como mensagem de verdade (sendAutomaticNoteReply em
-- pyvon-service.ts), não havia como identificar o analista pro cliente
-- (nome em negrito antes da mensagem, ver lib/services/automation-service.ts)
-- nem atribuir a mensagem ao autor certo no nosso próprio chat.
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS pyvon_pending_note_author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
