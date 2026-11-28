<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import {
  advanceMonotonicLyricTime,
  computeWordLuminanceAlpha,
  findActiveLyricIndex,
  quantizeWordAlphaStep,
} from '@/utils/lyricClock';
import type { LyricLine } from '@/types/music';

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

const fontSizeClass = computed(() => `krc-size-${settings.lyricFontSize}`);
const currentTrackOffsetKey = computed(() => {
  const s = player.currentSong;
  return s ? (s.hash ? s.hash.toLowerCase() : s.id) : '';
});
const lyricOffsetMs = computed(() => settings.getLyricOffset(currentTrackOffsetKey.value));

function getRawShiftedTimeMs(): number {
  return Math.max(0, player.getInterpolatedTimeMs() + lyricOffsetMs.value);
}

const scrollerRef = ref<HTMLElement | null>(null);
const lineRefs = ref<HTMLElement[]>([]);
// Only flips on actual lyric line transitions (~every 3-5s) -> ZERO 120Hz Vue VDOM diff!
const activeIndex = ref(-1);
const userScrolling = ref(false);

const MIN_WORD_ALPHA = 0.34;
const ALPHA_STEPS = 16;

let displayTimeMs = -1;
let scrollResumeTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupWordTimer: ReturnType<typeof setTimeout> | null = null;
let rafId = 0;
let lastRafNow = 0;
let touchStartY = 0;
let didScrollGesture = false;
let paintedLineIdx = -1;
let cachedWordNodes: HTMLElement[] = [];
let resizeObserver: ResizeObserver | null = null;

// 120Hz/144Hz Frame-Rate-Independent Critically-Damped Spring Scroller
const SPRING_OMEGA = 10.5;
let springActive = false;
let springTargetTop = 0;
let springVelocity = 0;
let springPos = 0;

function cancelSpringScroll() {
  springActive = false;
  springVelocity = 0;
}

function stepSpringScroll(dtSec: number) {
  if (!springActive || userScrolling.value) {
    springActive = false;
    return;
  }
  const container = scrollerRef.value;
  if (!container) {
    springActive = false;
    return;
  }
  const dt = Math.max(0.001, Math.min(0.05, dtSec));
  const x = springPos - springTargetTop;
  const f = 1 + 2 * dt * SPRING_OMEGA;
  const oo = SPRING_OMEGA * SPRING_OMEGA;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const nextX = (f * x + dt * springVelocity) * detInv;
  springVelocity = (springVelocity - hoo * x) * detInv;
  springPos = springTargetTop + nextX;
  container.scrollTop = springPos;

  if (Math.abs(nextX) < 0.45 && Math.abs(springVelocity) < 8) {
    container.scrollTop = springTargetTop;
    springPos = springTargetTop;
    springActive = false;
    springVelocity = 0;
  }
}

function clearNodesInlineStyles(nodes: HTMLElement[]) {
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    if (el) {
      el.style.removeProperty('color');
      delete el.dataset.waq;
    }
  }
}

function clearWordCache(immediate = true) {
  if (cleanupWordTimer) {
    clearTimeout(cleanupWordTimer);
    cleanupWordTimer = null;
  }
  const prevNodes = cachedWordNodes;
  cachedWordNodes = [];
  paintedLineIdx = -1;
  if (!prevNodes.length) return;
  if (immediate) {
    clearNodesInlineStyles(prevNodes);
  } else {
    cleanupWordTimer = setTimeout(() => {
      cleanupWordTimer = null;
      clearNodesInlineStyles(prevNodes);
    }, 320);
  }
}

/**
 * Pure solid-glyph luminance painting (ZERO SaveLayer, ZERO background-clip:text, ZERO Skia flicker!).
 * Only mutates the 1-2 syllables whose quantized alpha step changed this frame.
 */
function paintActiveLineWords(idx: number, nowMs: number) {
  if (idx < 0) {
    if (paintedLineIdx >= 0) clearWordCache(false);
    return;
  }
  const line = player.lyrics.lines[idx];
  if (!line?.words?.length) {
    if (paintedLineIdx >= 0) clearWordCache(false);
    return;
  }

  if (paintedLineIdx !== idx) {
    clearWordCache(false);
    const rowEl = lineRefs.value[idx];
    if (!rowEl) return;
    cachedWordNodes = Array.from(rowEl.querySelectorAll<HTMLElement>('.krc-word'));
    paintedLineIdx = idx;
  }

  const words = line.words;
  const count = Math.min(words.length, cachedWordNodes.length);
  for (let i = 0; i < count; i += 1) {
    const alpha = computeWordLuminanceAlpha(words[i], nowMs, MIN_WORD_ALPHA);
    const q = String(quantizeWordAlphaStep(alpha, ALPHA_STEPS, MIN_WORD_ALPHA));
    const el = cachedWordNodes[i];
    if (el.dataset.waq !== q) {
      el.dataset.waq = q;
      el.style.color = alpha >= 0.995 ? '#ffffff' : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    }
  }
}

function syncFrame(forceSnap = false) {
  const rawMs = getRawShiftedTimeMs();
  displayTimeMs = forceSnap
    ? rawMs
    : advanceMonotonicLyricTime(displayTimeMs, rawMs, player.isPlaying);

  const nextIdx = findActiveLyricIndex(player.lyrics.lines, displayTimeMs, 90);
  if (nextIdx !== activeIndex.value) {
    paintActiveLineWords(nextIdx, displayTimeMs);
    activeIndex.value = nextIdx;
  } else {
    paintActiveLineWords(activeIndex.value, displayTimeMs);
  }
}

function needsRaf(): boolean {
  if (!props.active) return false;
  return player.isPlaying || springActive;
}

function tick(now: number) {
  if (!needsRaf()) {
    rafId = 0;
    lastRafNow = 0;
    return;
  }
  const dtSec = lastRafNow > 0 ? (now - lastRafNow) / 1000 : 1 / 120;
  lastRafNow = now;
  if (player.isPlaying) {
    syncFrame(false);
  }
  if (springActive) {
    stepSpringScroll(dtSec);
  }
  if (needsRaf()) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = 0;
    lastRafNow = 0;
  }
}

function ensureRafRunning() {
  if (rafId || !needsRaf()) return;
  lastRafNow = typeof performance !== 'undefined' ? performance.now() : 0;
  rafId = requestAnimationFrame(tick);
}

function syncLoop(forceSnap = false) {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastRafNow = 0;
  }
  syncFrame(forceSnap);
  ensureRafRunning();
}

function scrollToActive(smooth = true) {
  if (userScrolling.value) return;
  const idx = activeIndex.value;
  const container = scrollerRef.value;
  if (!container || container.clientHeight < 20) return;

  let desiredTop = 0;
  if (idx >= 0) {
    const el = lineRefs.value[idx];
    if (!el) return;
    const anchorRatio = props.centered ? 0.42 : props.compact ? 0.36 : 0.31;
    desiredTop = Math.max(0, el.offsetTop - container.clientHeight * anchorRatio);
  }
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampedTarget = Math.min(maxScroll, desiredTop);

  if (!smooth || !props.active) {
    cancelSpringScroll();
    container.scrollTop = clampedTarget;
    springPos = clampedTarget;
    return;
  }

  if (!springActive) {
    springPos = container.scrollTop;
    springVelocity = 0;
  }
  springTargetTop = clampedTarget;
  if (Math.abs(springPos - clampedTarget) < 1) {
    container.scrollTop = clampedTarget;
    springPos = clampedTarget;
    cancelSpringScroll();
    return;
  }
  springActive = true;
  ensureRafRunning();
}

function snapToActiveNow() {
  userScrolling.value = false;
  cancelSpringScroll();
  displayTimeMs = -1;
  syncLoop(true);
  void nextTick(() => {
    paintActiveLineWords(activeIndex.value, Math.max(0, displayTimeMs));
    scrollToActive(false);
    requestAnimationFrame(() => scrollToActive(false));
  });
}

watch(
  () => [props.active, player.isPlaying],
  ([isActive]) => {
    if (isActive) {
      syncLoop(!player.isPlaying);
    } else {
      cancelSpringScroll();
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
        lastRafNow = 0;
      }
    }
  },
  { immediate: true },
);

watch(
  () => player.currentTimeMs,
  () => {
    if (!props.active) return;
    if (!player.isPlaying) {
      syncFrame(true);
      return;
    }
    const rawMs = getRawShiftedTimeMs();
    if (displayTimeMs < 0 || Math.abs(rawMs - displayTimeMs) > 450) {
      syncFrame(true);
    }
  },
);

watch(lyricOffsetMs, () => {
  displayTimeMs = -1;
  syncFrame(true);
  if (props.active) {
    userScrolling.value = false;
    void nextTick(() => scrollToActive(true));
  }
});

watch(
  () => player.lyrics.lines,
  () => {
    cancelSpringScroll();
    clearWordCache(true);
    lineRefs.value = [];
    displayTimeMs = -1;
    if (props.active) snapToActiveNow();
  },
);

watch(activeIndex, (nextIdx) => {
  void nextTick(() => {
    paintActiveLineWords(nextIdx, Math.max(0, displayTimeMs));
    scrollToActive(true);
  });
});

watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      snapToActiveNow();
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.active) {
    snapToActiveNow();
  }
  if (typeof ResizeObserver !== 'undefined' && scrollerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.active && !userScrolling.value) {
        scrollToActive(false);
      }
    });
    resizeObserver.observe(scrollerRef.value);
  }
});

onUnmounted(() => {
  cancelSpringScroll();
  if (rafId) cancelAnimationFrame(rafId);
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
  clearWordCache(true);
});

function markUserScrolling() {
  cancelSpringScroll();
  userScrolling.value = true;
  emit('userScroll');
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  scrollResumeTimer = setTimeout(() => {
    userScrolling.value = false;
    scrollToActive(true);
  }, 3000);
}

function onTouchStart(e: TouchEvent) {
  cancelSpringScroll();
  touchStartY = e.touches[0]?.clientY ?? 0;
  didScrollGesture = false;
}

function onTouchMove(e: TouchEvent) {
  const dy = Math.abs((e.touches[0]?.clientY ?? 0) - touchStartY);
  if (dy > 6) {
    didScrollGesture = true;
    markUserScrolling();
  }
}

function onContainerClick(e: MouseEvent) {
  if (didScrollGesture) {
    didScrollGesture = false;
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target?.closest('.krc-line')) return;
  emit('tapBlank');
}

function handleLineClick(line: LyricLine) {
  if (didScrollGesture) {
    didScrollGesture = false;
    return;
  }
  echoSystem.haptic('selection');
  userScrolling.value = false;
  displayTimeMs = line.startMs;
  const targetAudioMs = Math.max(0, line.startMs - lyricOffsetMs.value);
  void player.seek(targetAudioMs);
  const nextIdx = findActiveLyricIndex(player.lyrics.lines, displayTimeMs, 90);
  paintActiveLineWords(nextIdx, displayTimeMs);
  if (nextIdx !== activeIndex.value) activeIndex.value = nextIdx;
  emit('lineSeek');
  void nextTick(() => scrollToActive(true));
}

function getLineClass(idx: number) {
  const diff = Math.abs(idx - activeIndex.value);
  if (idx === activeIndex.value) return 'is-active';
  if (userScrolling.value) return 'is-scrolling';
  if (diff === 1) return 'is-near';
  if (diff === 2) return 'is-mid';
  return 'is-far';
}
</script>

<template>
  <!-- Pure glyph-atlas 120Hz zero-flicker lyric viewport -->
  <div class="krc-viewport" :class="{ 'is-centered': centered, 'is-compact': compact }">
    <div
      ref="scrollerRef"
      class="krc-scroller"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @wheel.passive="markUserScrolling"
      @click="onContainerClick"
    >
      <Transition name="am-fade" mode="out-in">
        <div v-if="player.lyricsLoading" key="krc-loading" class="krc-empty">
          <div class="krc-dots">
            <span /><span /><span />
          </div>
        </div>

        <div v-else-if="!player.lyrics.lines.length" key="krc-none" class="krc-empty">
          <p class="text-[20px] font-bold text-white/78 tracking-tight">{{ t('lyrics.none') }}</p>
          <p class="text-[13.5px] text-white/46 mt-2">{{ t('lyrics.noneSub') }}</p>
        </div>

        <div v-else key="krc-list" class="krc-list" :class="fontSizeClass">
          <button
            v-for="(line, idx) in player.lyrics.lines"
            :key="`${line.startMs}-${idx}`"
            :ref="(el) => { if (el) lineRefs[idx] = el as HTMLElement }"
            type="button"
            class="krc-line"
            :class="getLineClass(idx)"
            @click.stop="handleLineClick(line)"
          >
            <div v-if="line.words && line.words.length" class="krc-main">
              <span
                v-for="(w, wi) in line.words"
                :key="wi"
                class="krc-word"
              >{{ w.text }}</span>
            </div>

            <div v-else class="krc-main">
              {{ line.text }}
            </div>

            <div
              v-if="settings.showTranslation && line.translation"
              class="krc-trans"
            >
              {{ line.translation }}
            </div>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.krc-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.krc-scroller {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding: 20vh 26px 40vh;
  scrollbar-width: none;
}

.krc-viewport.is-compact .krc-scroller {
  padding: 28vh 18px 44vh;
}

.krc-viewport.is-centered .krc-scroller {
  padding: 32vh 36px 48vh;
}

.krc-scroller::-webkit-scrollbar {
  display: none;
}

.krc-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.krc-viewport.is-compact .krc-list {
  gap: 18px;
}

.krc-viewport.is-centered .krc-list {
  gap: 24px;
  align-items: center;
}

/* Pure GPU transform + opacity + direct glyph-atlas RGBA color -> ZERO Skia SaveLayer flicker! */
.krc-line {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 4px 0;
  color: #ffffff;
  opacity: 0.18;
  transform-origin: left center;
  backface-visibility: hidden;
  transition:
    transform 320ms var(--spring-ease),
    opacity 260ms ease;
}

.krc-viewport.is-centered .krc-line {
  text-align: center;
  transform-origin: center center;
  max-width: 82vw;
}

.krc-main {
  font-size: 25px;
  line-height: 1.30;
  font-weight: 700;
  letter-spacing: -0.02em;
  word-break: break-word;
}

.krc-size-large .krc-main {
  font-size: 29px;
  line-height: 1.26;
}

.krc-size-xlarge .krc-main {
  font-size: 34px;
  line-height: 1.22;
}

.krc-viewport.is-compact .krc-main {
  font-size: 21px;
  line-height: 1.32;
}

.krc-viewport.is-compact .krc-size-large .krc-main {
  font-size: 24px;
}

.krc-viewport.is-compact .krc-size-xlarge .krc-main {
  font-size: 27px;
}

.krc-viewport.is-centered .krc-main {
  font-size: clamp(23px, 6.2vh, 36px);
  line-height: 1.28;
}

.krc-trans {
  margin-top: 5px;
  font-size: 14.5px;
  line-height: 1.4;
  font-weight: 500;
  opacity: 0.78;
}

.krc-size-large .krc-trans {
  font-size: 16px;
}

.krc-size-xlarge .krc-trans {
  font-size: 18px;
}

.krc-viewport.is-compact .krc-trans {
  font-size: 13px;
}

.krc-line.is-active {
  transform: scale(1.03);
  opacity: 1;
}

.krc-line.is-near {
  opacity: 0.46;
  transform: scale(0.985);
}

.krc-line.is-mid {
  opacity: 0.28;
  transform: scale(0.975);
}

.krc-line.is-far {
  opacity: 0.14;
  transform: scale(0.965);
}

.krc-line.is-scrolling {
  opacity: 0.68;
  transform: scale(1);
}

.krc-word {
  display: inline;
  white-space: pre-wrap;
}

.krc-line.is-active .krc-word {
  color: rgba(255, 255, 255, 0.34);
}

.krc-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
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
