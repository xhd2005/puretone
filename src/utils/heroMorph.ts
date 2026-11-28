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

export interface SharedArtworkTransformResult {
  dx: number;
  dy: number;
  scale: number;
  transform: string;
}

/**
 * Computes the exact pure-GPU `transform` for the single persistent `.np-shared-artwork`
 * element positioned over `coverSlot`, flying seamlessly into `miniSlot` in lyrics/queue modes
 * without ever hiding or swapping DOM nodes (eliminating mode-switch flicker completely).
 */
export function computeSharedArtworkTransform(
  coverSlot: BoxRect,
  miniSlot: BoxRect,
  options: {
    mode: 'cover' | 'lyrics' | 'queue';
    isPlaying: boolean;
    swipeX?: number;
  },
): SharedArtworkTransformResult {
  const swipeX = Number(options.swipeX || 0);

  if (options.mode === 'cover') {
    if (Math.abs(swipeX) > 0.5) {
      const tilt = Math.max(-5, Math.min(5, swipeX * 0.032));
      return {
        dx: Number(swipeX.toFixed(2)),
        dy: 0,
        scale: 0.95,
        transform: `translate3d(${swipeX.toFixed(2)}px, 0, 0) rotate(${tilt.toFixed(2)}deg) scale3d(0.95, 0.95, 1)`,
      };
    }
    const scale = options.isPlaying ? 1 : 0.84;
    return {
      dx: 0,
      dy: 0,
      scale,
      transform: `translate3d(0, 0, 0) scale3d(${scale}, ${scale}, 1)`,
    };
  }

  const coverW = Math.max(1, coverSlot.width);
  const miniW = Math.max(1, miniSlot.width);
  const dx = Number((miniSlot.left + miniW / 2 - (coverSlot.left + coverW / 2)).toFixed(2));
  const dy = Number((miniSlot.top + miniSlot.height / 2 - (coverSlot.top + coverSlot.height / 2)).toFixed(2));
  const scale = Number((miniW / coverW).toFixed(4));

  return {
    dx,
    dy,
    scale,
    transform: `translate3d(${dx}px, ${dy}px, 0) scale3d(${scale}, ${scale}, 1)`,
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

export interface CoverCarouselCardStyle {
  transform: string;
  opacity: number;
}

export interface CoverCarouselLayout {
  prev: CoverCarouselCardStyle;
  current: CoverCarouselCardStyle;
  next: CoverCarouselCardStyle;
}

/**
 * Computes synchronized 3-card GPU transforms for interactive horizontal album artwork swiping.
 * Adjacent prev/next cards glide into view with subtle 3D depth tilt and grow cleanly to full
 * scale as the finger drags across `stridePx`, eliminating snap-back stutter completely.
 */
export function computeCoverCarouselLayout(
  swipeX: number,
  stridePx: number,
  baseScale = 1,
): CoverCarouselLayout {
  const safeStride = Math.max(120, Number(stridePx) || 320);
  const clampedX = Math.max(-safeStride * 1.15, Math.min(safeStride * 1.15, Number(swipeX) || 0));
  const p = clampedX / safeStride; // -1 (next) .. 0 (center) .. +1 (prev)
  const absP = Math.abs(p);

  const curScale = Number((baseScale - Math.min(0.11, absP * 0.12)).toFixed(4));
  const curRotY = Number(Math.max(-14, Math.min(14, -p * 12)).toFixed(2));
  const curOpacity = Number(Math.max(0.62, 1 - absP * 0.34).toFixed(3));

  const nextFocus = Math.max(0, Math.min(1, -p));
  const nextTx = safeStride + clampedX;
  const nextScale = Number((0.84 + nextFocus * (baseScale - 0.84)).toFixed(4));
  const nextRotY = Number(((1 - nextFocus) * 14).toFixed(2));
  const nextOpacity = Number((0.40 + nextFocus * 0.60).toFixed(3));

  const prevFocus = Math.max(0, Math.min(1, p));
  const prevTx = -safeStride + clampedX;
  const prevScale = Number((0.84 + prevFocus * (baseScale - 0.84)).toFixed(4));
  const prevRotY = Number((-(1 - prevFocus) * 14).toFixed(2));
  const prevOpacity = Number((0.40 + prevFocus * 0.60).toFixed(3));

  return {
    prev: {
      transform: `perspective(1000px) translate3d(${prevTx.toFixed(2)}px, 0, 0) rotateY(${prevRotY}deg) scale3d(${prevScale}, ${prevScale}, 1)`,
      opacity: prevOpacity,
    },
    current: {
      transform: `perspective(1000px) translate3d(${clampedX.toFixed(2)}px, 0, 0) rotateY(${curRotY}deg) scale3d(${curScale}, ${curScale}, 1)`,
      opacity: curOpacity,
    },
    next: {
      transform: `perspective(1000px) translate3d(${nextTx.toFixed(2)}px, 0, 0) rotateY(${nextRotY}deg) scale3d(${nextScale}, ${nextScale}, 1)`,
      opacity: nextOpacity,
    },
  };
}

export interface CoverFlowCardTransform {
  tx: number;
  tz: number;
  rotateY: number;
  scale: number;
  opacity: number;
  zIndex: number;
  transform: string;
}

/**
 * Classic 3D Cover Flow perspective geometry for landscape album browsing.
 * `offset = cardIndex - activeFloatIndex` (0 = center focused hero card).
 */
export function computeCoverFlowCardTransform(
  offset: number,
  cardSizePx = 186,
): CoverFlowCardTransform {
  const safeSize = Math.max(100, Number(cardSizePx) || 186);
  const absOff = Math.abs(offset);
  const sign = offset === 0 ? 0 : offset > 0 ? 1 : -1;

  let tx: number;
  let tz: number;
  let rotateY: number;
  let scale: number;

  if (absOff <= 1) {
    tx = offset * safeSize * 0.72;
    tz = (1 - absOff) * 68 - absOff * 36;
    rotateY = -offset * 52;
    scale = 1 - absOff * 0.18;
  } else {
    const extra = absOff - 1;
    tx = sign * (safeSize * 0.72 + extra * safeSize * 0.34);
    tz = -36 - extra * 24;
    rotateY = -sign * Math.min(60, 52 + extra * 3);
    scale = Math.max(0.62, 0.82 - extra * 0.055);
  }

  const opacity = absOff <= 2.6 ? 1 : Math.max(0, 1 - (absOff - 2.6) * 0.65);
  const zIndex = Math.max(1, Math.round(50 - absOff * 10));

  const txFixed = Number(tx.toFixed(2));
  const tzFixed = Number(tz.toFixed(2));
  const rotFixed = Number(rotateY.toFixed(2));
  const scaleFixed = Number(scale.toFixed(4));
  const opacityFixed = Number(opacity.toFixed(3));

  return {
    tx: txFixed,
    tz: tzFixed,
    rotateY: rotFixed,
    scale: scaleFixed,
    opacity: opacityFixed,
    zIndex,
    transform: `perspective(1100px) translate3d(${txFixed}px, 0, ${tzFixed}px) rotateY(${rotFixed}deg) scale3d(${scaleFixed}, ${scaleFixed}, 1)`,
  };
}

export type RingSlotId = 0 | 1 | 2;
export type RingSlotRole = 'prev' | 'center' | 'next';

export interface RingSlotAssignment {
  prev: RingSlotId;
  center: RingSlotId;
  next: RingSlotId;
}

/**
 * Maps a logical center slot id (`0 | 1 | 2`) to its physical 3-slot ring assignment.
 * Rotating the ring on swipe commit leaves the landed card physically untouched at `tx = 0`,
 * making opposite-direction rebound animations mathematically impossible.
 */
export function getRingSlotAssignment(centerId: RingSlotId): RingSlotAssignment {
  const prev = ((centerId + 2) % 3) as RingSlotId;
  const next = ((centerId + 1) % 3) as RingSlotId;
  return { prev, center: centerId, next };
}

export function rotateRingCenter(centerId: RingSlotId, direction: 'next' | 'prev'): RingSlotId {
  return (direction === 'next' ? (centerId + 1) % 3 : (centerId + 2) % 3) as RingSlotId;
}

export interface SpringStepResult {
  position: number;
  velocity: number;
  settled: boolean;
}

/**
 * Frame-rate-independent critically-damped implicit spring integrator (60Hz / 90Hz / 120Hz / 144Hz).
 */
export function stepCriticallyDampedSpring(
  position: number,
  target: number,
  velocity: number,
  dtSec: number,
  omega = 16,
  epsilonPos = 0.45,
  epsilonVel = 8,
): SpringStepResult {
  const dt = Math.max(0.001, Math.min(0.05, dtSec));
  const x = position - target;
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const nextX = (f * x + dt * velocity) * detInv;
  const nextVel = (velocity - hoo * x) * detInv;
  if (Math.abs(nextX) <= epsilonPos && Math.abs(nextVel) <= epsilonVel) {
    return { position: target, velocity: 0, settled: true };
  }
  return { position: target + nextX, velocity: nextVel, settled: false };
}
