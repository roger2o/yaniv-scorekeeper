import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';

// Theme layer: self-hosted display fonts first (so the @font-face families are
// defined before any token names them), then tokens (CSS variables), then the
// floor (which consumes them), then shared app primitives. Order matters —
// tokens must load before any rule that references them.
import './theme/fonts.css';
import './theme/tokens.css';
import './theme/floor.css';
import './theme/app.css';

// Register the service worker. With registerType: 'autoUpdate' (vite.config.ts)
// the worker uses skipWaiting + clientsClaim, so a new build is adopted SILENTLY
// on the next load — no "update available" prompt needed. `immediate: true`
// registers as soon as the page loads. This is the guard against an offline,
// un-patchable device serving a stale/buggy build forever. Registered here in
// the entry point (not in App.tsx) so the build-only `virtual:pwa-register`
// module is never pulled into the jsdom test runs. SW only activates over
// HTTPS/localhost (no-op on the LAN dev server) — verified on the Netlify
// HTTPS preview.
registerSW({ immediate: true });

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
