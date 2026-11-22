/* Parte del service worker que atiende las notificaciones push. La carga el service worker generado. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  // Rutas relativas al ámbito del service worker: la app puede vivir en una subcarpeta (p. ej. /HR-core/).
  const scope = self.registration.scope;
  const target = new URL(`go?to=${encodeURIComponent(data.link || '/')}${data.organizationId ? `&ws=${data.organizationId}` : ''}`, scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title || 'HR-Core', {
      body: data.body || '',
      icon: new URL('icon-192.png', scope).href,
      badge: new URL('icon-192.png', scope).href,
      tag: data.tag,
      data: { target },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.target) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Si la app ya está abierta se reutiliza esa ventana.
      for (const client of clients) {
        if ('focus' in client) return client.focus().then((c) => ('navigate' in c ? c.navigate(target) : undefined));
      }
      return self.clients.openWindow(target);
    }),
  );
});
