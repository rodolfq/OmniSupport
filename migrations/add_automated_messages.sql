-- Módulo Mensagens Automáticas: notificações via WhatsApp para o cliente
-- durante o ciclo de vida do chamado.

-- Novos status necessários para os eventos "Solicitação de informações" e
-- "Aguardando aprovação" (hoje não existe admin UI para status; ficam
-- disponíveis nos botões de status do chamado assim que existirem).
INSERT INTO public.config_statuses (label, color) VALUES
  ('Aguardando Cliente', 'bg-amber-100 text-amber-700'),
  ('Aguardando Aprovação', 'bg-purple-100 text-purple-700')
ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.automation_settings (
  event_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  first_occurrence_only BOOLEAN NOT NULL DEFAULT false,
  trigger_status TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Fila de envio atrasado (status='pending') e histórico de auditoria
-- (status='sent'|'failed'|'skipped') na mesma tabela.
CREATE TABLE IF NOT EXISTS public.automation_dispatches (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  event_key TEXT NOT NULL,
  ticket_id TEXT REFERENCES public.tickets(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_name TEXT,
  recipient_phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  send_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_dispatches_pending ON public.automation_dispatches(status, send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_dispatches_ticket_event ON public.automation_dispatches(ticket_id, event_key, status);

-- Seed dos 11 eventos com os textos padrão. event_key/message/etc. também
-- funcionam como fallback: novos eventos futuros são adicionados só no
-- catálogo TypeScript (lib/automation-events.ts) e a linha aqui é
-- auto-criada na primeira leitura (INSERT ... ON CONFLICT DO NOTHING),
-- sem precisar de nova migration.
INSERT INTO public.automation_settings (event_key, message, trigger_status) VALUES
('novo_chamado', '📢 Confirmação de abertura de chamado

✅ Seu chamado nº {{numero_chamado}} foi registrado com sucesso.

📌 Assunto:
{{titulo}}

🧑‍💻 Nossa equipe irá analisar sua solicitação e iniciar o atendimento o mais breve possível.

Você receberá novas atualizações automaticamente.

➡️ SystemSat', NULL),

('chamado_classificado', '📢 Confirmação de classificação

✅ Seu chamado nº {{numero_chamado}} foi classificado.

📂 Categoria:
{{categoria}}

🔁 Em breve um analista iniciará o atendimento.

➡️ SystemSat', NULL),

('analista_atribuido', '👨‍💻 Atendimento iniciado

Seu chamado nº {{numero_chamado}} agora está sob responsabilidade de:

👤 {{analista}}

Nossa equipe seguirá acompanhando sua solicitação até a resolução.

➡️ SystemSat', NULL),

('mudanca_prioridade', '📌 Atualização de prioridade

Seu chamado nº {{numero_chamado}} teve sua prioridade alterada.

Nova prioridade:

{{prioridade}}

Caso tenha dúvidas, basta responder esta conversa.

➡️ SystemSat', NULL),

('mudanca_status', '📢 Atualização do chamado

Seu chamado nº {{numero_chamado}} recebeu uma atualização.

Novo status:

{{status}}

Você continuará recebendo notificações sempre que houver novidades.

➡️ SystemSat', NULL),

('solicitacao_informacoes', '📋 Precisamos da sua ajuda

Seu chamado nº {{numero_chamado}} está aguardando um retorno seu.

Assim que recebermos as informações solicitadas, o atendimento continuará normalmente.

➡️ SystemSat', 'Aguardando Cliente'),

('aguardando_aprovacao', '⏳ Aguardando aprovação

Seu chamado nº {{numero_chamado}} está aguardando sua confirmação para continuidade.

Após sua resposta o atendimento será retomado.

➡️ SystemSat', 'Aguardando Aprovação'),

('aguardando_nota', '⭐ Como foi seu atendimento?

Seu chamado nº {{numero_chamado}} foi resolvido.

Gostaríamos de conhecer sua experiência.

Sua avaliação é muito importante para melhorarmos continuamente nossos atendimentos.

➡️ SystemSat', 'Resolvido'),

('chamado_finalizado', '✅ Chamado finalizado

Seu chamado nº {{numero_chamado}} foi encerrado com sucesso.

Obrigado por confiar em nossa equipe.

Caso o problema persista ou seja necessário complementar o atendimento, você poderá solicitar a reabertura deste chamado sem necessidade de criar um novo.

Agradecemos sua avaliação.

➡️ SystemSat', 'Fechado'),

('chamado_reaberto', '🔄 Chamado reaberto

Seu chamado nº {{numero_chamado}} foi reaberto.

Nossa equipe retomará o atendimento em breve.

➡️ SystemSat', NULL),

('resposta_analista', '💬 Nova atualização

Há uma nova resposta em seu chamado nº {{numero_chamado}}.

Acesse o sistema ou responda esta conversa para continuar o atendimento.

➡️ SystemSat', NULL)
ON CONFLICT (event_key) DO NOTHING;
