-- Desativação de empresa, no lugar de exclusão.
--
-- Motivo: excluir uma empresa não apagava as pessoas dela — profiles.company_id
-- é ON DELETE SET NULL, então cada uma ficava SEM empresa. E como a tela
-- Empresas mostra pessoas dentro do card de uma empresa, quem ficava sem
-- empresa sumia da interface, sem erro nenhum, mantendo no banco todo o
-- histórico de chamados e conversas. Foi o que aconteceu com a empresa de
-- exemplo do schema: o contato "José Cliente" virou invisível, com 14 chamados
-- e 17 conversas atrelados, e ainda ocupando o e-mail no índice único.
--
-- Desativar preserva o registro e o vínculo das pessoas: a empresa continua
-- existindo, some das listagens do dia a dia e aparece marcada como inativa
-- quando alguém a procura de propósito.
--
-- Mesmo nome e mesmo formato de profiles.is_active, que já existe e resolve o
-- mesmo problema para pessoas — duas colunas com o mesmo papel devem ter o
-- mesmo nome.
--
-- Fase aditiva: coluna nova com default true, nenhuma empresa existente muda
-- de comportamento.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- A listagem padrão filtra por ativa; índice parcial cobre esse caminho quente.
CREATE INDEX IF NOT EXISTS idx_companies_active ON public.companies (name) WHERE is_active;
