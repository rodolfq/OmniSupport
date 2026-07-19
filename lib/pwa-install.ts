'use client';

import { useEffect, useState } from 'react';

// Estado global simples (fora do React) para o prompt de instalação do PWA:
// só existe um `beforeinstallprompt` por carregamento de página, então não
// há necessidade de um Context — qualquer componente pode assinar via
// usePwaInstall() abaixo, independente de onde/quando é montado.
let deferredPrompt: any = null;
const listeners = new Set<(canInstall: boolean) => void>();

export function initPwaInstallCapture() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event: any) => {
    event.preventDefault();
    deferredPrompt = event;
    listeners.forEach(listener => listener(true));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach(listener => listener(false));
  });
}

function subscribe(listener: (canInstall: boolean) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach(listener => listener(false));
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setCanInstall(!!deferredPrompt);
    setIsIOS(isIosDevice());
    setIsStandalone(isStandaloneDisplay());
    return subscribe(setCanInstall);
  }, []);

  return { canInstall, isIOS, isStandalone, promptInstall };
}
