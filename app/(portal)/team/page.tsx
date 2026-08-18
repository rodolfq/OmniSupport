'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /team foi migrada pra dentro de Configurações (aba "Equipe") — ver
 * components/team-content.tsx e app/(portal)/settings/page.tsx. Este stub
 * só existe pra não quebrar links/favoritos antigos.
 */
export default function TeamRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=team');
  }, [router]);
  return null;
}
