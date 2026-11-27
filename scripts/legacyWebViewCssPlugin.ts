import type { Plugin } from 'vite';

/**
 * Converts an Oklab (L in [0..1], a, b) color into sRGB [0..255] channels
 * using Björn Ottosson's exact inverse Oklab matrix.
 */
function oklabToSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const linR = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linB = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toByte = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255);
  };

  return [toByte(linR), toByte(linG), toByte(linB)];
}

function parseNumericToken(token: string, isPercentScale = false): number {
  const t = token.trim().toLowerCase();
  if (!t || t === 'none') return 0;
  if (t.endsWith('%')) {
    const n = parseFloat(t.slice(0, -1));
    return Number.isFinite(n) ? (isPercentScale ? n / 100 : n / 100) : 0;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

function formatRgb(r: number, g: number, b: number, alphaRaw?: string): string {
  if (!alphaRaw) return `rgb(${r},${g},${b})`;
  const a = Math.max(0, Math.min(1, parseNumericToken(alphaRaw, true)));
  if (a >= 0.999) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
}

/** Replaces all `oklch(...)` and `oklab(...)` functions with exact sRGB `rgb(...)`/`rgba(...)` for Chrome < 111. */
export function convertOkColorsToSrgb(css: string): string {
  let out = css.replace(/oklch\(\s*([^)]+?)\s*\)/gi, (_m, inner: string) => {
    const [coordsPart, alphaPart] = inner.split('/');
    const parts = coordsPart.trim().split(/\s+/);
    if (parts.length < 3) return _m;
    const L = parseNumericToken(parts[0], true);
    const C = parseNumericToken(parts[1], false);
    const hRaw = parts[2].trim().toLowerCase();
    let hDeg = 0;
    if (hRaw !== 'none') {
      if (hRaw.endsWith('rad')) hDeg = (parseFloat(hRaw) * 180) / Math.PI;
      else if (hRaw.endsWith('turn')) hDeg = parseFloat(hRaw) * 360;
      else if (hRaw.endsWith('grad')) hDeg = parseFloat(hRaw) * 0.9;
      else hDeg = parseFloat(hRaw) || 0;
    }
    const hRad = (hDeg * Math.PI) / 180;
    const [r, g, b] = oklabToSrgb(L, C * Math.cos(hRad), C * Math.sin(hRad));
    return formatRgb(r, g, b, alphaPart);
  });

  out = out.replace(/oklab\(\s*([^)]+?)\s*\)/gi, (_m, inner: string) => {
    const [coordsPart, alphaPart] = inner.split('/');
    const parts = coordsPart.trim().split(/\s+/);
    if (parts.length < 3) return _m;
    const L = parseNumericToken(parts[0], true);
    const a = parseNumericToken(parts[1], false);
    const b = parseNumericToken(parts[2], false);
    const [r, g, bCh] = oklabToSrgb(L, a, b);
    return formatRgb(r, g, bCh, alphaPart);
  });

  return out;
}

/** Finds matching closing brace `}` for an opening `{` at `openIdx`, skipping strings and comments. */
function findMatchingBrace(css: string, openIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < css.length; i += 1) {
    const ch = css[i];
    if (inStr) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) return css.length - 1;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Unwraps every CSS Cascade `@layer <name> { ... }` block and drops bare `@layer a, b;`
 * declarations so Android 8-11 / ColorOS 11.1 WebView (Chromium 80-98, pre-@layer) parses
 * 100% of Tailwind CSS v4 styles in exact cascade order!
 */
export function unwrapCssLayers(css: string): string {
  let out = '';
  let i = 0;
  const len = css.length;

  while (i < len) {
    // Preserve comments verbatim
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    if (
      css[i] === '@' &&
      css.slice(i, i + 6).toLowerCase() === '@layer' &&
      /[\s{;]/.test(css[i + 6] || '')
    ) {
      // Scan forward to `{` or `;`
      let j = i + 6;
      while (j < len && css[j] !== '{' && css[j] !== ';') j += 1;
      if (j >= len) break;

      if (css[j] === ';') {
        // Bare `@layer theme, base, components, utilities;` -> drop
        i = j + 1;
        continue;
      }

      const layerName = css.slice(i + 6, j).trim();
      const closeIdx = findMatchingBrace(css, j);
      if (closeIdx < 0) {
        out += css.slice(i);
        break;
      }

      let inner = css.slice(j + 1, closeIdx);
      // Recursively unwrap any nested @layer
      inner = unwrapCssLayers(inner);

      // Tailwind v4's `@layer properties` wraps `--tw-*` defaults inside a Safari/Firefox-only
      // `@supports (...)` guard because it assumes Chrome 111+ has `@property`.
      // Chrome 80-84 lacks `@property`, so unwrap that outer `@supports` guard to initialize
      // all `--tw-*` defaults universally!
      if (layerName === 'properties' && inner.trimStart().startsWith('@supports')) {
        const braceStart = inner.indexOf('{');
        const braceEnd = braceStart >= 0 ? findMatchingBrace(inner, braceStart) : -1;
        if (braceStart >= 0 && braceEnd > braceStart) {
          inner = inner.slice(braceStart + 1, braceEnd);
        }
      }

      out += inner;
      i = closeIdx + 1;
      continue;
    }

    out += css[i];
    i += 1;
  }

  return out;
}

/**
 * Unwraps `:where(...)` selectors so Chromium 80-87 WebView doesn't discard Tailwind v4's
 * `space-y-*`, `divide-y`, `divide-*`, or base reset rules.
 */
export function unwrapWhereSelectors(css: string): string {
  // Handle known base reset patterns with comma lists cleanly first
  let out = css
    .replace(
      /button,input:where\(\[type=button\],\[type=reset\],\[type=submit\]\)/g,
      'button,input[type=button],input[type=reset],input[type=submit]',
    )
    .replace(/:where\(select:is\(\[multiple\],\[size\]\)\)\s*optgroup/g, 'select[multiple] optgroup,select[size] optgroup')
    .replace(/\[hidden\]:where\(:not\(\[hidden=until-found\]\)\)/g, '[hidden]')
    .replace(/:-moz-focusring:where\(:not\(iframe\)\)/g, ':-moz-focusring');

  // Unwrap remaining single-argument `:where(...)` via balanced paren scan
  let result = '';
  let i = 0;
  while (i < out.length) {
    if (out.slice(i, i + 7) === ':where(') {
      let depth = 0;
      let j = i + 6;
      for (; j < out.length; j += 1) {
        if (out[j] === '(') depth += 1;
        else if (out[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth === 0) {
        result += out.slice(i + 7, j);
        i = j + 1;
        continue;
      }
    }
    result += out[i];
    i += 1;
  }
  return result;
}

/**
 * Expands `inset: <single-val>` to `top:<v>;right:<v>;bottom:<v>;left:<v>` for Chrome 80-86,
 * and replaces Tailwind v4 standalone `translate:` / `scale:` properties with `transform:` for Chrome < 104.
 */
export function downlevelLayoutAndTransforms(css: string): string {
  let out = css;

  // 1. Expand single-value `inset:` shorthand (`inset:0`, `inset:0px`, `inset:4px`, `inset:var(--x)`)
  out = out.replace(
    /([{;])inset\s*:\s*([^;{}!\s]+)(\s*!important)?(?=[;}])/g,
    (_m, sep: string, val: string, imp: string = '') =>
      `${sep}top:${val}${imp};right:${val}${imp};bottom:${val}${imp};left:${val}${imp}`,
  );

  // 2. Replace standalone `translate:` and `scale:` emitted by Tailwind v4 with `transform:` (Chrome 36+)
  out = out.replace(
    /([{;])translate\s*:\s*var\(--tw-translate-x\)\s+var\(--tw-translate-y\)(?=[;}])/g,
    '$1transform:translate3d(var(--tw-translate-x,0),var(--tw-translate-y,0),0)',
  );
  out = out.replace(
    /([{;])scale\s*:\s*var\(--tw-scale-x\)\s+var\(--tw-scale-y\)(?=[;}])/g,
    '$1transform:scale(var(--tw-scale-x,1),var(--tw-scale-y,1))',
  );

  // 3. Improve Tailwind v4 `bg-[var(--accent)]/14|15|16` fallback on Chrome < 111 (where color-mix isn't supported)
  // so it falls back to a subtle translucent accent instead of 100% solid opaque blue!
  out = out.replace(
    /(\.bg-\\\[var\\\(--accent\\\)\\\]\\\/(1[0-9]|2[0-5]))\{background-color:var\(--accent\)\}/g,
    (_m, sel: string, pctStr: string) => {
      const alpha = (Number(pctStr) / 100).toFixed(2);
      return `${sel}{background-color:rgba(52,86,190,${alpha})}`;
    },
  );
  out = out.replace(
    /(\.border-\\\[var\\\(--accent\\\)\\\]\\\/(20|30|40))\{border-color:var\(--accent\)\}/g,
    (_m, sel: string, pctStr: string) => {
      const alpha = (Number(pctStr) / 100).toFixed(2);
      return `${sel}{border-color:rgba(52,86,190,${alpha})}`;
    },
  );

  return out;
}

/**
 * Complete build-time CSS compatibility pipeline targeting Android 8-17 WebView (Chromium 80+).
 */
export function transformCssForLegacyWebView(css: string): string {
  let out = unwrapCssLayers(css);
  out = unwrapWhereSelectors(out);
  out = convertOkColorsToSrgb(out);
  out = downlevelLayoutAndTransforms(out);
  return out;
}

export function legacyWebViewCssPlugin(): Plugin {
  return {
    name: 'melune-legacy-webview-css',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset' && item.fileName.endsWith('.css') && typeof item.source === 'string') {
          item.source = transformCssForLegacyWebView(item.source);
        }
      }
    },
  };
}
