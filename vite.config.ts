/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaManifest } from './src/pwa/manifest';

// PWA wiring (Phase 8). The Yaniv Scorekeeper is a pure client-side, offline-
// first app installed to the home screen. There is NO runtime API or remote
// data — so the precached app shell IS the entire offline experience; no
// separate offline.html is needed.
//
// Update strategy = autoUpdate (registerType). The generated service worker
// uses skipWaiting + clientsClaim so a refreshed device SILENTLY adopts the
// newest build instead of serving a stale one forever. This is the deliberate
// guard against the classic "a scoring bug lives forever on an un-patchable
// device" trap — offline devices can't be hot-fixed, so we must guarantee the
// next load picks up the latest shipped fix.
//
// HTML shell freshness: the navigation route is served NetworkFirst (with a
// fast timeout + cache fallback), not cache-first, so a new hashed bundle is
// discovered on the next load when online, while a fully-offline launch still
// falls back to the precached index. The hashed JS/CSS assets are immutable
// and safely precached cache-first.
//
// The dev server binds to all interfaces (--host, also in the npm script) so
// it is reachable from the Windows browser in Roger's WSL2 setup. NOTE: PWA
// install + the service worker only work over HTTPS or localhost, so true
// install/offline verification happens on the Netlify HTTPS preview (Wells),
// NOT the LAN dev server.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Static assets in /public that aren't fingerprinted but must be served.
      includeAssets: [
        'favicon.png',
        'apple-touch-icon.png',
        'icon.svg',
        'fonts/nunito-latin.woff2',
        'fonts/baloo2-latin.woff2',
      ],
      // Manifest is defined (and unit-tested) in src/pwa/manifest.ts. Felt &
      // Chips default-theme tokens, no pure #000/#fff; includes the maskable
      // icon required for a clean home-screen install.
      manifest: pwaManifest,
      workbox: {
        // Precache the FULL app shell so first-load-then-offline is reliable.
        // Covers html/js/css/icons/manifest/fonts in the dist output.
        globPatterns: ['**/*.{html,js,css,png,svg,ico,woff2,webmanifest}'],
        // Serve the HTML shell NetworkFirst (revalidated), not cache-first, so a
        // new hashed bundle is discovered on the next online load; offline falls
        // back to the precached index so a fully-offline launch still works.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-shell',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4 },
            },
          },
        ],
        // skipWaiting + clientsClaim back the autoUpdate strategy: a refreshed
        // device adopts the newest service worker immediately.
        clientsClaim: true,
        skipWaiting: true,
      },
      // Keep the dev server lean; the SW is exercised against the production
      // build / HTTPS preview, not the LAN dev server (SW needs HTTPS/localhost).
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
