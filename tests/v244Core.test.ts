import { describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  computeHeroFlipTransform,
  computeMetaGlideTransform,
  computeQueueWindow,
} from '@/utils/heroMorph';
import {
  convertOkColorsToSrgb,
  downlevelLayoutAndTransforms,
  transformCssForLegacyWebView,
  unwrapCssLayers,
  unwrapWhereSelectors,
} from '../scripts/legacyWebViewCssPlugin';
import { useUiStore } from '@/stores/ui';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';

describe('v2.4.4 Shared-Element Hero Morph & Bottom Batch Dock', () => {
  it('computes exact cover -> mini-thumb FLIP transform and inverse-scaled radius', () => {
    const coverRect = { left: 40, top: 140, width: 320, height: 320 };
    const miniRect = { left: 24, top: 64, width: 48, height: 48 };

    const plan = computeHeroFlipTransform(coverRect, miniRect, {
      fromRadiusPx: 18,
      toRadiusPx: 10,
      targetRestScale: 1,
    });

    expect(plan).not.toBeNull();
    // Centers: cover (200, 300), mini (48, 88) -> dx = 152, dy = 212
    expect(plan!.dx).toBe(152);
    expect(plan!.dy).toBe(212);
    expect(plan!.startScaleX).toBeCloseTo(320 / 48, 3);
    expect(plan!.startScaleY).toBeCloseTo(320 / 48, 3);
    expect(plan!.toBorderRadius).toBe('10px');
    // Inverse compensated radius: 18 / (320/48) = 2.7px -> visually renders as 18px at scale 6.667
    expect(parseFloat(plan!.fromBorderRadius)).toBeCloseTo(2.7, 1);
  });

  it('accounts for paused 0.84 restScale accurately when flying mini-thumb -> paused cover', () => {
    const miniRect = { left: 24, top: 64, width: 48, height: 48 };
    // Paused cover layout width is 300px, visually scaled 0.84 -> 252px
    const pausedCoverRect = { left: 74, top: 174, width: 252, height: 252 };

    const plan = computeHeroFlipTransform(miniRect, pausedCoverRect, {
      fromRadiusPx: 10,
      toRadiusPx: 18,
      targetRestScale: 0.84,
    });

    expect(plan).not.toBeNull();
    // startScale = (48 / 252) * 0.84 = 48 / 300 = 0.16 (exact match to mini width!)
    expect(plan!.startScaleX).toBeCloseTo(0.16, 4);
    expect(plan!.endScale).toBe(0.84);
    expect(plan!.toTransform).toContain('scale3d(0.84, 0.84, 1)');
  });

  it('returns null gracefully for degenerate zero-size rects', () => {
    expect(
      computeHeroFlipTransform(
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 24, top: 64, width: 48, height: 48 },
        { fromRadiusPx: 18, toRadiusPx: 10 },
      ),
    ).toBeNull();
  });

  it('computes smooth metadata glide delta between cover meta and mini header meta', () => {
    const glide = computeMetaGlideTransform(
      { left: 28, top: 520, width: 240, height: 52 },
      { left: 84, top: 68, width: 180, height: 42 },
    );
    expect(glide).not.toBeNull();
    expect(glide!.dx).toBe(-56);
    expect(glide!.dy).toBe(452);
  });

  it('manages batchDockActive state and exits batch mode on hardware back before popping route', () => {
    setActivePinia(createPinia());
    const ui = useUiStore();
    const onExit = vi.fn();

    expect(ui.batchDockActive).toBe(false);
    ui.setBatchDock(true, onExit);
    expect(ui.batchDockActive).toBe(true);

    const handled = ui.closeTopOverlay();
    expect(handled).toBe(true);
    expect(ui.batchDockActive).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('windows large 1,500-track queues around currentIndex to avoid transition DOM spikes', () => {
    const win = computeQueueWindow(1477, 100, 15, 45);
    expect(win.start).toBe(85);
    expect(win.end).toBe(146);
    expect(win.end - win.start).toBe(61);
    expect(win.hasPrev).toBe(true);
    expect(win.hasNext).toBe(true);
    expect(win.prevCount).toBe(85);
    expect(win.nextCount).toBe(1331);

    const startEdge = computeQueueWindow(30, 2, 15, 45);
    expect(startEdge).toEqual({
      start: 0,
      end: 30,
      hasPrev: false,
      hasNext: false,
      prevCount: 0,
      nextCount: 0,
    });
  });

  it('reports a valid v2.4.x fallback app version', () => {
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.4\.\d+$/);
  });
});

describe('v2.4.4 Android 11 / ColorOS 11.1 Legacy WebView CSS Compat', () => {
  it('unwraps all @layer blocks & properties guard while preserving nested @media rules', () => {
    const raw =
      '@layer theme, base, utilities;' +
      '@layer properties{@supports ((-webkit-hyphens:none)){*,:before,:after{--tw-translate-x:0;--tw-border-style:solid}}}' +
      '@layer utilities{.hidden{display:none}@media (min-width:48rem){.md\\:flex{display:flex}}}';
    const out = unwrapCssLayers(raw);
    expect(out).not.toContain('@layer');
    expect(out).not.toContain('-webkit-hyphens');
    expect(out).toContain('--tw-border-style:solid');
    expect(out).toContain('.hidden{display:none}');
    expect(out).toContain('@media (min-width:48rem){.md\\:flex{display:flex}}');
  });

  it('unwraps :where() selectors used by space-y and divide-y for Chrome 80-87', () => {
    const raw =
      ':where(.space-y-4>:not(:last-child)){margin-bottom:1rem}' +
      'button,input:where([type=button],[type=reset],[type=submit]){appearance:button}';
    const out = unwrapWhereSelectors(raw);
    expect(out).not.toContain(':where(');
    expect(out).toContain('.space-y-4>:not(:last-child){margin-bottom:1rem}');
    expect(out).toContain('button,input[type=button],input[type=reset],input[type=submit]');
  });

  it('converts oklch() and oklab() colors to exact sRGB rgb()/rgba() values', () => {
    const out = convertOkColorsToSrgb(
      '--c1:oklch(70.8% 0 none);--c2:oklab(58.7617% -.0652674 -.122575/.25)',
    );
    expect(out).not.toContain('oklch');
    expect(out).not.toContain('oklab');
    expect(out).toContain('--c1:rgb(161,161,161)');
    expect(out).toContain('--c2:rgba(2,132,199,0.25)');
  });

  it('expands inset:0 and standalone translate:/scale: into Chrome 80+ compatible CSS', () => {
    const out = downlevelLayoutAndTransforms(
      '.ov{position:fixed;inset:0}.t{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}.s{scale:var(--tw-scale-x) var(--tw-scale-y)}',
    );
    expect(out).toContain('top:0;right:0;bottom:0;left:0');
    expect(out).toContain('transform:translate3d(var(--tw-translate-x,0),var(--tw-translate-y,0),0)');
    expect(out).toContain('transform:scale(var(--tw-scale-x,1),var(--tw-scale-y,1))');
  });

  it('runs full pipeline cleanly with zero legacy-breaking syntax left over', () => {
    const sample =
      '@layer utilities{.x{position:absolute;inset:0;color:oklch(55.6% 0 none)}:where(.divide-y>:not(:last-child)){border-bottom-width:1px}}';
    const out = transformCssForLegacyWebView(sample);
    expect(out).not.toMatch(/@layer|:where\(|oklch\(|oklab\(|[{;]inset:/);
    expect(out).toContain('top:0;right:0;bottom:0;left:0');
    expect(out).toContain('rgb(115,115,115)');
  });
});
