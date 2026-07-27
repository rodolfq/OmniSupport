"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A lista de Tickets Internos foi unificada com a de Chamados em /tickets
// (chave "Tickets Internos" no topo) — esta rota só existe pra não quebrar
// links/favoritos antigos. A tela de detalhe de um ticket interno continua
// em /internal-tickets/[id], intocada.
export default function InternalTicketsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/tickets?mode=internal");
  }, [router]);
  return null;
}
