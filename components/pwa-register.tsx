'use client';

import { useEffect } from 'react';
import { initPwaInstallCapture } from '@/lib/pwa-install';
import { subscribeToPush } from '@/hooks/use-push-subscription';

// Registra o service worker e começa a capturar o prompt de instalação do
// PWA — montado uma vez em app/layout.tsx. Não renderiza nada.
export function PwaRegister() {
  useEffect(() => {
    initPwaInstallCapture();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(() => {
          // Se a permissão já foi concedida antes (ex.: em outra sessão, ou
          // se o navegador já tinha a permissão de quando essa funcionalidade
          // ainda não existia), garante que existe uma assinatura push salva
          // — sem isso, "notificações habilitadas" no navegador não significa
          // nada se o servidor nunca recebeu o endpoint para enviar push.
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            subscribeToPush().catch(err => console.error('Falha ao (re)assinar push:', err));
          }
        })
        .catch(err => {
          console.error('Falha ao registrar o service worker:', err);
        });
    }
  }, []);

  return null;
}
