import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.env.VITE_DEPLOY_BASE ?? '/';
const testReplay = process.env.GITHUB_REPOSITORY === 'TESTwoodmo/testwoodmo.github.io' && process.env.WOODMO_TEST_REPLAY === '1';
const workerScript = testReplay ? 'sw-release.js' : 'sw.js';

// Kennung des veröffentlichten Builds für die Startseite und GitHub-Pages-Prüfung.
function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'lokal'; }
}
/** Versionsnummer für die Startseite: „3.<Nummer des zuletzt gemergten PR>“, z. B. 3.27.
 * Wird aus der Merge-Nachricht („Merge pull request #27 …“) gelesen; ohne PR bleibt „3.0“. */
function appVersion(): string {
  try {
    const log = execSync('git log -50 --format=%s', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const match = log.match(/Merge pull request #(\d+)/);
    return match ? `3.${match[1]}` : '3.0';
  } catch { return '3.0'; }
}
const releaseNotes = JSON.parse(readFileSync(new URL('./src/releaseNotes.json', import.meta.url), 'utf8'));
const WOODMO_BUILD = { version: releaseNotes.version ?? appVersion(), commit: gitCommit(), builtAt: new Date().toISOString(), title: releaseNotes.title, notes: releaseNotes.notes };
const workerBuild = `${WOODMO_BUILD.commit}:${WOODMO_BUILD.builtAt}`;
const workerGuard = `woodmo-update-${WOODMO_BUILD.commit}-${Date.parse(WOODMO_BUILD.builtAt)}.js`;

// https://vitejs.dev/config/
export default defineConfig({
  base,
  define: {
    __WOODMO_BUILD__: JSON.stringify(WOODMO_BUILD),
  },
  plugins: [
    react(),
    {
      name: 'woodmo-version-json',
      generateBundle(_options, bundle) {
        const files = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name));
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...WOODMO_BUILD, files, workerGuard, workerScript }, null, 2) });
        this.emitFile({ type: 'asset', fileName: workerGuard, source: `
const woodmoTarget = ${JSON.stringify(workerBuild)};
const woodmoApproval = new URL('.woodmo-update-approval', self.registration.scope).href;
async function woodmoWindows() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.filter(client => client.url.startsWith(self.registration.scope));
}
// Marker: the active worker already understands approved updates.
const woodmoGuardMarker = new URL('.woodmo-update-guard', self.registration.scope).href;
// Devices still running a version before approved updates (<= 3.33) cannot approve.
// For that one switch, behave like the previous auto-update and reload the open app once.
let woodmoLegacySwitch = false;
// 23.11.: Freigabepflicht nur, wenn der AKTIVE Update-Dienst selbst Freigaben kennt und
// antwortet. Ein liegengebliebenes Kennzeichen (z. B. nach Rückkehr auf 3.33) blockiert nicht mehr.
function woodmoActiveIsGuarded() {
  const active = self.registration.active;
  if (!active) return Promise.resolve(false);
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data === 'WOODMO_GUARD_OK'); };
    try { active.postMessage({ type: 'WOODMO_GUARD_PING' }, [channel.port2]); } catch { clearTimeout(timer); resolve(false); }
  });
}
self.addEventListener('install', event => {
  if (!self.registration.active) return;
  event.waitUntil((async () => {
    if (!await woodmoActiveIsGuarded()) {
      woodmoLegacySwitch = true;
      await self.skipWaiting();
      return;
    }
    const record = await caches.match(woodmoApproval, { cacheName: 'woodmo-update-approval-v1' });
    if (!record || await record.text() !== woodmoTarget || (await woodmoWindows()).length > 1) {
      throw new Error('WOODMO update requires approval in the only open app window');
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open('woodmo-update-approval-v1');
      await cache.put(woodmoGuardMarker, new Response('1'));
      if (!woodmoLegacySwitch) return;
      await self.clients.claim();
      for (const client of await woodmoWindows()) {
        try { await client.navigate(client.url); } catch { /* reopened later */ }
      }
    } catch { /* never block activation */ }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'WOODMO_GUARD_PING' && event.ports[0]) { event.ports[0].postMessage('WOODMO_GUARD_OK'); return; }
  if (event.data?.type !== 'WOODMO_APPROVED_UPDATE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const ok = event.data.build === woodmoTarget && (await woodmoWindows()).length <= 1;
    if (ok) await self.skipWaiting();
    event.ports[0].postMessage(ok);
  })());
});
` });
      },
    },
    VitePWA({
      registerType: 'prompt',
      filename: workerScript,
      ...(testReplay ? { injectRegister: null } : {}),
      includeAssets: ['woodmo-v3-logo.png', 'woodmo-v3-logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'WOODMO Kassen-App Version 3.0',
        short_name: 'WOODMO V3',
        description: 'Kassensystem für Friedrichshafen & Bregenz — installierbar als App auf Tablet & Smartphone.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        lang: 'de',
        icons: [
          { src: `${base}woodmo-v3-logo.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: `${base}pwa-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}pwa-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android schneidet „maskable“-Icons rund zu: Logo mit Rand (72 %), damit WOODMO ganz lesbar bleibt (18.11.2026).
          { src: `${base}pwa-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: `${base}pwa-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: [workerGuard],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        navigateFallback: `${base}index.html`,
        ...(testReplay ? { navigateFallbackDenylist: [/^\/update-test(?:-start)?\.html(?:\?|$)/] } : {}),
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/v1/object/public/article-images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'article-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['pdfjs-dist'],
  },
});
