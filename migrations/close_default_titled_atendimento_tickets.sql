-- Pedido do usuário (2026-10-01): chamados com o título PADRÃO que o botão
-- "Gerar Chamado" do chat sugere (components/chat-widget.tsx /
-- app/(portal)/chat-management/page.tsx: `Atendimento DD/MM/AAAA HH:mm: Nome`)
-- e que ninguém trocou — na prática, atendimento que já foi resolvido pelo
-- chat e o chamado ficou esquecido no status antigo. Move pra "Concluído".
--
-- Exclui 'Mesclado' de propósito: é status dedicado pro chamado ABSORVIDO
-- numa mesclagem (ver CLAUDE.md, "Mesclar chamado não reaproveita o status
-- Concluído") — tratar como "Concluído" misturaria as duas coisas em
-- relatório/kanban, que já tratam como categorias diferentes.
--
-- Idempotente: WHERE já filtra quem bate o padrão E ainda não está
-- 'Concluído' nem 'Mesclado' — rodar de novo não afeta nada.
UPDATE public.tickets
SET status = 'Concluído', updated_at = NOW()
WHERE title ~ '^Atendimento [0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}: .+$'
  AND status NOT IN ('Concluído', 'Mesclado');
