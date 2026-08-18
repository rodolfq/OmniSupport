'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /hotfixes foi migrada pra dentro de Configurações (aba "Hotfixes") — ver
 * components/hotfixes-content.tsx e app/(portal)/settings/page.tsx. Este
 * stub só existe pra não quebrar links/favoritos antigos — inclusive a URL
 * fixa gravada no payload de push de lib/services/hotfix-scheduler.ts.
 */
export default function HotfixesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=hotfixes');
  }, [router]);
  return null;
}
