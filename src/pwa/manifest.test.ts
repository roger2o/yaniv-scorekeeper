import { describe, it, expect } from 'vitest';
import { pwaManifest, FELT_SURFACE } from './manifest';

// The PWA manifest is the contract that makes the app installable. These guard
// the shape so a future edit can't silently drop a field that breaks install
// (e.g. the maskable icon — its absence is the usual reason an install looks
// broken). True install/offline behaviour is verified on the HTTPS preview.
describe('PWA manifest', () => {
  it('declares the installable identity fields', () => {
    expect(pwaManifest.name).toBe('Yaniv Scorekeeper');
    expect(pwaManifest.short_name).toBe('Yaniv');
    expect(pwaManifest.description).toBeTruthy();
    expect(pwaManifest.lang).toBe('en');
    expect(pwaManifest.start_url).toBe('/');
    expect(pwaManifest.scope).toBe('/');
    expect(pwaManifest.display).toBe('standalone');
    expect(pwaManifest.orientation).toBe('portrait');
  });

  it('uses the Felt & Chips theme tokens for theme/background (no pure #000/#fff)', () => {
    expect(pwaManifest.theme_color).toBe(FELT_SURFACE);
    expect(pwaManifest.background_color).toBe(FELT_SURFACE);
    for (const c of [pwaManifest.theme_color, pwaManifest.background_color]) {
      expect(c?.toLowerCase()).not.toBe('#000');
      expect(c?.toLowerCase()).not.toBe('#000000');
      expect(c?.toLowerCase()).not.toBe('#fff');
      expect(c?.toLowerCase()).not.toBe('#ffffff');
    }
  });

  it('ships 192, 512, and a 512 MASKABLE icon', () => {
    const icons = pwaManifest.icons ?? [];
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    const maskable = icons.filter((i) => i.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0]?.sizes).toBe('512x512');
    expect(maskable[0]?.type).toBe('image/png');
    // every icon is a real PNG reference
    for (const i of icons) {
      expect(i.type).toBe('image/png');
      expect(i.src).toMatch(/\.png$/);
    }
  });
});
