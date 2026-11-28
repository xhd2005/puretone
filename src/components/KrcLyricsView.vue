<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import { advanceMonotonicLyricTime, findActiveLyricIndex } from '@/utils/lyricClock';
import {
  computeDesiredScrollY,
  hitTestLyricLine,
  layoutLyricLines,
  renderLyricCanvas,
  stepLineAlphas,
  type CanvasLyricDocumentLayout,
} from '@/utils/lyricCanvasEngine';

const props = withDefaults(
  defineProps<{
    active: boolean;
    centered?: boolean;
    compact?: boolean;
  }>(),
  {
    centered: false,
    compact: false,
  },
);

const emit = defineEmits<{
  userScroll: [];
  tapBlank: [];
  lineSeek: [];
}>();

const player = usePlayerStore();
const settings = useSettingsStore();
const { t } = useI18n();

const currentTrackOffsetKey = computed(() => {
  const s = player.currentSong;
  return s ? (s.hash ? s.hash.toLowerCase() : s.id) : '';
});
const lyricOffsetMs = computed(() => settings.getLyricOffset(currentTrackOffsetKey.value));

function getRawShiftedTimeMs(): number {
  return Math.max(0, player.getInterpolatedTimeMs() + lyricOffsetMs.value);
}

const viewportRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

// Zero-DOM-diff Canvas Engine State
let ctx2d: CanvasRenderingContext2D | null = null;
let edgeMaskGradient: CanvasGradient | null = null;
let viewportW = 0;
let viewportH = 0;
let dpr = 1;
let docLayout: CanvasLyricDocumentLayout | null = null;
let lineAlphas = new Float32Array(0);

let activeIndex = -1;
let displayTimeMs = -1;
let userScrolling = false;
let isTouching = false;
let scrollY = 0;

// 120Hz Critically-Damped Spring Scroller + Inertial Momentum
const SPRING_OMEGA = 10.5;
let springActive = false;
let springTargetY = 0;
let springVelocity = 0;
let inertiaVelocity = 0; // px/sec after touch release
let alphasConverging = false;

let rafId = 0;
let lastRafNow = 0;
let scrollResumeTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;

// Touch tracking
let touchStartY = 0;
let touchStartX = 0;
let lastTouchY = 0;
let lastTouchTime = 0;
let didScrollGesture = false;

// Measure cache to avoid redundant ctx.measureText calls during relayout
const measureCache = new Map<string, number>();
function measureTextWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  if (!ctx2d) return text.length * 14;
  if (ctx2d.font !== font) ctx2d.font = font;
  const w = ctx2d.measureText(text).width;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, w);
  return w;
}

function getMaxScrollY(): number {
  if (!docLayout) return 0;
  return Math.max(0, docLayout.totalHeight - viewportH);
}

function clampScrollY(y: number): number {
  return Math.max(0, Math.min(getMaxScrollY(), y));
}

function cancelMotion() {
  springActive = false;
  springVelocity = 0;
  inertiaVelocity = 0;
}

function rebuildEdgeMask() {
  if (!ctx2d || viewportH < 40) {
    edgeMaskGradient = null;
    return;
  }
  const grad = ctx2d.createLinearGradient(0, 0, 0, viewportH);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.09, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(0.86, 'rgba(0, 0, 0, 1)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  edgeMaskGradient = grad;
}

function rebuildLayout(snapToActive = false) {
  if (!canvasRef.value || viewportW < 40 || viewportH < 40) {
    docLayout = null;
    return;
  }
  if (!ctx2d) {
    ctx2d = canvasRef.value.getContext('2d', { alpha: true });
  }
  if (!ctx2d) return;

  const lines = player.lyrics.lines;
  docLayout = layoutLyricLines(
    lines,
    {
      viewportWidth: viewportW,
      viewportHeight: viewportH,
      fontSize: settings.lyricFontSize,
      showTranslation: settings.showTranslation,
      compact: props.compact,
      centered: props.centered,
    },
    measureTextWidth,
  );

  if (lineAlphas.length !== lines.length) {
    lineAlphas = new Float32Array(lines.length);
    stepLineAlphas(lineAlphas, activeIndex, userScrolling, 0.016, true);
  }

  if (snapToActive && !userScrolling) {
    scrollY = computeDesiredScrollY(docLayout, activeIndex, viewportH);
    springTargetY = scrollY;
    cancelMotion();
  } else {
    scrollY = clampScrollY(scrollY);
  }
}

function syncCanvasResolution(forceSnap = false) {
  const host = viewportRef.value;
  const canvas = canvasRef.value;
  if (!host || !canvas) return;

  const rect = host.getBoundingClientRect();
  const nextW = Math.round(rect.width);
  const nextH = Math.round(rect.height);
  if (nextW < 20 || nextH < 20) return;

  const nextDpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 3);
  const changed = nextW !== viewportW || nextH !== viewportH || nextDpr !== dpr;
  if (!changed && docLayout) return;

  viewportW = nextW;
  viewportH = nextH;
  dpr = nextDpr;

  canvas.width = Math.round(viewportW * dpr);
  canvas.height = Math.round(viewportH * dpr);
  canvas.style.width = `${viewportW}px`;
  canvas.style.height = `${viewportH}px`;

  ctx2d = canvas.getContext('2d', { alpha: true });
  if (ctx2d) {
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  rebuildEdgeMask();
  rebuildLayout(forceSnap || !userScrolling);
  drawNow();
}

function drawNow() {
  if (!ctx2d || !docLayout || viewportW < 20 || viewportH < 20) return;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderLyricCanvas({
    ctx: ctx2d,
    doc: docLayout,
    viewportWidth: viewportW,
    viewportHeight: viewportH,
    scrollY,
    activeIndex,
    nowMs: Math.max(0, displayTimeMs),
    alphas: lineAlphas,
    renderMode: settings.lyricRenderMode,
    edgeMaskGradient,
  });
}

function scrollToActive(smooth = true) {
  if (userScrolling || !docLayout || viewportH < 20) return;
  const target = computeDesiredScrollY(docLayout, activeIndex, viewportH);
  if (!smooth || !props.active) {
    cancelMotion();
    scrollY = target;
    springTargetY = target;
    drawNow();
    return;
  }
  inertiaVelocity = 0;
  springTargetY = target;
  if (Math.abs(scrollY - target) < 0.6) {
    scrollY = target;
    springActive = false;
    springVelocity = 0;
    drawNow();
    return;
  }
  springActive = true;
  ensureRafRunning();
}

function syncClock(forceSnap = false): boolean {
  const rawMs = getRawShiftedTimeMs();
  displayTimeMs = forceSnap ? rawMs : advanceMonotonicLyricTime(displayTimeMs, rawMs, player.isPlaying);
  const nextIdx = findActiveLyricIndex(player.lyrics.lines, displayTimeMs, 90);
  if (nextIdx !== activeIndex) {
    activeIndex = nextIdx;
    alphasConverging = true;
    scrollToActive(!forceSnap);
    return true;
  }
  return false;
}

function stepPhysics(dtSec: number) {
  const dt = Math.max(0.001, Math.min(0.05, dtSec));

  if (springActive && !userScrolling && !isTouching) {
    const x = scrollY - springTargetY;
    const f = 1 + 2 * dt * SPRING_OMEGA;
    const oo = SPRING_OMEGA * SPRING_OMEGA;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    const nextX = (f * x + dt * springVelocity) * detInv;
    springVelocity = (springVelocity - hoo * x) * detInv;
    scrollY = springTargetY + nextX;
    if (Math.abs(nextX) < 0.45 && Math.abs(springVelocity) < 8) {
      scrollY = springTargetY;
      springActive = false;
      springVelocity = 0;
    }
  } else if (!isTouching && Math.abs(inertiaVelocity) > 12) {
    scrollY += inertiaVelocity * dt;
    const maxY = getMaxScrollY();
    if (scrollY < 0) {
      scrollY = 0;
      inertiaVelocity = 0;
    } else if (scrollY > maxY) {
      scrollY = maxY;
      inertiaVelocity = 0;
    } else {
      inertiaVelocity *= Math.exp(-5.4 * dt);
      if (Math.abs(inertiaVelocity) <= 12) inertiaVelocity = 0;
    }
  }

  if (lineAlphas.length) {
    alphasConverging = stepLineAlphas(lineAlphas, activeIndex, userScrolling, dt, false);
  } else {
    alphasConverging = false;
  }
}

function needsRaf(): boolean {
  if (!props.active || !player.lyrics.lines.length) return false;
  const activeLineHasWords =
    activeIndex >= 0 && Boolean(player.lyrics.lines[activeIndex]?.words?.length);
  const needsLiveKaraoke =
    player.isPlaying && settings.lyricRenderMode === 'karaoke' && activeLineHasWords;
  return (
    needsLiveKaraoke ||
    player.isPlaying ||
    springActive ||
    Math.abs(inertiaVelocity) > 12 ||
    alphasConverging
  );
}

function stopRaf() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastRafNow = 0;
}

function tick(now: number) {
  if (!needsRaf()) {
    stopRaf();
    return;
  }
  const dtSec = lastRafNow > 0 ? (now - lastRafNow) / 1000 : 1 / 120;
  lastRafNow = now;

  let lineChanged = false;
  if (player.isPlaying) {
    lineChanged = syncClock(false);
  }
  const wasMoving = springActive || Math.abs(inertiaVelocity) > 12 || alphasConverging;
  stepPhysics(dtSec);
  const activeHasWords = activeIndex >= 0 && Boolean(player.lyrics.lines[activeIndex]?.words?.length);
  const needsLiveKaraoke = player.isPlaying && settings.lyricRenderMode === 'karaoke' && activeHasWords;
  if (needsLiveKaraoke || lineChanged || wasMoving || springActive || alphasConverging) {
    drawNow();
  }

  if (needsRaf()) {
    rafId = requestAnimationFrame(tick);
  } else {
    stopRaf();
  }
}

function ensureRafRunning() {
  if (rafId || !needsRaf()) return;
  lastRafNow = typeof performance !== 'undefined' ? performance.now() : 0;
  rafId = requestAnimationFrame(tick);
}

function snapToActiveNow() {
  userScrolling = false;
  if (scrollResumeTimer) {
    clearTimeout(scrollResumeTimer);
    scrollResumeTimer = null;
  }
  cancelMotion();
  displayTimeMs = -1;
  syncClock(true);
  void nextTick(() => {
    syncCanvasResolution(true);
    if (lineAlphas.length) {
      stepLineAlphas(lineAlphas, activeIndex, false, 0.016, true);
    }
    scrollToActive(false);
    drawNow();
    ensureRafRunning();
  });
}

function scheduleAutoResume() {
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  scrollResumeTimer = setTimeout(() => {
    scrollResumeTimer = null;
    userScrolling = false;
    alphasConverging = true;
    scrollToActive(true);
    ensureRafRunning();
  }, 3000);
}

function onTouchStart(e: TouchEvent) {
  const t0 = e.touches[0];
  if (!t0) return;
  isTouching = true;
  cancelMotion();
  touchStartY = t0.clientY;
  touchStartX = t0.clientX;
  lastTouchY = t0.clientY;
  lastTouchTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  didScrollGesture = false;
}

function onTouchMove(e: TouchEvent) {
  const t0 = e.touches[0];
  if (!t0 || !docLayout) return;
  const dyTotal = t0.clientY - touchStartY;
  const dxTotal = t0.clientX - touchStartX;
  if (!didScrollGesture && Math.abs(dyTotal) > 6 && Math.abs(dyTotal) >= Math.abs(dxTotal) * 0.75) {
    didScrollGesture = true;
    userScrolling = true;
    alphasConverging = true;
    emit('userScroll');
    scheduleAutoResume();
  }
  if (!didScrollGesture) return;

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dtMs = Math.max(4, now - lastTouchTime);
  const deltaY = lastTouchY - t0.clientY;
  lastTouchY = t0.clientY;
  lastTouchTime = now;

  const maxY = getMaxScrollY();
  let nextY = scrollY + deltaY;
  if (nextY < 0) nextY = scrollY + deltaY * 0.28;
  else if (nextY > maxY) nextY = scrollY + deltaY * 0.28;
  scrollY = Math.max(-72, Math.min(maxY + 72, nextY));
  inertiaVelocity = (deltaY / dtMs) * 1000;
  drawNow();
  ensureRafRunning();
}

function onTouchEnd(e: TouchEvent) {
  isTouching = false;
  const maxY = getMaxScrollY();
  if (scrollY < 0 || scrollY > maxY) {
    inertiaVelocity = 0;
    springTargetY = clampScrollY(scrollY);
    springActive = true;
    userScrolling = false;
    scheduleAutoResume();
    ensureRafRunning();
    return;
  }

  if (didScrollGesture) {
    didScrollGesture = false;
    inertiaVelocity = Math.max(-2400, Math.min(2400, inertiaVelocity));
    scheduleAutoResume();
    ensureRafRunning();
    return;
  }

  // Crisp Tap: hit-test Canvas line for instant seek or tapBlank to toggle HUD
  const t0 = e.changedTouches[0];
  if (!t0 || !canvasRef.value || !docLayout) {
    emit('tapBlank');
    return;
  }
  handlePointTap(t0.clientY);
}

function onTouchCancel() {
  isTouching = false;
  didScrollGesture = false;
  scrollY = clampScrollY(scrollY);
  inertiaVelocity = 0;
  drawNow();
}

function onCanvasClick(e: MouseEvent) {
  // Desktop / pointer tap fallback (touch events already handled via onTouchEnd)
  if ('ontouchstart' in window) return;
  handlePointTap(e.clientY);
}

function handlePointTap(clientY: number) {
  const canvas = canvasRef.value;
  if (!canvas || !docLayout) {
    emit('tapBlank');
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const localY = clientY - rect.top;
  const hit = hitTestLyricLine(docLayout, localY + scrollY, 10);
  if (!hit) {
    emit('tapBlank');
    return;
  }
  const line = player.lyrics.lines[hit.index];
  if (!line) {
    emit('tapBlank');
    return;
  }
  echoSystem.haptic('selection');
  userScrolling = false;
  if (scrollResumeTimer) {
    clearTimeout(scrollResumeTimer);
    scrollResumeTimer = null;
  }
  displayTimeMs = line.startMs;
  const targetAudioMs = Math.max(0, line.startMs - lyricOffsetMs.value);
  void player.seek(targetAudioMs);
  activeIndex = hit.index;
  alphasConverging = true;
  scrollToActive(true);
  drawNow();
  ensureRafRunning();
  emit('lineSeek');
}

function onWheel(e: WheelEvent) {
  if (!docLayout) return;
  cancelMotion();
  userScrolling = true;
  alphasConverging = true;
  emit('userScroll');
  scrollY = clampScrollY(scrollY + e.deltaY * 0.85);
  scheduleAutoResume();
  drawNow();
  ensureRafRunning();
}

watch(
  () => [props.active, player.isPlaying],
  ([isActive]) => {
    if (isActive) {
      syncClock(!player.isPlaying);
      void nextTick(() => {
        syncCanvasResolution(false);
        drawNow();
        ensureRafRunning();
      });
    } else {
      cancelMotion();
      stopRaf();
    }
  },
  { immediate: true },
);

watch(
  () => player.currentTimeMs,
  () => {
    if (!props.active) return;
    if (!player.isPlaying) {
      syncClock(true);
      drawNow();
      return;
    }
    const rawMs = getRawShiftedTimeMs();
    if (displayTimeMs < 0 || Math.abs(rawMs - displayTimeMs) > 450) {
      syncClock(true);
      drawNow();
    }
  },
);

watch(lyricOffsetMs, () => {
  displayTimeMs = -1;
  syncClock(true);
  if (props.active) {
    userScrolling = false;
    scrollToActive(true);
    drawNow();
    ensureRafRunning();
  }
});

watch(
  () => [
    player.lyrics.lines,
    settings.lyricFontSize,
    settings.showTranslation,
    settings.lyricRenderMode,
    props.compact,
    props.centered,
  ],
  () => {
    cancelMotion();
    displayTimeMs = -1;
    void nextTick(() => {
      rebuildLayout(true);
      if (props.active) snapToActiveNow();
    });
  },
);

watch(
  () => props.active,
  (isActive) => {
    if (isActive) snapToActiveNow();
  },
  { immediate: true },
);

onMounted(() => {
  if (props.active) {
    snapToActiveNow();
  }
  if (typeof ResizeObserver !== 'undefined' && viewportRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.active) {
        syncCanvasResolution(false);
      }
    });
    resizeObserver.observe(viewportRef.value);
  }
});

onUnmounted(() => {
  cancelMotion();
  stopRaf();
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <!-- Hardware 2D Canvas 120Hz Zero-Flicker Lyric Viewport -->
  <div ref="viewportRef" class="krc-viewport" data-canvas-lyrics>
    <div v-if="player.lyricsLoading" class="krc-empty">
      <div class="krc-dots">
        <span /><span /><span />
      </div>
    </div>

    <div v-else-if="!player.lyrics.lines.length" class="krc-empty" @click="emit('tapBlank')">
      <p class="text-[20px] font-bold text-white/78 tracking-tight">{{ t('lyrics.none') }}</p>
      <p class="text-[13.5px] text-white/46 mt-2">{{ t('lyrics.noneSub') }}</p>
    </div>

    <canvas
      v-show="!player.lyricsLoading && player.lyrics.lines.length > 0"
      ref="canvasRef"
      class="krc-canvas"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
      @touchcancel.passive="onTouchCancel"
      @wheel.passive="onWheel"
      @click="onCanvasClick"
    />
  </div>
</template>

<style scoped>
.krc-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
}

.krc-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: pointer;
}

.krc-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 28px;
}

.krc-dots {
  display: flex;
  gap: 8px;
}

.krc-dots span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  animation: krc-pulse 1.2s ease-in-out infinite;
}

.krc-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.krc-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes krc-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.82); }
  40% { opacity: 1; transform: scale(1.1); }
}
</style>
