// Service worker escrito à mão, sem Workbox — não faz cache de conteúdo
// (chat/tickets são dados vivos, cache agressivo atrapalharia). Existe
// basicamente para hospedar os listeners `push`/`notificationclick`, que são
// o que permite a notificação aparecer com o app fechado/tela bloqueada.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'SSX Resolve', body: event.data.text() };
  }

  const title = payload.title || 'SSX Resolve';
  const options = {
    body: payload.body || '',
    // Logo sem fundo (transparente) — o favicon com fundo branco/navy fica
    // ótimo na aba do Chrome, mas na notificação do celular o quadrado sólido
    // destoava do fundo do sistema; aqui a marca se adapta ao tema do SO.
    icon: '/branding/iconnobg.png',
    badge: '/branding/iconnobg.png',
    tag: payload.tag || 'ssx-resolve',
    data: { url: payload.url || '/dashboard' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        if (clientList[0].navigate) clientList[0].navigate(targetUrl);
        return clientList[0].focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
