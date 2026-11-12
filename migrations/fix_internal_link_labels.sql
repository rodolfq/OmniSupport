-- Anotação "Vinculou ao ticket interno <id>" no chamado passa a mostrar o
-- rótulo do ticket interno (int-0001), não o id do banco (2026-11-12, achado
-- do usuário). O código já grava o rótulo certo desde então
-- (components/ticket-detail-modal.tsx, handleLinkInternalTicket); isto corrige
-- as anotações antigas.
--
-- Só toca anotação cujo id ainda existe em internal_tickets; formato do rótulo
-- igual ao de formatId (app/api/internal-tickets/route.ts): int- + número com
-- pelo menos 4 dígitos. Idempotente: depois de rodar, nenhuma linha casa mais
-- com o padrão de 32 caracteres hexadecimais.

UPDATE public.ticket_messages m
   SET content = 'Vinculou ao ticket interno int-' || lpad(it.internal_ticket_number::text, 4, '0')
  FROM public.internal_tickets it
 WHERE m.content ~ '^Vinculou ao ticket interno [0-9a-f]{32}$'
   AND it.id = substring(m.content from 'ticket interno ([0-9a-f]{32})$')
   AND it.internal_ticket_number IS NOT NULL;
