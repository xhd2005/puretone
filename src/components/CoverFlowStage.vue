<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconMusic from '@iconify/icons-tabler/music';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconPlayerTrackPrevFilled from '@iconify/icons-tabler/player-track-prev-filled';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import { computeCoverFlowCardTransform } from '@/utils/heroMorph';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';

const props = defineProps<{
  active: boolean;
}>();

const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const stageRef = ref<HTMLElement | null>(null);
const cardSizePx = ref(178);
const scrollIndex = ref(Math.max(0, player.currentIndex));
const isDragging = ref(false);

let rafId = 0;
let lastRafNow = 0;
let animTarget: number | null = null;
let velocity = 0; // cards per second
let dragStartX = 0;
let dragStartScroll = 0;
let lastDragX = 0;
let lastDragTime = 0;
let didDragMove = false;
let lastHapticIdx = Math.max(0, player.currentIndex);

const maxIndex = computed(() => Math.max(0, player.queue.length - 1));

const focusedIndex = computed(() => {
  if (!player.queue.length) return -1;
  return Math.max(0, Math.min(maxIndex.value, Math.round(scrollIndex.value)));
});

const focusedSong = computed(() => {
  const idx = focusedIndex.value;
  return idx >= 0 ? player.queue[idx] || null : null;
});

const isFocusedCurrent = computed(() => focusedIndex.value === player.currentIndex);

// Virtualized window: only render cards within +-4 of active float index (~9 DOM nodes max -> 120Hz!)
const visibleCards = computed(() => {
  const total = player.queue.length;
  if (!total) return [];
  const center = Math.round(scrollIndex.value);
  const start = Math.max(0, center - 4);
  const end = Math.min(total - 1, center + 4);
  const items = [];
  for (let i = start; i <= end; i += 1) {
    const song = player.queue[i];
    if (!song) continue;
    const offset = i - scrollIndex.value;
    const tf = computeCoverFlowCardTransform(offset, cardSizePx.value);
    items.push({
      index: i,
      song,
      offset,
      isPlayingThis: i === player.currentIndex,
      style: {
        width: `${cardSizePx.value}px`,
        height: `${cardSizePx.value}px`,
        marginLeft: `${(-cardSizePx.value / 2).toFixed(1)}px`,
        marginTop: `${(-cardSizePx.value / 2).toFixed(1)}px`,
        transform: tf.transform,
        opacity: tf.opacity,
        zIndex: tf.zIndex,
      },
    });
  }
  return items;
});

function measureCardSize() {
  const el = stageRef.value;
  if (!el) return;
  const h = el.clientHeight;
  const w = el.clientWidth;
  if (h < 80 || w < 160) return;
  cardSizePx.value = Math.round(Math.max(126, Math.min(220, h * 0.72, w * 0.30)));
}

function stopAnim() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastRafNow = 0;
  animTarget = null;
  velocity = 0;
}

function triggerDetentHapticIfNeeded(val: number) {
  const rounded = Math.max(0, Math.min(maxIndex.value, Math.round(val)));
  if (rounded !== lastHapticIdx) {
    lastHapticIdx = rounded;
    echoSystem.haptic('selection');
  }
}

function stepAnimation(now: number) {
  const dt = lastRafNow > 0 ? Math.min(0.05, (now - lastRafNow) / 1000) : 1 / 120;
  lastRafNow = now;

  if (animTarget !== null) {
    // Critically damped spring toward integer target card
    const omega = 13.5;
    const x = scrollIndex.value - animTarget;
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    const nextX = (f * x + dt * velocity) * detInv;
    velocity = (velocity - hoo * x) * detInv;
    scrollIndex.value = animTarget + nextX;
    triggerDetentHapticIfNeeded(scrollIndex.value);

    if (Math.abs(nextX) < 0.004 && Math.abs(velocity) < 0.05) {
      scrollIndex.value = animTarget;
      stopAnim();
      return;
    }
    rafId = requestAnimationFrame(stepAnimation);
    return;
  }

  stopAnim();
}

function springToIndex(targetIdx: number, initialVelocity = 0) {
  const clamped = Math.max(0, Math.min(maxIndex.value, Math.round(targetIdx)));
  animTarget = clamped;
  velocity = initialVelocity;
  if (!rafId) {
    lastRafNow = typeof performance !== 'undefined' ? performance.now() : 0;
    rafId = requestAnimationFrame(stepAnimation);
  }
}

function onPointerDown(e: PointerEvent) {
  if (!player.queue.length) return;
  stopAnim();
  isDragging.value = true;
  didDragMove = false;
  dragStartX = e.clientX;
  dragStartScroll = scrollIndex.value;
  lastDragX = e.clientX;
  lastDragTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    // ignore
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStartX;
  if (Math.abs(dx) > 6) didDragMove = true;

  const stepPx = Math.max(96, cardSizePx.value * 0.78);
  let nextScroll = dragStartScroll - dx / stepPx;
  // Soft rubber-band resistance past first/last track
  if (nextScroll < 0) nextScroll = nextScroll * 0.28;
  else if (nextScroll > maxIndex.value) nextScroll = maxIndex.value + (nextScroll - maxIndex.value) * 0.28;

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dtMs = Math.max(4, now - lastDragTime);
  const deltaCards = -(e.clientX - lastDragX) / stepPx;
  velocity = (deltaCards / dtMs) * 1000;
  lastDragX = e.clientX;
  lastDragTime = now;

  scrollIndex.value = nextScroll;
  triggerDetentHapticIfNeeded(nextScroll);
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  try {
    const el = e.currentTarget as HTMLElement;
    if (el?.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
  } catch {
    // ignore
  }
  // Momentum projection: smooth multi-album flicks land cleanly on a centered cover
  const projected = scrollIndex.value + Math.max(-5, Math.min(5, velocity * 0.22));
  springToIndex(projected, Math.max(-16, Math.min(16, velocity * 0.5)));
}

function onWheel(e: WheelEvent) {
  if (!player.queue.length) return;
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(delta) < 4) return;
  springToIndex(Math.round(scrollIndex.value) + (delta > 0 ? 1 : -1));
}

function onCardTap(index: number) {
  if (didDragMove) {
    didDragMove = false;
    return;
  }
  if (Math.abs(index - scrollIndex.value) > 0.35) {
    echoSystem.haptic('selection');
    springToIndex(index);
    return;
  }
  if (index === player.currentIndex) {
    void player.togglePlay();
  } else {
    echoSystem.haptic('medium');
    void player.playQueue(player.queue, index);
  }
}

function playFocusedTrack() {
  const idx = focusedIndex.value;
  if (idx < 0) return;
  if (idx === player.currentIndex) {
    void player.togglePlay();
  } else {
    echoSystem.haptic('medium');
    void player.playQueue(player.queue, idx);
  }
}

watch(
  () => player.currentIndex,
  (nextIdx) => {
    if (nextIdx >= 0 && !isDragging.value) {
      springToIndex(nextIdx);
    }
  },
);

watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      measureCardSize();
      if (player.currentIndex >= 0) {
        stopAnim();
        scrollIndex.value = player.currentIndex;
        lastHapticIdx = player.currentIndex;
      }
    } else {
      stopAnim();
    }
  },
  { immediate: true },
);

let resizeObs: ResizeObserver | null = null;
onMounted(() => {
  measureCardSize();
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    resizeObs = new ResizeObserver(() => measureCardSize());
    resizeObs.observe(stageRef.value);
  }
});

onUnmounted(() => {
  stopAnim();
  resizeObs?.disconnect();
  resizeObs = null;
});
</script>

<template>
  <div class="cf-root" data-coverflow-stage>
    <!-- 3D Perspective Album Stage -->
    <div
      ref="stageRef"
      class="cf-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.passive="onWheel"
    >
      <div
        v-for="card in visibleCards"
        :key="`${card.song.id}-${card.index}`"
        class="cf-card"
        :class="{ 'is-center': Math.abs(card.offset) < 0.45, 'is-playing': card.isPlayingThis }"
        :style="card.style"
        @click.stop="onCardTap(card.index)"
      >
        <div class="cf-card-frame">
          <img
            v-if="card.song.coverUrl"
            :src="card.song.coverUrl"
            decoding="async"
            draggable="false"
            :alt="card.song.title"
            class="w-full h-full object-cover select-none pointer-events-none"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center bg-white/10 text-white/40"
          >
            <Icon :icon="iconMusic" class="w-12 h-12" />
          </div>

          <div
            v-if="card.isPlayingThis"
            class="cf-playing-pill"
          >
            <span class="cf-eq-bars" :class="{ 'is-paused': !player.isPlaying }">
              <i /><i /><i />
            </span>
          </div>
        </div>
        <div class="cf-floor-glow" />
      </div>
    </div>

    <!-- Centered Track Metadata + Compact Floating Controls -->
    <div v-if="focusedSong" class="cf-bottom-bar">
      <div class="cf-meta-block">
        <div class="flex items-center justify-center gap-2 min-w-0">
          <span class="text-[16px] font-bold text-white truncate max-w-[44vw]">
            {{ focusedSong.title }}
          </span>
          <span
            v-if="isFocusedCurrent && player.sourceTag"
            class="px-2 py-0.5 rounded-[6px] bg-white/15 text-white/90 text-[10px] font-semibold shrink-0"
          >
            {{ player.sourceTag }}
          </span>
        </div>
        <div class="text-[12.5px] text-white/65 truncate mt-0.5">
          {{ focusedSong.artist }}
          <span v-if="focusedSong.album" class="opacity-65"> · {{ focusedSong.album }}</span>
          <span class="opacity-55 ml-1.5 tabular-nums">{{ focusedIndex + 1 }} / {{ player.queue.length }}</span>
        </div>
      </div>

      <div class="cf-controls-row">
        <button
          type="button"
          class="cf-icon-btn am-tap"
          :aria-label="t('song.favorite')"
          @click="player.currentSong && player.toggleFavorite(player.currentSong)"
        >
          <Icon
            :icon="player.isCurrentFavorite ? iconHeartFilled : iconHeart"
            class="w-5 h-5"
            :class="player.isCurrentFavorite ? 'text-[#ff375f]' : 'text-white/85'"
          />
        </button>

        <button
          type="button"
          class="cf-icon-btn am-tap"
          aria-label="上一首"
          @click="player.previous(true)"
        >
          <Icon :icon="iconPlayerTrackPrevFilled" class="w-6 h-6 text-white" />
        </button>

        <button
          type="button"
          class="cf-primary-btn am-tap"
          @click="playFocusedTrack"
        >
          <Icon
            :icon="isFocusedCurrent && player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled"
            class="w-6 h-6"
          />
          <span v-if="!isFocusedCurrent" class="text-[12px] font-semibold pr-1">
            {{ t('common.play') }}
          </span>
        </button>

        <button
          type="button"
          class="cf-icon-btn am-tap"
          aria-label="下一首"
          @click="player.next()"
        >
          <Icon :icon="iconPlayerTrackNextFilled" class="w-6 h-6 text-white" />
        </button>

        <button
          type="button"
          class="cf-icon-btn am-tap"
          :aria-label="t('audio.sheetTitle')"
          @click="echoSystem.haptic('light'); ui.audioEffectSheetOpen = true"
        >
          <Icon :icon="iconAdjustments" class="w-5 h-5 text-white/85" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cf-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px calc(var(--safe-right) + 20px) 6px calc(var(--safe-left) + 20px);
  overflow: hidden;
  user-select: none;
}

.cf-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: pan-y;
  cursor: grab;
}

.cf-stage:active {
  cursor: grabbing;
}

.cf-card {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
  will-change: transform, opacity;
  backface-visibility: hidden;
  cursor: pointer;
}

.cf-card-frame {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  border: 0.75px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 22px 46px rgba(0, 0, 0, 0.50), 0 6px 14px rgba(0, 0, 0, 0.28);
}

.cf-card.is-center .cf-card-frame {
  border-color: rgba(255, 255, 255, 0.42);
  box-shadow: 0 26px 56px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.cf-floor-glow {
  position: absolute;
  left: 10%;
  right: 10%;
  bottom: -14px;
  height: 14px;
  border-radius: 999px;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.18) 0%, transparent 72%);
  pointer-events: none;
}

.cf-playing-pill {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(12, 16, 28, 0.62);
  border: 0.5px solid rgba(255, 255, 255, 0.24);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cf-eq-bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 11px;
}

.cf-eq-bars i {
  display: block;
  width: 2.5px;
  border-radius: 999px;
  background: #ffffff;
  animation: cf-eq 0.9s ease-in-out infinite alternate;
}

.cf-eq-bars i:nth-child(1) { height: 5px; animation-delay: 0s; }
.cf-eq-bars i:nth-child(2) { height: 11px; animation-delay: 0.25s; }
.cf-eq-bars i:nth-child(3) { height: 7px; animation-delay: 0.45s; }

.cf-eq-bars.is-paused i {
  animation-play-state: paused;
  height: 4px;
}

@keyframes cf-eq {
  0% { transform: scaleY(0.35); }
  100% { transform: scaleY(1); }
}

.cf-bottom-bar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 4px;
}

.cf-meta-block {
  text-align: center;
  max-width: 78vw;
}

.cf-controls-row {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 5px 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 100%);
  border: 0.5px solid rgba(255, 255, 255, 0.20);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 8px 22px rgba(0, 0, 0, 0.24);
}

.cf-icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cf-primary-btn {
  min-width: 40px;
  height: 40px;
  padding: 0 10px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.94);
  color: #111116;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}
</style>
