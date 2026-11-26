<script lang="ts">
// Module-level tracker so swiping open one row smoothly closes any previously opened row (authentic iOS behavior).
let activeSwipeCloser: (() => void) | null = null;
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import iconDots from '@iconify/icons-tabler/dots';
import iconMusic from '@iconify/icons-tabler/music';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconPlaylistAdd from '@iconify/icons-tabler/playlist-add';
import type { Song } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { echoSystem } from '@/native/echoSystem';

const ACTION_WIDTH = 136;

const props = defineProps<{
  song: Song;
  index?: number;
  showCover?: boolean;
  highlighted?: boolean;
}>();

const emit = defineEmits<{
  play: [song: Song];
}>();

const player = usePlayerStore();
const ui = useUiStore();

const isCurrent = computed(
  () => Boolean(player.currentSong && player.currentSong.id === props.song.id && player.currentSong.hash === props.song.hash),
);

const isFavorited = computed(() =>
  Boolean(props.song.hash && player.favoriteHashes.has(props.song.hash.toLowerCase())),
);

const swipeX = ref(0);
const swiping = ref(false);

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let triggeredLongPress = false;
let startX = 0;
let startY = 0;
let startOffset = 0;
let gestureAxis: 'none' | 'x' | 'y' = 'none';
let justSwiped = false;

function closeSwipe() {
  swipeX.value = 0;
  swiping.value = false;
  if (activeSwipeCloser === closeSwipe) {
    activeSwipeCloser = null;
  }
}

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  triggeredLongPress = false;
  justSwiped = false;
  startX = t.clientX;
  startY = t.clientY;
  startOffset = swipeX.value;
  gestureAxis = 'none';

  if (activeSwipeCloser && activeSwipeCloser !== closeSwipe) {
    activeSwipeCloser();
  }

  if (swipeX.value === 0) {
    longPressTimer = setTimeout(() => {
      triggeredLongPress = true;
      echoSystem.haptic('heavy');
      ui.actionSheetSong = props.song;
    }, 460);
  }
}

function onTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  const dx = t.clientX - startX;
  const dy = t.clientY - startY;

  if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
    clearLongPress();
  }

  if (gestureAxis === 'none') {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      if (dx < 0 || startOffset < 0) {
        gestureAxis = 'x';
        swiping.value = true;
      }
    } else if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
      gestureAxis = 'y';
      if (swipeX.value < 0) closeSwipe();
    }
  }

  if (gestureAxis === 'x') {
    e.preventDefault();
    let next = startOffset + dx;
    if (next > 0) next = 0;
    if (next < -ACTION_WIDTH) {
      next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.25;
    }
    swipeX.value = next;
  }
}

function onTouchEnd() {
  clearLongPress();
  if (gestureAxis === 'x') {
    swiping.value = false;
    justSwiped = true;
    const shouldOpen = swipeX.value < -54;
    if (shouldOpen) {
      if (startOffset === 0) echoSystem.haptic('selection');
      swipeX.value = -ACTION_WIDTH;
      activeSwipeCloser = closeSwipe;
    } else {
      closeSwipe();
    }
  }
  gestureAxis = 'none';
}

function onRowClick() {
  if (triggeredLongPress || justSwiped) {
    triggeredLongPress = false;
    justSwiped = false;
    return;
  }
  if (swipeX.value < -4) {
    closeSwipe();
    return;
  }
  emit('play', props.song);
}

function onSwipePlayNext() {
  closeSwipe();
  player.addToQueueNext(props.song);
}

function onSwipeToggleFavorite() {
  closeSwipe();
  void player.toggleFavorite(props.song);
}

onUnmounted(() => {
  clearLongPress();
  if (activeSwipeCloser === closeSwipe) {
    activeSwipeCloser = null;
  }
});
</script>

<template>
  <div class="song-row-shell" :class="{ 'is-highlighted': highlighted }">
    <!-- Lazy-mounted iOS Swipe-Left Action Tray (0 extra DOM nodes while scrolling vertically) -->
    <div v-if="swipeX < -1 || swiping" class="swipe-actions" aria-label="快捷操作">
      <button
        type="button"
        class="swipe-action-btn is-next"
        @click.stop="onSwipePlayNext"
      >
        <Icon :icon="iconPlaylistAdd" class="w-5 h-5" />
        <span>下一首</span>
      </button>
      <button
        type="button"
        class="swipe-action-btn is-fav"
        @click.stop="onSwipeToggleFavorite"
      >
        <Icon :icon="isFavorited ? iconHeartFilled : iconHeart" class="w-5 h-5" />
        <span>{{ isFavorited ? '取消' : '红心' }}</span>
      </button>
    </div>

    <div
      class="song-row"
      :class="{ 'is-swiping': swiping }"
      :style="swipeX !== 0 ? { transform: `translate3d(${swipeX}px, 0, 0)` } : undefined"
      role="button"
      tabindex="0"
      @click="onRowClick"
      @touchstart.passive="onTouchStart"
      @touchmove="onTouchMove"
      @touchend.passive="onTouchEnd"
      @touchcancel.passive="onTouchEnd"
      @contextmenu.prevent="ui.actionSheetSong = song"
    >
      <div v-if="showCover !== false" class="song-cover">
        <img v-if="song.coverUrl" :src="song.coverUrl" :alt="song.title" loading="lazy" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center bg-[var(--bg-subtle)] text-[var(--text-tertiary)]">
          <Icon :icon="iconMusic" class="w-5 h-5" />
        </div>
        <div v-if="isCurrent" class="song-playing-overlay">
          <div class="eq-bars" :class="{ paused: !player.isPlaying }">
            <span /><span /><span />
          </div>
        </div>
      </div>

      <div
        v-else-if="index !== undefined"
        class="w-7 text-center text-[14px] font-medium tabular-nums shrink-0"
        :class="isCurrent ? 'am-accent-text' : 'text-[var(--text-secondary)]'"
      >
        {{ index + 1 }}
      </div>

      <div class="flex-1 min-w-0 py-2.5 am-hairline-b flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <div
            class="text-[16px] font-medium truncate leading-snug"
            :class="[
              isCurrent ? 'am-accent-text font-semibold' : 'text-[var(--text-primary)]',
              song.isGray ? 'opacity-70' : '',
            ]"
          >
            {{ song.title }}
          </div>
          <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
            <span v-if="song.hashFlac" class="am-badge">无损</span>
            <span v-if="song.isGray" class="am-badge am-badge-gray">解灰</span>
            <span class="text-[13px] text-[var(--text-secondary)] truncate">
              {{ song.artist }}<template v-if="song.album"> · {{ song.album }}</template>
            </span>
          </div>
        </div>

        <button
          type="button"
          class="w-10 h-10 -mr-1 rounded-full flex items-center justify-center bg-transparent border-0 text-[var(--text-secondary)] am-tap shrink-0"
          aria-label="歌曲操作"
          @click.stop="echoSystem.haptic('light'); ui.actionSheetSong = song"
        >
          <Icon :icon="iconDots" class="w-5 h-5" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.song-row-shell {
  position: relative;
  overflow: hidden;
  contain: layout style;
  transition: background-color 420ms ease;
}

.song-row-shell.is-highlighted {
  background-color: color-mix(in srgb, var(--accent) 16%, transparent);
}

.swipe-actions {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 136px;
  display: flex;
}

.swipe-action-btn {
  flex: 1;
  border: 0;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.swipe-action-btn.is-next {
  background: #5856d6;
}

.swipe-action-btn.is-fav {
  background: var(--accent);
}

.song-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  cursor: pointer;
  background-color: var(--bg-canvas);
  transition: transform 280ms var(--spring-ease);
}

.song-row.is-swiping {
  transition: none;
}

.song-row:active {
  background-color: var(--bg-subtle);
}

.song-cover {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 9px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

.song-playing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}

.eq-bars {
  display: flex;
  align-items: flex-end;
  gap: 2.5px;
  height: 14px;
}
.eq-bars span {
  width: 3px;
  border-radius: 2px;
  background: #ffffff;
  animation: eq-bounce 0.9s ease-in-out infinite;
}
.eq-bars span:nth-child(1) { height: 7px; animation-delay: 0s; }
.eq-bars span:nth-child(2) { height: 14px; animation-delay: 0.2s; }
.eq-bars span:nth-child(3) { height: 9px; animation-delay: 0.4s; }
.eq-bars.paused span { animation-play-state: paused; }

@keyframes eq-bounce {
  0%, 100% { transform: scaleY(0.45); }
  50% { transform: scaleY(1); }
}

.am-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.am-badge-gray {
  color: var(--accent);
}
</style>
