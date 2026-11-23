/* Only published as /sw.js on testwoodmo.github.io. The release worker uses /sw-release.js. */
const replayPath = '/update-test.html';

function isReplay(client) {
  return new URL(client.url).pathname === replayPath;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const end = Date.now() + 6000;
    do {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.length === 1 && isReplay(windows[0])) {
        await self.skipWaiting();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < end);
    throw new Error('Der Teststart ist nur im einzigen geöffneten Test-Tab möglich.');
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const launcher = windows.length === 1 && isReplay(windows[0]) ? windows[0] : null;
    if (launcher) {
      // Do not await a navigation governed by this worker's own activation event.
      void launcher.navigate('/update-test-start.html').catch(() => undefined);
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'WOODMO_TEST_REPLAY_CHECK' && event.ports[0]) {
    event.ports[0].postMessage('WOODMO_TEST_REPLAY_READY');
  }
});
