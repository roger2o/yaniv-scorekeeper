/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE: vite-plugin-pwa is installed (see package.json) but intentionally NOT
// wired up here. The service-worker / manifest configuration is Phase 8 work.
// The dev server binds to all interfaces (--host is also set in the npm script)
// so it is reachable from the Windows browser in Roger's WSL2 setup.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
