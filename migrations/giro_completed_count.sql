-- Fila justa por número de tarefas concluídas no dia.
--
-- Regra confirmada com o usuário: quem concluiu MENOS atendimentos hoje vai
-- na frente. Concluir 1 vez manda pra trás do grupo de "quem já concluiu 1 ou
-- menos" (comportamento de sempre — mover pro fim). Concluir 2 vezes seguidas
-- (sem que mais ninguém tenha atendido nesse meio tempo) exige que TODOS os
-- outros concluam 2 também antes de voltar a ser a vez dessa pessoa — não é
-- "pular a vez uma vez", é entrar na fila do grupo de 2 conclusões.
--
-- completed_count: quantas vezes esta linha já foi concluída hoje. Reseta
-- sozinho porque giro_day_rows é recriada do zero em cada dia (e reprocessar
-- preserva o valor de quem continua, ver reprocessDay).
--
-- giro_history.position_before: posição que a linha tinha ANTES desta
-- conclusão específica — permite que excluir o registro devolva a pessoa pro
-- lugar exato de onde saiu (não só "se está no fim, manda pra 1º", que era a
-- regra antiga e não desfazia de verdade). Nulo em registros anteriores a esta
-- migration — o código cai de volta na regra antiga só para esses casos.
ALTER TABLE public.giro_day_rows ADD COLUMN IF NOT EXISTS completed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.giro_history ADD COLUMN IF NOT EXISTS position_before INTEGER;
