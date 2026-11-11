"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Link direto pro ticket interno (/internal-tickets/40, int-0040 ou o uuid) —
// usado por e-mails, notificações, "Copiar link" e links antigos. Desde
// 2026-11-11 o detalhe é um MODAL sobre a tela atual
// (components/internal-ticket-modal-host.tsx); esta rota só leva para a lista
// de Tickets Internos com o modal aberto, pra ninguém cair num fundo vazio.
export default function InternalTicketLinkRedirect() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    const ref = String(params.id || "");
    router.replace(ref ? `/tickets?mode=internal&internalTicket=${encodeURIComponent(ref)}` : "/tickets?mode=internal");
  }, [params.id, router]);
  return null;
}
