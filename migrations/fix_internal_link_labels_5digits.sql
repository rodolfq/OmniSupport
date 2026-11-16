-- Corrige fix_internal_link_labels.sql (2026-11-13): ela usou
-- lpad(numero, 4, '0'), que no Postgres CORTA número com mais de 4 dígitos
-- (int-11140 virou int-1114). Aqui o rótulo é refeito a partir do id que ficou
-- no backup, com no mínimo 4 dígitos e sem cortar nada (mesmo formato de
-- formatId em app/api/internal-tickets/route.ts).
--
-- Só toca as linhas que aquela migration alterou (as do backup). Idempotente.

UPDATE public.ticket_messages m
   SET content = 'Vinculou ao ticket interno int-' || lpad(it.internal_ticket_number::text, GREATEST(4, length(it.internal_ticket_number::text)), '0')
  FROM public.bkp_internal_link_labels_20261113 b
  JOIN public.internal_tickets it ON it.id = substring(b.content from 'ticket interno ([0-9a-f]{32})$')
 WHERE m.id = b.id
   AND it.internal_ticket_number IS NOT NULL
   AND m.content IS DISTINCT FROM 'Vinculou ao ticket interno int-' || lpad(it.internal_ticket_number::text, GREATEST(4, length(it.internal_ticket_number::text)), '0');
