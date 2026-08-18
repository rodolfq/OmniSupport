'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /permissions foi migrada pra dentro de Configurações (aba "Equipes &
 * Permissões") — ver components/permissions-content.tsx e
 * app/(portal)/settings/page.tsx. Este stub só existe pra não quebrar
 * links/favoritos antigos.
 */
export default function PermissionsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=permissions');
  }, [router]);
  return null;
}
