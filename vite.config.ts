import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const base = process.env.VITE_DEPLOY_BASE ?? '/';

// Versionskennung für die Update-Zentrale: Commit + Bauzeit. Wird in die App
// eingebaut und zusätzlich als version.json (nicht im Offline-Speicher) abgelegt,
// damit die App online erkennen kann, ob eine neuere Version bereitliegt.
function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'lokal'; }
}
const releaseNotes = JSON.parse(readFileSync(new URL('./src/releaseNotes.json', import.meta.url), 'utf8'));
const WOODMO_BUILD = { commit: gitCommit(), builtAt: new Date().toISOString(), title: releaseNotes.title, notes: releaseNotes.notes };

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
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(WOODMO_BUILD, null, 2) });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
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
          { src: `${base}pwa-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
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
