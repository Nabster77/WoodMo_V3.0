/*
 * WOODMO: Nach einem Update die offene App einmal selbst neu laden.
 * Wird vom Service-Worker (sw.js) geladen. Nur beim Wechsel von einer älteren
 * Version, nie beim allerersten Installieren. Gebuchte Verkäufe sind gespeichert;
 * nur ein noch nicht bezahlter Warenkorb wäre danach leer.
 */
/* eslint-disable no-restricted-globals */
let woodmoIsUpdate = false;

self.addEventListener('install', () => {
  // Gibt es schon eine aktive (ältere) Version, ist das ein Update.
  woodmoIsUpdate = Boolean(self.registration && self.registration.active);
});

self.addEventListener('activate', (event) => {
  if (!woodmoIsUpdate) return;
  event.waitUntil((async () => {
    try {
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try { await client.navigate(client.url); } catch { /* Fenster ohne Zugriff: beim nächsten Öffnen neu */ }
      }
    } catch { /* nie das Update blockieren */ }
  })());
});
