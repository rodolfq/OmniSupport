'use client';

import { useEffect } from 'react';
import { initPwaInstallCapture } from '@/lib/pwa-install';

// Registra o service worker e começa a capturar o prompt de instalação do
// PWA — montado uma vez em app/layout.tsx. Não renderiza nada.
export function PwaRegister() {
  useEffect(() => {
    initPwaInstallCapture();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.error('Falha ao registrar o service worker:', err);
      });
    }
  }, []);

  return null;
}
