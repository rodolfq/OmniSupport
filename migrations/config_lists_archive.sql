-- Arquivamento das listas de configuração referenciadas por id.
--
-- Motivo: todas essas colunas são ON DELETE SET NULL. Excluir um item da lista
-- não apagava o chamado, mas esvaziava o campo dele em silêncio — e depois não
-- havia como distinguir "nunca teve tipo de solicitação" de "era do tipo
-- Backup, que alguém excluiu". A informação sumia do histórico e dos
-- relatórios, sem confirmação e sem desfazer.
--
-- Com archived_at o item deixa de ser oferecido em chamados NOVOS, mas
-- continua existindo: o chamado antigo segue apontando pra ele e exibindo o
-- rótulo. Exclusão de verdade fica reservada a item que ninguém usa.
--
-- archived_at (timestamp) em vez de um booleano de propósito: guarda também
-- QUANDO a opção foi aposentada, que é o tipo de coisa que se quer saber ao
-- olhar um relatório antigo. NULL = ativo.
--
-- Fase puramente aditiva: nenhuma coluna é removida ou alterada, o default é
-- NULL, e todo item existente continua ativo. Segura para rodar antes do
-- deploy do código que a usa.

ALTER TABLE public.config_categories    ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_request_types ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_products      ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_effort_levels ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.config_outcomes      ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Índices parciais: a leitura quente é "só os ativos" (seletores de chamado
-- novo). Parcial porque a lista de arquivados é sempre a minoria e não precisa
-- de índice próprio.
CREATE INDEX IF NOT EXISTS idx_config_categories_active    ON public.config_categories (label)    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_config_request_types_active ON public.config_request_types (label) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_config_products_active      ON public.config_products (label)      WHERE archived_at IS NULL;
