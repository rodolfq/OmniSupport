'use client';

import React, { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { InternalTicketDetailModal } from '@/components/internal-ticket-detail-modal';

// Parâmetro de URL que abre o ticket interno como modal sobre QUALQUER tela
// do portal (2026-11-11). Valor: o que a action=detail aceita — uuid, número
// puro (40) ou formatado (int-0040).
export const INTERNAL_TICKET_PARAM = 'internalTicket';

// Monta a URL da tela atual com o ticket aberto — mantém os outros
// parâmetros (mode=internal, filtros do dashboard...), pra fechar devolver a
// pessoa exatamente para onde estava.
function withParam(pathname: string, current: URLSearchParams, ref: string | null) {
  const next = new URLSearchParams(current.toString());
  if (ref) next.set(INTERNAL_TICKET_PARAM, ref);
  else next.delete(INTERNAL_TICKET_PARAM);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Abre um ticket interno por cima da tela atual. Usa push (não replace) de
 * propósito: o "voltar" do navegador fecha o modal, como se espera.
 */
export function useOpenInternalTicket() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useCallback((ref: string) => {
    if (!ref) return;
    router.push(withParam(pathname, searchParams ?? new URLSearchParams(), ref), { scroll: false });
  }, [router, pathname, searchParams]);
}

/**
 * Montado uma vez no layout do portal. Lê ?internalTicket= e mostra o modal;
 * a tela de baixo continua renderizada (era o problema da página antiga
 * /internal-tickets/[id]: o fundo ficava vazio).
 */
export function InternalTicketModalHost() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ref = searchParams?.get(INTERNAL_TICKET_PARAM) || null;

  const handleClose = useCallback(() => {
    router.replace(withParam(pathname, searchParams ?? new URLSearchParams(), null), { scroll: false });
  }, [router, pathname, searchParams]);

  if (!ref) return null;
  // key: trocar de um ticket pro outro (ex.: link dentro do próprio modal)
  // remonta do zero, sem carregar estado de formulário do anterior.
  return <InternalTicketDetailModal key={ref} ticketRef={ref} onClose={handleClose} />;
}
