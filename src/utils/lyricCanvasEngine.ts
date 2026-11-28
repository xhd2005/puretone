import type { LyricLine } from '@/types/music';
import type { LyricFontSize, LyricRenderMode } from '@/stores/settings';

export interface CanvasLyricToken {
  text: string;
  x: number;
  width: number;
  startMs: number;
  durationMs: number;
}

export interface CanvasWrappedRow {
  text: string;
  x: number;
  y: number; // relative to line top
  width: number;
  lineHeight: number;
  tokens: CanvasLyricToken[];
}

export interface CanvasLyricLineLayout {
  index: number;
  startMs: number;
  y: number;
  height: number;
  centerY: number;
  mainRows: CanvasWrappedRow[];
  transRows: CanvasWrappedRow[];
  hasWords: boolean;
}

export interface CanvasLyricMetrics {
  mainFontSize: number;
  mainLineHeight: number;
  mainFont: string;
  transFontSize: number;
  transLineHeight: number;
  transFont: string;
  transGap: number;
  lineGap: number;
  padX: number;
  topPadding: number;
  bottomPadding: number;
  anchorRatio: number;
}

export interface CanvasLyricDocumentLayout {
  lines: CanvasLyricLineLayout[];
  totalHeight: number;
  metrics: CanvasLyricMetrics;
}

export type TextWidthMeasurer = (text: string, font: string) => number;

const SYSTEM_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

export function resolveCanvasLyricMetrics(options: {
  fontSize: LyricFontSize;
  compact?: boolean;
  centered?: boolean;
  viewportHeight: number;
}): CanvasLyricMetrics {
  const vh = Math.max(240, options.viewportHeight || 640);
  let mainFontSize = 25;
  let transFontSize = 14.5;

  if (options.compact) {
    mainFontSize = options.fontSize === 'xlarge' ? 25 : options.fontSize === 'large' ? 22.5 : 20;
    transFontSize = options.fontSize === 'xlarge' ? 14 : options.fontSize === 'large' ? 13.5 : 12.5;
  } else if (options.centered) {
    const base = Math.max(22, Math.min(34, Math.round(vh * 0.058)));
    mainFontSize = options.fontSize === 'xlarge' ? base + 4 : options.fontSize === 'large' ? base + 2 : base;
    transFontSize = Math.max(13, Math.round(mainFontSize * 0.56));
  } else {
    mainFontSize = options.fontSize === 'xlarge' ? 32 : options.fontSize === 'large' ? 28 : 24.5;
    transFontSize = options.fontSize === 'xlarge' ? 17 : options.fontSize === 'large' ? 15.5 : 14;
  }

  const mainLineHeight = Math.round(mainFontSize * 1.32);
  const transLineHeight = Math.round(transFontSize * 1.42);
  const lineGap = options.compact ? 20 : 28;
  const padX = options.compact ? 18 : options.centered ? 32 : 26;
  const anchorRatio = options.centered ? 0.42 : options.compact ? 0.38 : 0.32;

  return {
    mainFontSize,
    mainLineHeight,
    mainFont: `700 ${mainFontSize}px ${SYSTEM_FONT_FAMILY}`,
    transFontSize,
    transLineHeight,
    transFont: `500 ${transFontSize}px ${SYSTEM_FONT_FAMILY}`,
    transGap: 6,
    lineGap,
    padX,
    topPadding: Math.round(vh * anchorRatio),
    bottomPadding: Math.round(vh * 0.52),
    anchorRatio,
  };
}

function tokenizePlainText(text: string): string[] {
  if (!text) return [];
  return text.match(/[A-Za-z0-9'’-]+|\s+|./gu) || [text];
}

function wrapTokensToRows(
  rawTokens: Array<{ text: string; startMs: number; durationMs: number }>,
  maxWidth: number,
  font: string,
  lineHeight: number,
  padX: number,
  centered: boolean,
  viewportWidth: number,
  measure: TextWidthMeasurer,
): CanvasWrappedRow[] {
  const safeMaxW = Math.max(80, maxWidth);
  const rows: Array<{ tokens: Array<{ text: string; width: number; startMs: number; durationMs: number }>; width: number }> = [];
  let curTokens: Array<{ text: string; width: number; startMs: number; durationMs: number }> = [];
  let curWidth = 0;

  const flushRow = () => {
    if (!curTokens.length) return;
    // Trim trailing whitespace width on wrapped line ends
    while (curTokens.length > 1 && /^\s+$/.test(curTokens[curTokens.length - 1].text)) {
      const popped = curTokens.pop()!;
      curWidth = Math.max(0, curWidth - popped.width);
    }
    rows.push({ tokens: curTokens, width: curWidth });
    curTokens = [];
    curWidth = 0;
  };

  for (const tok of rawTokens) {
    if (!tok.text) continue;
    const isSpace = /^\s+$/.test(tok.text);
    if (isSpace && curTokens.length === 0) continue;

    const tokW = measure(tok.text, font);

    // If a single token itself exceeds maxWidth, split by character proportionally
    if (tokW > safeMaxW && tok.text.length > 1) {
      if (curTokens.length > 0) flushRow();
      const chars = Array.from(tok.text);
      const perCharDur = tok.durationMs / Math.max(1, chars.length);
      for (let ci = 0; ci < chars.length; ci += 1) {
        const ch = chars[ci];
        const cw = measure(ch, font);
        if (curWidth + cw > safeMaxW && curTokens.length > 0) {
          flushRow();
        }
        curTokens.push({
          text: ch,
          width: cw,
          startMs: tok.startMs + Math.round(ci * perCharDur),
          durationMs: Math.max(1, Math.round(perCharDur)),
        });
        curWidth += cw;
      }
      continue;
    }

    if (curWidth + tokW > safeMaxW && curTokens.length > 0) {
      flushRow();
      if (isSpace) continue;
    }

    curTokens.push({
      text: tok.text,
      width: tokW,
      startMs: tok.startMs,
      durationMs: tok.durationMs,
    });
    curWidth += tokW;
  }

  flushRow();

  return rows.map((r, rIdx) => {
    const startX = centered ? Math.max(padX, (viewportWidth - r.width) / 2) : padX;
    let cursorX = startX;
    const positioned: CanvasLyricToken[] = r.tokens.map((t) => {
      const item: CanvasLyricToken = {
        text: t.text,
        x: cursorX,
        width: t.width,
        startMs: t.startMs,
        durationMs: t.durationMs,
      };
      cursorX += t.width;
      return item;
    });
    return {
      text: positioned.map((t) => t.text).join(''),
      x: startX,
      y: rIdx * lineHeight,
      width: r.width,
      lineHeight,
      tokens: positioned,
    };
  });
}

export function layoutLyricLines(
  lines: readonly LyricLine[],
  options: {
    viewportWidth: number;
    viewportHeight: number;
    fontSize: LyricFontSize;
    showTranslation: boolean;
    compact?: boolean;
    centered?: boolean;
  },
  measure: TextWidthMeasurer,
): CanvasLyricDocumentLayout {
  const metrics = resolveCanvasLyricMetrics(options);
  const maxWidth = Math.max(100, options.viewportWidth - metrics.padX * 2);
  const centered = Boolean(options.centered);
  const laidOut: CanvasLyricLineLayout[] = [];
  let cursorY = metrics.topPadding;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasWords = Boolean(line.words && line.words.length > 0);
    const mainRawTokens = hasWords
      ? line.words!.map((w) => ({ text: w.text, startMs: w.startMs, durationMs: w.durationMs }))
      : tokenizePlainText(line.text).map((text) => ({ text, startMs: line.startMs, durationMs: 0 }));

    const mainRows = wrapTokensToRows(
      mainRawTokens,
      maxWidth,
      metrics.mainFont,
      metrics.mainLineHeight,
      metrics.padX,
      centered,
      options.viewportWidth,
      measure,
    );

    const mainHeight = Math.max(metrics.mainLineHeight, mainRows.length * metrics.mainLineHeight);
    let transRows: CanvasWrappedRow[] = [];
    let transHeight = 0;

    if (options.showTranslation && line.translation?.trim()) {
      const transTokens = tokenizePlainText(line.translation.trim()).map((text) => ({
        text,
        startMs: line.startMs,
        durationMs: 0,
      }));
      transRows = wrapTokensToRows(
        transTokens,
        maxWidth,
        metrics.transFont,
        metrics.transLineHeight,
        metrics.padX,
        centered,
        options.viewportWidth,
        measure,
      );
      transHeight = transRows.length > 0 ? metrics.transGap + transRows.length * metrics.transLineHeight : 0;
    }

    const totalLineHeight = mainHeight + transHeight;
    laidOut.push({
      index: i,
      startMs: line.startMs,
      y: cursorY,
      height: totalLineHeight,
      centerY: cursorY + mainHeight * 0.5,
      mainRows,
      transRows,
      hasWords,
    });

    cursorY += totalLineHeight + metrics.lineGap;
  }

  return {
    lines: laidOut,
    totalHeight: cursorY + metrics.bottomPadding,
    metrics,
  };
}

/**
 * Computes the horizontal lit pixel width from `row.x` for smooth left-to-right karaoke fill.
 */
export function computeRowKaraokeSweepWidth(row: CanvasWrappedRow, nowMs: number): number {
  if (!row.tokens.length) return 0;
  let litEnd = row.x;
  for (let i = 0; i < row.tokens.length; i += 1) {
    const tok = row.tokens[i];
    const dur = Math.max(1, tok.durationMs);
    if (nowMs >= tok.startMs + dur) {
      litEnd = tok.x + tok.width;
    } else if (nowMs > tok.startMs) {
      const progress = Math.max(0, Math.min(1, (nowMs - tok.startMs) / dur));
      litEnd = tok.x + tok.width * progress;
      break;
    } else {
      break;
    }
  }
  return Math.max(0, Math.min(row.width, litEnd - row.x));
}

export function getTargetLineAlpha(index: number, activeIndex: number, userScrolling: boolean): number {
  if (index === activeIndex) return 1;
  if (userScrolling) return 0.72;
  const diff = Math.abs(index - activeIndex);
  if (diff === 1) return 0.48;
  if (diff === 2) return 0.28;
  return 0.16;
}

/**
 * Smoothly converges per-line opacities so line transitions NEVER produce a 1-frame dark flash.
 * Returns `true` if any line opacity is still converging.
 */
export function stepLineAlphas(
  alphas: Float32Array,
  activeIndex: number,
  userScrolling: boolean,
  dtSec: number,
  snap = false,
): boolean {
  const blend = snap ? 1 : 1 - Math.exp(-10.5 * Math.max(0.001, Math.min(0.05, dtSec)));
  let moving = false;
  for (let i = 0; i < alphas.length; i += 1) {
    const target = getTargetLineAlpha(i, activeIndex, userScrolling);
    const cur = alphas[i];
    const diff = target - cur;
    if (snap || Math.abs(diff) < 0.004) {
      alphas[i] = target;
    } else {
      alphas[i] = cur + diff * blend;
      moving = true;
    }
  }
  return moving;
}

/**
 * Hit-tests a document-space Y coordinate (`tapY + scrollY`) against laid-out lyric lines.
 */
export function hitTestLyricLine(
  doc: CanvasLyricDocumentLayout,
  docY: number,
  hitPaddingY = 10,
): CanvasLyricLineLayout | null {
  for (let i = 0; i < doc.lines.length; i += 1) {
    const line = doc.lines[i];
    if (docY >= line.y - hitPaddingY && docY <= line.y + line.height + hitPaddingY) {
      return line;
    }
  }
  return null;
}

export function computeDesiredScrollY(
  doc: CanvasLyricDocumentLayout,
  activeIndex: number,
  viewportHeight: number,
): number {
  const maxScroll = Math.max(0, doc.totalHeight - viewportHeight);
  if (activeIndex < 0 || activeIndex >= doc.lines.length) {
    return 0;
  }
  const line = doc.lines[activeIndex];
  const anchorY = viewportHeight * doc.metrics.anchorRatio;
  return Math.max(0, Math.min(maxScroll, line.y - anchorY));
}

export interface CanvasRenderParams {
  ctx: CanvasRenderingContext2D;
  doc: CanvasLyricDocumentLayout;
  viewportWidth: number;
  viewportHeight: number;
  scrollY: number;
  activeIndex: number;
  nowMs: number;
  alphas: Float32Array;
  renderMode: LyricRenderMode;
  edgeMaskGradient?: CanvasGradient | null;
}

/**
 * Single-pass hardware 2D Canvas lyric renderer:
 * - Zero DOM mutations per frame, zero CSS scale glyph re-rasterization, zero Skia layer thrash.
 * - True left-to-right horizontal clip sweep for KRC word-by-word karaoke.
 * - Built-in soft vertical fade edges via single destination-in pass.
 */
export function renderLyricCanvas(params: CanvasRenderParams): void {
  const { ctx, doc, viewportWidth, viewportHeight, scrollY, activeIndex, nowMs, alphas, renderMode } = params;
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  if (!doc.lines.length) return;

  const { metrics } = doc;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  const cullTop = scrollY - 96;
  const cullBottom = scrollY + viewportHeight + 96;

  for (let i = 0; i < doc.lines.length; i += 1) {
    const line = doc.lines[i];
    if (line.y + line.height < cullTop) continue;
    if (line.y > cullBottom) break;

    const screenY = line.y - scrollY;
    const isActive = i === activeIndex;
    const baseAlpha = i < alphas.length ? alphas[i] : getTargetLineAlpha(i, activeIndex, false);
    const useKaraoke = renderMode === 'karaoke' && isActive && line.hasWords;

    ctx.font = metrics.mainFont;

    if (useKaraoke) {
      // Pass 1: Soft translucent base text for unsung syllables
      const unsungAlpha = Math.max(0.28, baseAlpha * 0.36);
      ctx.fillStyle = `rgba(255, 255, 255, ${unsungAlpha.toFixed(3)})`;
      for (let r = 0; r < line.mainRows.length; r += 1) {
        const row = line.mainRows[r];
        ctx.fillText(row.text, row.x, screenY + row.y);
      }

      // Pass 2: Pure crisp #ffffff left-to-right clipped sweep per wrapped row
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, baseAlpha).toFixed(3)})`;
      for (let r = 0; r < line.mainRows.length; r += 1) {
        const row = line.mainRows[r];
        const sweepW = computeRowKaraokeSweepWidth(row, nowMs);
        if (sweepW <= 0.25) continue;
        if (sweepW >= row.width - 0.25) {
          ctx.fillText(row.text, row.x, screenY + row.y);
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.rect(row.x - 1, screenY + row.y - 4, sweepW + 1, row.lineHeight + 8);
          ctx.clip();
          ctx.fillText(row.text, row.x, screenY + row.y);
          ctx.restore();
        }
      }
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${baseAlpha.toFixed(3)})`;
      for (let r = 0; r < line.mainRows.length; r += 1) {
        const row = line.mainRows[r];
        ctx.fillText(row.text, row.x, screenY + row.y);
      }
    }

    if (line.transRows.length > 0) {
      const transOffsetY = Math.max(metrics.mainLineHeight, line.mainRows.length * metrics.mainLineHeight) + metrics.transGap;
      const transAlpha = Math.max(0.10, baseAlpha * (isActive ? 0.78 : 0.72));
      ctx.font = metrics.transFont;
      ctx.fillStyle = `rgba(255, 255, 255, ${transAlpha.toFixed(3)})`;
      for (let r = 0; r < line.transRows.length; r += 1) {
        const row = line.transRows[r];
        ctx.fillText(row.text, row.x, screenY + transOffsetY + row.y);
      }
    }
  }

  // Soft Apple Music top/bottom feathered fade right inside the single Canvas (zero CSS mask flicker!)
  if (params.edgeMaskGradient) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = params.edgeMaskGradient;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
    ctx.restore();
  }
}
