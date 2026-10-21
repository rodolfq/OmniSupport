-- Vincular hotfix solto (fluxo achatado legado, tabela `hotfixes`) a um
-- Ciclo de Publicação (2026-10-21, pedido do usuário). Ao vincular, cria um
-- release_item "espelho" (snapshot de nome/descrição/responsável — não fica
-- sincronizado com o hotfix depois) com o tipo (hotfix/emergencial/prevista)
-- escolhido na hora, e marca o hotfix de origem com o ciclo+item resultante.
--
-- ⚠️ MORATÓRIA DE BANCO (ver CLAUDE.md) — escrito e espelhado em
-- schema_postgres.sql, mas NÃO aplicado contra o DATABASE_URL atual.
-- Aplicar só com autorização explícita do usuário. Tudo aditivo: 3 colunas
-- nullable, nenhum DROP/RENAME/reescrita de dado existente.

ALTER TABLE public.hotfixes
  ADD COLUMN IF NOT EXISTS release_cycle_id UUID REFERENCES public.release_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS release_item_id UUID REFERENCES public.release_items(id) ON DELETE SET NULL;

ALTER TABLE public.release_items
  ADD COLUMN IF NOT EXISTS source_hotfix_id UUID REFERENCES public.hotfixes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hotfixes_release_cycle_id ON public.hotfixes(release_cycle_id);
CREATE INDEX IF NOT EXISTS idx_release_items_source_hotfix_id ON public.release_items(source_hotfix_id);
