-- Hierarquia de tags (tag principal → subtags) — pedido do usuário,
-- 2026-10-21. Reformulação das 20 tags de chat hoje achatadas num só nível
-- (ver CLAUDE.md seção 15 pra análise e proposta completa). Autorrelação
-- nullable: tag sem parent_tag_id é "principal"; com parent_tag_id aponta
-- pra uma tag principal (a tela só oferece tags SEM pai como opção de
-- principal, pra não permitir aninhar além de 2 níveis).
--
-- ON DELETE SET NULL: apagar uma tag principal não some com as subtags —
-- elas só voltam a ser principais (viram órfãs top-level), nunca é apagado
-- em cascata (evitaria perder a tag de conversas/chamados que já usam a
-- subtag).
--
-- ⚠️ MORATÓRIA DE BANCO (ver CLAUDE.md) — escrito e espelhado em
-- schema_postgres.sql, mas NÃO aplicado contra o DATABASE_URL atual.
-- Aplicar só com autorização explícita do usuário.

ALTER TABLE public.config_tags
  ADD COLUMN IF NOT EXISTS parent_tag_id UUID REFERENCES public.config_tags(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_config_tags_parent_tag_id ON public.config_tags(parent_tag_id) WHERE parent_tag_id IS NOT NULL;
