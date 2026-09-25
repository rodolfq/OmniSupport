-- Templates automáticos do Pyvon (chamado aberto, nota no chamado, mensagens
-- automáticas fora da janela de 24h) enviados a um contato que NÃO tem conversa
-- aberta ficam guardados aqui, em vez de abrir uma conversa na hora.
--
-- Motivo (2026-09-25): o envio do template criava uma conversa 'active' já
-- atribuída pelo rodízio, mesmo sem o cliente ter respondido — o analista
-- sorteado via um chat só com a mensagem automática e o fechava (a nota
-- pendente ficava perdida) ou o repassava. A regra do usuário é: só existe
-- conversa quando o cliente RESPONDE, e ela vai pro autor da nota.
--
-- Quando o cliente responde (PyvonService.handleWebhook), as linhas do contato
-- são consumidas: os templates entram na conversa nova como histórico (com a
-- hora em que foram enviados), a nota/autor viram os pendentes da conversa e a
-- linha é apagada. Linhas com mais de 48h são ignoradas e limpas.
--
-- Aditiva: só cria uma tabela nova; nada do que existe é alterado.

CREATE TABLE IF NOT EXISTS public.pyvon_pending_outbound (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  cadastro_id INTEGER NOT NULL,
  phone TEXT,
  customer_name TEXT,
  instance_id TEXT NOT NULL,
  template_text TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT 'SSX Desk (automático)',
  note_text TEXT,
  note_author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pyvon_pending_outbound_cadastro ON public.pyvon_pending_outbound (cadastro_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pyvon_pending_outbound_phone ON public.pyvon_pending_outbound (phone);
