export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HeroFlipPlan {
  dx: number;
  dy: number;
  startScaleX: number;
  startScaleY: number;
  endScale: number;
  fromTransform: string;
  toTransform: string;
  fromBorderRadius: string;
  toBorderRadius: string;
}

export const HERO_MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Computes exact GPU FLIP transform + inverse-scaled border-radius keyframes so a shared element
 * (e.g. album artwork) flies pixel-accurately from `fromRect` into `toRect`, even when the
 * target element rests at a non-1 scale (such as the paused 0.84 cover artwork).
 */
export function computeHeroFlipTransform(
  fromRect: BoxRect,
  toRect: BoxRect,
  options: {
    fromRadiusPx: number;
    toRadiusPx: number;
    targetRestScale?: number;
  },
): HeroFlipPlan | null {
  if (
    !Number.isFinite(fromRect.width) ||
    !Number.isFinite(fromRect.height) ||
    !Number.isFinite(toRect.width) ||
    !Number.isFinite(toRect.height) ||
    fromRect.width < 4 ||
    fromRect.height < 4 ||
    toRect.width < 4 ||
    toRect.height < 4
  ) {
    return null;
  }

  const endScale =
    options.targetRestScale && Number.isFinite(options.targetRestScale) && options.targetRestScale > 0
      ? options.targetRestScale
      : 1;

  const fromCx = fromRect.left + fromRect.width / 2;
  const fromCy = fromRect.top + fromRect.height / 2;
  const toCx = toRect.left + toRect.width / 2;
  const toCy = toRect.top + toRect.height / 2;

  const dx = Number((fromCx - toCx).toFixed(2));
  const dy = Number((fromCy - toCy).toFixed(2));
  const startScaleX = Number(((fromRect.width / toRect.width) * endScale).toFixed(4));
  const startScaleY = Number(((fromRect.height / toRect.height) * endScale).toFixed(4));

  const avgStartScale = Math.max(0.08, (startScaleX + startScaleY) / 2);
  const compensatedFromRadius = Number(Math.min(180, options.fromRadiusPx / avgStartScale).toFixed(2));

  return {
    dx,
    dy,
    startScaleX,
    startScaleY,
    endScale,
    fromTransform: `translate3d(${dx}px, ${dy}px, 0) scale3d(${startScaleX}, ${startScaleY}, 1)`,
    toTransform: `translate3d(0, 0, 0) scale3d(${endScale}, ${endScale}, 1)`,
    fromBorderRadius: `${compensatedFromRadius}px`,
    toBorderRadius: `${options.toRadiusPx}px`,
  };
}

/**
 * Computes a gentle text-block FLIP translation (without distortion scaling) so song title & artist
 * glide naturally alongside the flying album artwork.
 */
export function computeMetaGlideTransform(
  fromRect: BoxRect,
  toRect: BoxRect,
): { dx: number; dy: number; fromTransform: string; toTransform: string } | null {
  if (fromRect.width < 4 || toRect.width < 4) return null;
  const dx = Number((fromRect.left - toRect.left).toFixed(2));
  const dy = Number((fromRect.top - toRect.top).toFixed(2));
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return {
    dx,
    dy,
    fromTransform: `translate3d(${dx}px, ${dy}px, 0)`,
    toTransform: 'translate3d(0, 0, 0)',
  };
}

export interface QueueWindowSlice {
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevCount: number;
  nextCount: number;
}

/**
 * Computes a bounded render window around `currentIndex` so opening Up Next on a 1,500+ song
 * playlist renders ~60 DOM rows instead of 7,000+ nodes during transition frame 1.
 */
export function computeQueueWindow(
  total: number,
  currentIndex: number,
  before = 15,
  after = 45,
): QueueWindowSlice {
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal === 0) {
    return { start: 0, end: 0, hasPrev: false, hasNext: false, prevCount: 0, nextCount: 0 };
  }
  const safeCur = Math.max(0, Math.min(safeTotal - 1, Math.floor(currentIndex)));
  const start = Math.max(0, safeCur - Math.max(0, before));
  const end = Math.min(safeTotal, safeCur + Math.max(1, after) + 1);
  return {
    start,
    end,
    hasPrev: start > 0,
    hasNext: end < safeTotal,
    prevCount: start,
    nextCount: Math.max(0, safeTotal - end),
  };
}
