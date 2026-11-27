import type { EffectiveLocale } from '@/i18n';

export type PosterThemeId = 'glass' | 'vinyl' | 'polaroid' | 'cinema' | 'melune';

export interface PosterLyricItem {
  text: string;
  translation?: string;
}

export interface PosterRenderOptions {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  lines: PosterLyricItem[];
  theme: PosterThemeId;
  fluidColors: [string, string, string, string];
  showTranslation: boolean;
  showDateStamp: boolean;
  locale: EffectiveLocale;
  brandName: string;
  brandSlogan: string;
  /** Render scale (1.0 = 1080x1520 HD export, 0.45 = fast crisp live preview) */
  scale?: number;
  date?: Date;
}

const MELUNE_GLYPH_PATH_108 =
  'M53.16,54.41 L53.16,30.16 C53.16,26.58 56.11,24.05 59.70,24.79 C67.93,26.47 75.31,31.01 79.32,37.44 C81.00,40.18 80.05,43.77 77.21,45.14 C74.78,46.30 71.93,45.46 70.35,43.35 C67.61,39.66 64.34,37.44 61.17,36.49 L61.17,67.92 A15.40,15.40 0 1,1 30.39,67.36 A11.18,11.18 0 1,0 44.55,52.57 A15.40,15.40 0 0,1 53.16,54.41 Z';

const EN_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatPosterDateStamp(date: Date = new Date()): string {
  const m = EN_MONTHS[date.getMonth()] || 'JAN';
  const d = String(date.getDate()).padStart(2, '0');
  const y = date.getFullYear();
  return `${m} ${d} · ${y}`;
}

function getFontStack(locale: EffectiveLocale): string {
  if (locale === 'zh-TW') {
    return '-apple-system, "PingFang TC", "Noto Sans CJK TC", "Noto Sans TC", sans-serif';
  }
  if (locale === 'en') {
    return '-apple-system, "SF Pro Display", "Inter", "Helvetica Neue", sans-serif';
  }
  return '-apple-system, "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
}

function loadCorsImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 3500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url.replace('/240/', '/480/');
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = w / h;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (imgRatio > boxRatio) {
      sw = img.naturalHeight * boxRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / boxRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    return;
  }
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#3456be');
  grad.addColorStop(0.52, '#1a2d70');
  grad.addColorStop(1, '#0b1336');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  drawMeluneGlyph(ctx, x + w * 0.2, y + h * 0.2, Math.min(w, h) * 0.6, 'rgba(255,255,255,0.88)');
}

function drawMeluneGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillStyle: string,
) {
  ctx.save();
  ctx.translate(x, y);
  const ratio = size / 108;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = fillStyle;
  if (typeof Path2D !== 'undefined') {
    ctx.fill(new Path2D(MELUNE_GLYPH_PATH_108));
  } else {
    ctx.beginPath();
    ctx.arc(54, 54, 24, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMeluneBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  drawRoundedRect(ctx, x, y, size, size, size * 0.24);
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, '#3456be');
  grad.addColorStop(0.5, '#1a2d70');
  grad.addColorStop(1, '#0b1336');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawMeluneGlyph(ctx, x, y, size, '#ffffff');
  ctx.restore();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      out.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) out.push(line);
  return out;
}

function drawSubtleGrain(ctx: CanvasRenderingContext2D, W: number, H: number, alpha = 0.035) {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  let seed = 4219;
  for (let i = 0; i < 900; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = (seed / 2147483647) * W;
    seed = (seed * 16807) % 2147483647;
    const y = (seed / 2147483647) * H;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export async function renderLyricPosterToDataUrl(options: PosterRenderOptions): Promise<string> {
  const W = 1080;
  const H = 1520;
  const scale = Math.max(0.3, Math.min(1, options.scale ?? 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  ctx.scale(scale, scale);

  const fontStack = getFontStack(options.locale);
  const coverImg = await loadCorsImage(options.coverUrl);
  const quoteItems: PosterLyricItem[] = options.lines.length
    ? options.lines
    : [{ text: options.title }];
  const dateStamp = formatPosterDateStamp(options.date);
  const isLight = options.theme === 'polaroid';
  const fluid = options.fluidColors;

  // ==================== 1. TEMPLATE BACKGROUNDS & ARTWORK ====================
  let textStartY = 740;
  let textAlign: CanvasTextAlign = 'left';
  let textPadX = 104;
  let maxTextW = W - textPadX * 2;
  let mainTextColor = 'rgba(255, 255, 255, 0.96)';
  let subTextColor = 'rgba(255, 255, 255, 0.62)';
  let quoteAccent = 'rgba(182, 212, 255, 0.45)';

  if (options.theme === 'glass') {
    // Full-bleed blurred album artwork backdrop + frosted Liquid Glass card
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, fluid[0] || '#233b86');
    bgGrad.addColorStop(0.52, fluid[1] || '#16204c');
    bgGrad.addColorStop(1, fluid[2] || '#0b1028');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    if (coverImg) {
      ctx.save();
      ctx.filter = 'blur(54px) saturate(145%)';
      ctx.globalAlpha = 0.62;
      drawCoverImage(ctx, coverImg, -80, -80, W + 160, H + 160);
      ctx.restore();
    }

    const scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, 'rgba(10, 14, 30, 0.34)');
    scrim.addColorStop(0.6, 'rgba(10, 14, 30, 0.56)');
    scrim.addColorStop(1, 'rgba(8, 11, 24, 0.80)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    // Inner Frosted Liquid Glass Panel
    ctx.save();
    drawRoundedRect(ctx, 64, 72, W - 128, H - 144, 52);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Crisp floating square artwork
    const artSize = 440;
    const artX = (W - artSize) / 2;
    const artY = 148;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
    ctx.shadowBlur = 56;
    ctx.shadowOffsetY = 22;
    drawRoundedRect(ctx, artX, artY, artSize, artSize, 40);
    ctx.fillStyle = '#18203a';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, artX, artY, artSize, artSize, 40);
    ctx.clip();
    drawCoverImage(ctx, coverImg, artX, artY, artSize, artSize);
    ctx.restore();

    textPadX = 116;
    maxTextW = W - textPadX * 2;
    textStartY = 678;
  } else if (options.theme === 'vinyl') {
    // Obsidian Velvet + Authentic Multi-Groove Vinyl LP Disc + Minimalist Tonearm
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#16171f');
    bgGrad.addColorStop(0.55, '#0c0d12');
    bgGrad.addColorStop(1, '#06070a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const halo = ctx.createRadialGradient(W * 0.5, 400, 40, W * 0.5, 400, 560);
    halo.addColorStop(0, 'rgba(104, 146, 255, 0.22)');
    halo.addColorStop(0.6, 'rgba(62, 86, 180, 0.08)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = 400;
    const outerR = 258;
    const labelR = 128;

    // Disc elevation shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
    ctx.shadowBlur = 64;
    ctx.shadowOffsetY = 24;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = '#101116';
    ctx.fill();
    ctx.restore();

    // Vinyl disc body + metallic light sheen
    const discGrad = ctx.createLinearGradient(cx - outerR, cy - outerR, cx + outerR, cy + outerR);
    discGrad.addColorStop(0, '#2a2c36');
    discGrad.addColorStop(0.28, '#121318');
    discGrad.addColorStop(0.52, '#242631');
    discGrad.addColorStop(0.75, '#0f1015');
    discGrad.addColorStop(1, '#1e2029');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = discGrad;
    ctx.fill();

    // Fine concentric grooves
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.065)';
    ctx.lineWidth = 1.2;
    for (let r = labelR + 14; r < outerR - 8; r += 8) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Center circular album art label
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
    ctx.clip();
    drawCoverImage(ctx, coverImg, cx - labelR, cy - labelR, labelR * 2, labelR * 2);
    ctx.restore();

    // Center spindle hole + metallic ring
    ctx.beginPath();
    ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1016';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Minimalist Silver Tonearm accent (upper-right)
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 232, 255, 0.42)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 266, cy - 220);
    ctx.lineTo(cx + 230, cy - 60);
    ctx.lineTo(cx + 168, cy + 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 266, cy - 220, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#323646';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    drawSubtleGrain(ctx, W, H, 0.03);
    textStartY = 740;
    quoteAccent = 'rgba(230, 206, 152, 0.42)';
  } else if (options.theme === 'polaroid') {
    // Museum Warm Cotton Paper + Classic White Polaroid Frame
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#f8f6f1');
    bgGrad.addColorStop(1, '#ede9e0');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Delicate paper grain
    ctx.save();
    ctx.fillStyle = 'rgba(40, 35, 28, 0.03)';
    let seed = 9187;
    for (let i = 0; i < 800; i += 1) {
      seed = (seed * 16807) % 2147483647;
      const x = (seed / 2147483647) * W;
      seed = (seed * 16807) % 2147483647;
      const y = (seed / 2147483647) * H;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // Polaroid card frame
    const frameW = 590;
    const frameH = 635;
    const frameX = (W - frameW) / 2;
    const frameY = 104;
    ctx.save();
    ctx.shadowColor = 'rgba(25, 22, 18, 0.14)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 20;
    drawRoundedRect(ctx, frameX, frameY, frameW, frameH, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    const photoPad = 34;
    const photoSize = frameW - photoPad * 2;
    ctx.save();
    drawRoundedRect(ctx, frameX + photoPad, frameY + photoPad, photoSize, photoSize, 12);
    ctx.clip();
    drawCoverImage(ctx, coverImg, frameX + photoPad, frameY + photoPad, photoSize, photoSize);
    ctx.restore();

    if (options.showDateStamp) {
      ctx.fillStyle = '#8b857b';
      ctx.font = `600 22px ${fontStack}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(dateStamp, frameX + frameW - photoPad, frameY + frameH - 36);
    }

    mainTextColor = '#1c1b18';
    subTextColor = '#6f6b63';
    quoteAccent = 'rgba(52, 86, 190, 0.28)';
    textStartY = 824;
  } else if (options.theme === 'cinema') {
    // Atmospheric Dark Cinema Frame + Wide 16:10 Still + Centered Movie Subtitles
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0a0d16');
    bgGrad.addColorStop(1, '#05060b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Hairline cinema border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    // Wide 16:10 cinema still
    const stillX = 84;
    const stillY = 132;
    const stillW = W - 168;
    const stillH = 570;
    ctx.save();
    drawRoundedRect(ctx, stillX, stillY, stillW, stillH, 20);
    ctx.clip();
    drawCoverImage(ctx, coverImg, stillX, stillY, stillW, stillH);
    const vig = ctx.createLinearGradient(0, stillY, 0, stillY + stillH);
    vig.addColorStop(0, 'rgba(0,0,0,0.18)');
    vig.addColorStop(0.55, 'rgba(0,0,0,0.05)');
    vig.addColorStop(1, 'rgba(5,6,11,0.72)');
    ctx.fillStyle = vig;
    ctx.fillRect(stillX, stillY, stillW, stillH);
    ctx.restore();

    if (options.showDateStamp) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.font = `600 20px ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`SCENE · ${dateStamp}`, W / 2, stillY + stillH + 30);
    }

    drawSubtleGrain(ctx, W, H, 0.032);
    textAlign = 'center';
    textPadX = 110;
    maxTextW = W - textPadX * 2;
    textStartY = 800;
    mainTextColor = '#f7f8fc';
    subTextColor = '#e6d39c'; // Classic cinematic warm subtitle gold
  } else {
    // MELUNE Signature: Deep Moonlit Indigo Starfield + Glowing Lunar Crest + Centered Poetic Layout
    const bgGrad = ctx.createLinearGradient(0, 0, W * 0.65, H);
    bgGrad.addColorStop(0, '#2c4ba8');
    bgGrad.addColorStop(0.46, '#142258');
    bgGrad.addColorStop(1, '#080e2a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const moonGlow = ctx.createRadialGradient(W * 0.78, 200, 20, W * 0.78, 200, 440);
    moonGlow.addColorStop(0, 'rgba(176, 212, 255, 0.30)');
    moonGlow.addColorStop(0.5, 'rgba(110, 152, 255, 0.08)');
    moonGlow.addColorStop(1, 'rgba(110, 152, 255, 0)');
    ctx.fillStyle = moonGlow;
    ctx.fillRect(0, 0, W, H);

    // Subtle starry sky specks
    ctx.save();
    let sSeed = 7731;
    for (let i = 0; i < 65; i += 1) {
      sSeed = (sSeed * 16807) % 2147483647;
      const sx = (sSeed / 2147483647) * W;
      sSeed = (sSeed * 16807) % 2147483647;
      const sy = (sSeed / 2147483647) * (H * 0.65);
      sSeed = (sSeed * 16807) % 2147483647;
      const r = 1.2 + (sSeed / 2147483647) * 2.4;
      ctx.fillStyle = `rgba(220, 236, 255, ${0.14 + (i % 4) * 0.08})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Subtle decorative crescent silhouette in top-right sky
    drawMeluneGlyph(ctx, W - 260, 56, 220, 'rgba(204, 224, 255, 0.08)');

    // Floating square album art
    const artSize = 420;
    const artX = (W - artSize) / 2;
    const artY = 160;
    ctx.save();
    ctx.shadowColor = 'rgba(4, 9, 34, 0.62)';
    ctx.shadowBlur = 64;
    ctx.shadowOffsetY = 26;
    drawRoundedRect(ctx, artX, artY, artSize, artSize, 42);
    ctx.fillStyle = '#121d48';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, artX, artY, artSize, artSize, 42);
    ctx.clip();
    drawCoverImage(ctx, coverImg, artX, artY, artSize, artSize);
    ctx.restore();

    textAlign = 'center';
    textPadX = 112;
    maxTextW = W - textPadX * 2;
    textStartY = 678;
    quoteAccent = 'rgba(176, 212, 255, 0.35)';
  }

  // ==================== 2. TYPOGRAPHY & LYRICS BLOCK ====================
  let cursorY = textStartY;
  const anchorX = textAlign === 'center' ? W / 2 : textPadX;

  if (options.theme !== 'cinema') {
    ctx.save();
    ctx.fillStyle = quoteAccent;
    ctx.font = '700 94px Georgia, serif';
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'top';
    ctx.fillText('“', textAlign === 'center' ? W / 2 : textPadX - 8, cursorY - 62);
    ctx.restore();
  }

  const mainFontSize = quoteItems.length >= 4 ? 42 : 46;
  const mainLineHeight = mainFontSize + 20;
  const maxFooterLimitY = 1230;

  for (const item of quoteItems) {
    ctx.fillStyle = mainTextColor;
    ctx.font = `700 ${mainFontSize}px ${fontStack}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'top';

    const wrappedMain = wrapLines(ctx, item.text, maxTextW);
    for (const line of wrappedMain) {
      if (cursorY > maxFooterLimitY) break;
      ctx.fillText(line, anchorX, cursorY);
      cursorY += mainLineHeight;
    }

    if (options.showTranslation && item.translation && cursorY <= maxFooterLimitY) {
      ctx.fillStyle = subTextColor;
      ctx.font = `500 28px ${fontStack}`;
      const wrappedSub = wrapLines(ctx, item.translation, maxTextW);
      for (const sLine of wrappedSub) {
        if (cursorY > maxFooterLimitY) break;
        ctx.fillText(sLine, anchorX, cursorY - 4);
        cursorY += 40;
      }
    }
    cursorY += 18;
  }

  // ==================== 3. FOOTER META & REAL MELUNE CRESCENT WATERMARK ====================
  const footerPad = options.theme === 'glass' ? 116 : 96;
  const footerY = 1290;

  ctx.strokeStyle = isLight ? 'rgba(28, 27, 24, 0.12)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(footerPad, footerY);
  ctx.lineTo(W - footerPad, footerY);
  ctx.stroke();

  // Left: Song Title + Artist (+ Date stamp for themes without top date stamp)
  const leftMaxW = W - footerPad * 2 - 340;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = isLight ? '#1c1b18' : '#ffffff';
  ctx.font = `700 34px ${fontStack}`;
  ctx.fillText(truncateText(ctx, options.title, leftMaxW), footerPad, footerY + 34);

  ctx.fillStyle = isLight ? '#6f6b63' : 'rgba(255, 255, 255, 0.68)';
  ctx.font = `500 25px ${fontStack}`;
  const artistMeta =
    options.showDateStamp && options.theme !== 'polaroid' && options.theme !== 'cinema'
      ? `${options.artist} · ${dateStamp}`
      : options.artist;
  ctx.fillText(truncateText(ctx, artistMeta, leftMaxW), footerPad, footerY + 84);

  // Right: Real MELUNE Vector Crescent-Note Badge + Brand Name + Slogan
  const badgeSize = 68;
  const badgeX = W - footerPad - badgeSize;
  const badgeY = footerY + 42;
  drawMeluneBadge(ctx, badgeX, badgeY, badgeSize);

  ctx.textAlign = 'right';
  ctx.fillStyle = isLight ? '#1c1b18' : 'rgba(255, 255, 255, 0.92)';
  ctx.font = `700 25px ${fontStack}`;
  ctx.fillText(options.brandName, badgeX - 18, badgeY + 10);

  ctx.fillStyle = isLight ? '#8b857b' : 'rgba(255, 255, 255, 0.56)';
  ctx.font = `500 18px ${fontStack}`;
  ctx.fillText(truncateText(ctx, options.brandSlogan, 330), badgeX - 18, badgeY + 42);

  return canvas.toDataURL('image/png');
}
