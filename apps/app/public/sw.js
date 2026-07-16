// Service worker de VoiceScheduler — recepción de Web Push (RN-130..135).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'VoiceScheduler', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'VoiceScheduler', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      lang: 'es',
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => 'focus' in w);
      return open ? open.focus() : clients.openWindow('/');
    }),
  );
});
