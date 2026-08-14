-- Giro de Atendimento — rodízio diário da equipe de suporte.
--
-- Por que o nome não é "Fila": "Fila" neste sistema já significa outra coisa
-- (public.queues — roteamento de conversas do WhatsApp por instância, com
-- member_ids e routing_strategy). São mecanismos diferentes: a Fila distribui
-- conversa que CHEGA; o Giro é a ordem em que a equipe se reveza para PEGAR o
-- próximo atendimento, reordenada a cada dia. Misturar os dois nomes na UI e
-- no banco confundiria as duas coisas para sempre — daí o prefixo `giro_`.
--
-- Toda tabela é nova; nada aqui altera estrutura existente. A única referência
-- para fora é profiles(id).

-- ------------------------------------------------------- Itens do checklist
-- Lista configurável (mesmo padrão das config_*) em vez de cinco colunas
-- booleanas: a rotina de abertura do dia muda com o tempo (ferramenta nova
-- entra, outra sai) e cada mudança exigiria migration + deploy.
CREATE TABLE IF NOT EXISTS public.giro_checklist_items (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  label TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------ Participantes
-- O "analista" do Giro. Não é uma tabela de pessoas paralela a profiles: é o
-- conjunto de atributos que só existem no contexto do rodízio (posição fixa,
-- fora do rodízio, ausência com prazo). Quem não tem linha aqui simplesmente
-- não participa — é o que atende ao pedido de que nem todos entrem no Giro.
CREATE TABLE IF NOT EXISTS public.giro_participants (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Texto livre ("08:00 às 17:00", "12:00 às 21:00"): é rótulo informativo
  -- exibido e exportado, não entra em nenhum cálculo — por isso não são duas
  -- colunas TIME.
  work_schedule TEXT,
  -- 'free'  = participa do rodízio (o padrão)
  -- 'fixed' = ocupa sempre fixed_position e não roda
  position_type TEXT NOT NULL DEFAULT 'free',
  fixed_position INTEGER,
  -- Fica cadastrado, mas não entra em nenhuma geração automática. Diferente de
  -- excluir o participante: preserva horário de trabalho e posição fixa para
  -- quando voltar.
  out_of_rotation BOOLEAN NOT NULL DEFAULT false,
  -- Ausência COM PRAZO. Enquanto absent_until > agora o analista fica fora das
  -- gerações; vencido o prazo ele volta sozinho, sem ninguém precisar
  -- desmarcar (é o ponto todo de guardar a data em vez de um booleano).
  absent_until TIMESTAMP WITH TIME ZONE,
  absence_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_participants_position_type_check CHECK (position_type IN ('free', 'fixed'))
);
CREATE INDEX IF NOT EXISTS idx_giro_participants_absent ON public.giro_participants(absent_until);

-- --------------------------------------------------------------- Giro do dia
CREATE TABLE IF NOT EXISTS public.giro_days (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  -- UNIQUE garante no banco a regra "no máximo um giro por data": a geração
  -- automática pode ser disparada por duas abas ao mesmo tempo, e sem isso as
  -- duas criariam dias concorrentes.
  giro_date DATE NOT NULL UNIQUE,
  -- Responsável pela passagem de turno.
  --   'auto'   = primeiro da ordem sem posição fixa, recalculado a cada
  --              geração e a cada mudança manual de ordem
  --   'pinned' = alguém escolhido à mão; mudança de ordem não mexe
  --   'none'   = dia deliberadamente sem responsável
  -- Três estados em uma coluna (e não dois booleanos) porque são mutuamente
  -- exclusivos — dois booleanos permitiriam o estado impossível "fixado e
  -- removido ao mesmo tempo".
  handoff_mode TEXT NOT NULL DEFAULT 'auto',
  handoff_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  CONSTRAINT giro_days_handoff_mode_check CHECK (handoff_mode IN ('auto', 'pinned', 'none'))
);

-- -------------------------------------------------------------- Linha do dia
CREATE TABLE IF NOT EXISTS public.giro_day_rows (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  day_id UUID NOT NULL REFERENCES public.giro_days(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'Chamado',
  -- Hora e observação são texto livre do atendimento EM ANDAMENTO; são
  -- esvaziados quando o atendimento é concluído (vão para giro_history).
  service_time TEXT,
  note TEXT,
  -- Já o almoço e o checklist valem o dia inteiro e sobrevivem à conclusão.
  lunch_time TEXT,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Fotografia do horário de trabalho no dia: o cadastro pode mudar depois, e
  -- a exportação de um período passado precisa mostrar o que valia na época.
  work_schedule TEXT,
  -- Ocupou posição fixa NESTE dia. Não dá para reler de giro_participants na
  -- exportação: um fixo pode ter sido rebaixado a livre naquele dia (número
  -- repetido ou maior que a quantidade de gente) e o histórico ficaria mentindo.
  is_fixed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  -- O mesmo analista nunca aparece duas vezes no mesmo dia — garantido aqui, e
  -- não só na tela, porque incluir manualmente e regerar são caminhos
  -- diferentes que poderiam colidir.
  CONSTRAINT giro_day_rows_unique_user UNIQUE (day_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_giro_day_rows_day ON public.giro_day_rows(day_id, position);
CREATE INDEX IF NOT EXISTS idx_giro_day_rows_user ON public.giro_day_rows(user_id);

-- --------------------------------------------------------- Histórico do dia
-- Atendimentos já concluídos. user_name é cópia, não join: relatório de um
-- período antigo precisa continuar legível mesmo se o analista for excluído
-- do sistema (por isso o ON DELETE SET NULL em user_id).
CREATE TABLE IF NOT EXISTS public.giro_history (
  id UUID PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
  day_id UUID NOT NULL REFERENCES public.giro_days(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  service_time TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giro_history_day ON public.giro_history(day_id, created_at);

-- ------------------------------------------------------------------- Seeds
-- Itens do checklist do sistema de origem. ON CONFLICT DO NOTHING mantém a
-- migration idempotente e preserva qualquer edição feita depois na tela.
INSERT INTO public.giro_checklist_items (label, sort_order) VALUES
  ('VPN',      1),
  ('Bitrix',   2),
  ('Odoo',     3),
  ('Telefone', 4),
  ('Almoço',   5)
ON CONFLICT (label) DO NOTHING;
