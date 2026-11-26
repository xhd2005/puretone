import type { CoverPalette } from '@/types/music';

export const DEFAULT_APPLE_PALETTE: CoverPalette = {
  accentLight: '#FA243C',
  accentDark: '#FF375F',
  fluidColors: ['#5A1428', '#2A1038', '#141B38', '#3E1220'],
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Clamp extracted dominant RGB into readable light-mode accent, dark-mode OLED accent,
 * and 4 rich deep ambient mesh colors for the Apple Music fluid full-screen backdrop.
 */
export function buildPaletteFromSamples(samples: Rgb[]): CoverPalette {
  if (!samples.length) return DEFAULT_APPLE_PALETTE;

  // Score by vibrance so grays/blacks/whites don't dominate
  const scored = samples
    .map((rgb) => {
      const hsl = rgbToHsl(rgb);
      const lDist = 1 - Math.abs(hsl.l - 0.48) * 1.6;
      const score = hsl.s * 0.72 + Math.max(0, lDist) * 0.28;
      return { rgb, hsl, score };
    })
    .sort((a, b) => b.score - a.score);

  const primary = scored[0].hsl;
  // If cover is nearly monochrome, fall back gracefully to Apple Coral Red for accent
  const isMonochrome = primary.s < 0.14;
  const accentLight = isMonochrome
    ? DEFAULT_APPLE_PALETTE.accentLight
    : hslToHex({
        h: primary.h,
        s: Math.max(0.58, Math.min(0.86, primary.s * 1.15)),
        l: Math.max(0.36, Math.min(0.47, primary.l)),
      });

  const accentDark = isMonochrome
    ? DEFAULT_APPLE_PALETTE.accentDark
    : hslToHex({
        h: primary.h,
        s: Math.max(0.65, Math.min(0.92, primary.s * 1.2)),
        l: Math.max(0.56, Math.min(0.68, primary.l + 0.14)),
      });

  // Pick 4 distinct hue-spaced dark ambient stops for the fluid backdrop
  const chosen: Hsl[] = [primary];
  for (const item of scored) {
    if (chosen.length >= 4) break;
    const minHueGap = Math.min(...chosen.map((c) => Math.min(Math.abs(c.h - item.hsl.h), 360 - Math.abs(c.h - item.hsl.h))));
    if (minHueGap >= 28 || item.score > 0.35) {
      chosen.push(item.hsl);
    }
  }
  while (chosen.length < 4) {
    const base = chosen[chosen.length - 1];
    chosen.push({ h: (base.h + 42) % 360, s: Math.max(0.28, base.s * 0.85), l: 0.24 });
  }

  const fluid = chosen.slice(0, 4).map((hsl, i) =>
    hslToHex({
      h: hsl.h,
      s: Math.max(0.28, Math.min(0.76, hsl.s)),
      l: i === 0 ? 0.26 : i === 1 ? 0.20 : i === 2 ? 0.15 : 0.22,
    }),
  ) as [string, string, string, string];

  return {
    accentLight,
    accentDark,
    fluidColors: fluid,
  };
}

const paletteCache = new Map<string, CoverPalette>();

export async function extractPaletteFromCoverUrl(coverUrl: string): Promise<CoverPalette> {
  if (!coverUrl) return DEFAULT_APPLE_PALETTE;
  const cached = paletteCache.get(coverUrl);
  if (cached) return cached;
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return DEFAULT_APPLE_PALETTE;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const done = (p: CoverPalette) => {
      paletteCache.set(coverUrl, p);
      resolve(p);
    };
    const timer = setTimeout(() => done(DEFAULT_APPLE_PALETTE), 3000);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        const size = 24;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(DEFAULT_APPLE_PALETTE);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const samples: Rgb[] = [];
        for (let i = 0; i < data.length; i += 16) {
          if (data[i + 3] < 128) continue;
          samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        }
        done(buildPaletteFromSamples(samples));
      } catch {
        done(DEFAULT_APPLE_PALETTE);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      done(DEFAULT_APPLE_PALETTE);
    };
    img.src = coverUrl;
  });
}
