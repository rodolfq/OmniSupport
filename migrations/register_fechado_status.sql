-- Registra o status "Fechado" em config_statuses (escopo de chamado).
--
-- Ele já era tratado como fechado em todo lugar que importa — está em
-- CLOSED_TICKET_STATUSES (lib/ticket-status.ts) e é TicketStatus.CLOSED em
-- lib/types.ts, então SLA, dashboard e relatórios sempre contaram certo.
--
-- O que faltava era o CADASTRO: 22 chamados em produção têm status "Fechado" e
-- esse rótulo não existia na lista configurável. Consequência prática: ao abrir
-- um desses chamados, o seletor de status não tinha a opção correspondente ao
-- valor salvo — ficava sem seleção visível, e salvar qualquer outro campo podia
-- trocar o status do chamado sem ninguém pedir.
--
-- Não é o caso de migrar os 22 para "Concluído": app/actions.ts continua
-- gravando 'Fechado' ao encerrar a conversa que originou o chamado, então
-- novos registros com esse rótulo apareceriam logo em seguida. Registrar o
-- rótulo é o que alinha cadastro e dado.
--
-- sort_order 10 deixa junto dos outros finalizadores (Mesclado 8, Concluído 9).
-- Idempotente: só insere se ainda não existir para o escopo 'ticket'.

INSERT INTO public.config_statuses (label, color, scope, is_closed, sort_order)
SELECT 'Fechado', 'bg-slate-100 text-slate-700', 'ticket', TRUE, 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.config_statuses WHERE label = 'Fechado' AND scope = 'ticket'
);
