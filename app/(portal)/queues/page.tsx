'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /queues foi migrada pra dentro de Configurações (aba "Filas") — ver
 * components/queues-content.tsx e app/(portal)/settings/page.tsx. Este stub
 * só existe pra não quebrar links/favoritos antigos.
 */
export default function QueuesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=queues');
  }, [router]);
  return null;
}
