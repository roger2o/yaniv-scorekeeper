/*
 * PWA web app manifest, defined as a typed object so it can be unit-tested for
 * shape (required fields, the maskable icon, theme/background using real Felt &
 * Chips theme tokens with no pure #000/#fff) and imported by vite.config.ts.
 *
 * Colours are the Felt & Chips DEFAULT theme tokens from src/theme/tokens.css:
 *   --surface  #1f4a3d  (deep felt green) — theme_color + background_color.
 */
import type { ManifestOptions } from 'vite-plugin-pwa';

export const FELT_SURFACE = '#1f4a3d';

export const pwaManifest: Partial<ManifestOptions> = {
  name: 'Yaniv Scorekeeper',
  short_name: 'Yaniv',
  description:
    'Fast, offline scorekeeper for live games of Yaniv — handles Assaf, the +30 penalty and the 100-halving rule so you can focus on the cards.',
  lang: 'en',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  theme_color: FELT_SURFACE,
  background_color: FELT_SURFACE,
  icons: [
    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      // Maskable icon — required for a clean Android/iOS home-screen install.
      src: 'pwa-maskable-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};
