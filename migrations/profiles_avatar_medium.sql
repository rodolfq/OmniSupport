-- Miniatura média da foto do analista (192px), para o Desempenho por Analista (ranking e pódio).
--
-- A avatar_thumb_url tem 48px de propósito, para as listas de chamados e tickets com muitas
-- linhas. Em tela 2x, o avatar de 96px do pódio ficava borrado com ela. Esta coluna nova
-- guarda uma versão maior, sem aumentar o peso das listas que já usam a thumb.
--
-- Aditiva e idempotente. Para reverter: ALTER TABLE public.profiles DROP COLUMN avatar_medium_url;
-- (o ranking volta a usar a avatar_thumb_url, porque a consulta faz COALESCE).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_medium_url TEXT;
