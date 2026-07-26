'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Rota aposentada — a versão completa (multi-instância, QR Code + Meta API)
// mora em Configurações. Mantido como redirect, não removido, pra não
// quebrar link/atalho salvo por alguém de antes da mudança.
export default function WhatsAppPageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings?tab=whatsapp');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-page)]">
      <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
