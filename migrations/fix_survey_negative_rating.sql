-- Corrige avaliações negativas gravadas com a escala errada.
--
-- O cliente responde "0" (ruim) / "1" (bom) à pesquisa de satisfação, e o
-- canal WhatsApp gravava esse "0" cru em chat_histories.rating. Só que a
-- escala de rating no resto do app é -1 (negativo) / 0 (neutro) / 1
-- (positivo) — então toda avaliação ruim virava "neutro" e não aparecia no
-- histórico de conversas, no filtro "Negativa" nem nos relatórios de
-- satisfação. As avaliações boas (1) sempre funcionaram, o que mascarou o bug.
--
-- Nenhuma origem grava "neutro" hoje (a pesquisa só tem duas opções), então
-- todo rating = 0 existente é, com certeza, uma avaliação negativa.

UPDATE public.chat_histories
SET rating = -1
WHERE rating = 0;
