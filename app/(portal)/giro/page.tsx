'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /giro foi migrada pra dentro de Configurações (aba "Giro de Atendimento")
 * — ver components/giro-content.tsx (que reaproveita giro-day-view.tsx e
 * giro-config-view.tsx deste mesmo diretório) e
 * app/(portal)/settings/page.tsx. Este stub só existe pra não quebrar
 * links/favoritos antigos.
 */
export default function GiroRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=giro');
  }, [router]);
  return null;
}
