/**
 * Pure monotonic lyric clock & karaoke syllable sweep helpers.
 * Prevents ExoPlayer 250ms IPC callback jitter from jumping lyric time backwards
 * and causing word/line flickering during playback.
 */

export function advanceMonotonicLyricTime(
  prevMs: number,
  rawMs: number,
  isPlaying: boolean,
): number {
  const safeRaw = Math.max(0, Number.isFinite(rawMs) ? rawMs : 0);
  if (!isPlaying || prevMs < 0) return safeRaw;
  if (safeRaw >= prevMs) return safeRaw;
  // Hold steady against tiny backward IPC phase jitter (< 450ms); allow real seeks / restarts
  if (prevMs - safeRaw < 450) return prevMs;
  return safeRaw;
}

export function findActiveLyricIndex(
  lines: readonly { startMs: number }[],
  timeMs: number,
  lookaheadMs = 90,
): number {
  if (!lines.length) return -1;
  const t = timeMs + lookaheadMs;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Computes CSS `background-position-x` percentage for a fixed 220%-wide gradient mask:
 * - 100% = completely unsung (dim translucent white)
 * - 50%  = halfway sung (soft feathered edge at center)
 * - 0%   = completely sung (pure crisp #ffffff, never tearing down the gradient layer!)
 */
export function computeWordSweepPosPercent(
  word: { startMs: number; durationMs: number },
  timeMs: number,
): number {
  if (timeMs <= word.startMs) return 100;
  const dur = Math.max(1, word.durationMs);
  if (timeMs >= word.startMs + dur) return 0;
  const progress = (timeMs - word.startMs) / dur;
  return Math.max(0, Math.min(100, (1 - progress) * 100));
}

/**
 * Zero-SaveLayer solid-glyph luminance progression for Android WebView 120Hz karaoke lyrics.
 * Eliminates `-webkit-background-clip: text` offscreen alpha-mask tile eviction & flickering.
 * Returns alpha in `[minAlpha .. 1.0]`.
 */
export function computeWordLuminanceAlpha(
  word: { startMs: number; durationMs: number },
  timeMs: number,
  minAlpha = 0.34,
): number {
  if (timeMs <= word.startMs) return minAlpha;
  const dur = Math.max(1, word.durationMs);
  if (timeMs >= word.startMs + dur) return 1;
  const progress = Math.max(0, Math.min(1, (timeMs - word.startMs) / dur));
  // Smooth ease-out curve for crisp syllable illumination
  const eased = 1 - (1 - progress) * (1 - progress);
  return Number((minAlpha + eased * (1 - minAlpha)).toFixed(3));
}

export function quantizeWordAlphaStep(alpha: number, steps = 16, minAlpha = 0.34): number {
  const norm = Math.max(0, Math.min(1, (alpha - minAlpha) / Math.max(0.01, 1 - minAlpha)));
  return Math.round(norm * steps);
}
