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
    payload = { title: 'SSX Desk', body: event.data.text() };
  }

  const title = payload.title || 'SSX Desk';
  const options = {
    body: payload.body || '',
    // Nova marca (SSX Desk) usa texto quase-branco, ilegível sem um fundo
    // escuro — iconnobg.png agora tem a mesma placa azul-marinho do
    // icon.png (transparência pura deixou de ser viável com essa logo).
    icon: '/branding/iconnobg.png?v=2',
    badge: '/branding/iconnobg.png?v=2',
    tag: payload.tag || 'ssx-desk',
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
