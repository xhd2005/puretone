<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconMusic from '@iconify/icons-tabler/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { echoSystem } from '@/native/echoSystem';

const player = usePlayerStore();
const ui = useUiStore();

const progressPct = computed(() => {
  if (!player.durationMs) return 0;
  return Math.max(0, Math.min(100, (player.currentTimeMs / player.durationMs) * 100));
});

const dragX = ref(0);
const isSwiping = ref(false);
let touchStartX = 0;
let touchStartY = 0;
let dragAxis: 'none' | 'x' | 'y' = 'none';
let swipedRecently = false;
let swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

const pillTransformStyle = computed(() => {
  const glowColor = player.palette.fluidColors?.[0] || '#3456be';
  return {
    transform: `translate3d(${dragX.value.toFixed(1)}px, 0, 0)`,
    transition: isSwiping.value ? 'none' : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
    '--mini-glow-color': glowColor,
  };
});

function handlePillClick() {
  if (swipedRecently) return;
  ui.openNowPlaying('cover');
}

function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0]?.clientX ?? 0;
  touchStartY = e.touches[0]?.clientY ?? 0;
  dragAxis = 'none';
  dragX.value = 0;
  isSwiping.value = false;
}

function onTouchMove(e: TouchEvent) {
  const x = e.touches[0]?.clientX ?? touchStartX;
  const y = e.touches[0]?.clientY ?? touchStartY;
  const dx = x - touchStartX;
  const dy = y - touchStartY;

  if (dragAxis === 'none') {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    dragAxis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
  }
  if (dragAxis !== 'x') return;

  isSwiping.value = true;
  dragX.value = Math.max(-36, Math.min(36, dx * 0.42));
}

function onTouchEnd(e: TouchEvent) {
  const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
  const wasHorizontal = dragAxis === 'x';
  dragAxis = 'none';
  isSwiping.value = false;
  dragX.value = 0;

  if (wasHorizontal && Math.abs(dx) >= 48) {
    swipedRecently = true;
    if (swipeResetTimer) clearTimeout(swipeResetTimer);
    swipeResetTimer = setTimeout(() => {
      swipedRecently = false;
    }, 280);
    echoSystem.haptic('light');
    if (dx < 0) void player.next();
    else void player.previous();
  }
}

function onTouchCancel() {
  dragAxis = 'none';
  isSwiping.value = false;
  dragX.value = 0;
}
</script>

<template>
  <div
    v-if="player.currentSong"
    class="mini-pill lg-capsule"
    :style="pillTransformStyle"
    role="button"
    tabindex="0"
    @click="handlePillClick"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
    @touchcancel.passive="onTouchCancel"
  >
    <div class="mini-ambient-glow" aria-hidden="true" />

    <div class="mini-cover relative z-[1]">
      <img
        v-if="player.currentSong.coverUrl"
        :src="player.currentSong.coverUrl"
        :alt="player.currentSong.title"
        class="w-full h-full object-cover"
      />
      <div v-else class="w-full h-full flex items-center justify-center bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
        <Icon :icon="iconMusic" class="w-5 h-5" />
      </div>
    </div>

    <div class="flex-1 min-w-0 pr-1 relative z-[1]">
      <div class="text-[15px] font-semibold truncate leading-tight text-[var(--text-primary)]">
        {{ player.currentSong.title }}
      </div>
      <div class="text-[12px] truncate leading-tight mt-0.5 text-[var(--text-secondary)]">
        {{ player.isResolving ? '正在解析音源…' : player.currentSong.artist }}
      </div>
    </div>

    <div class="flex items-center gap-0.5 shrink-0 relative z-[1]" @click.stop>
      <button
        type="button"
        class="mini-btn am-tap"
        :aria-label="player.isPlaying ? '暂停' : '播放'"
        @click="player.togglePlay()"
      >
        <Icon :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled" class="w-[22px] h-[22px]" />
      </button>
      <button
        type="button"
        class="mini-btn am-tap"
        aria-label="下一首"
        @click="player.next()"
      >
        <Icon :icon="iconPlayerTrackNextFilled" class="w-[21px] h-[21px]" />
      </button>
    </div>

    <!-- Subtle Liquid Glass edge progress line -->
    <div class="mini-progress-rail z-[1]">
      <div class="mini-progress-fill" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>
</template>

<style scoped>
.mini-pill {
  position: relative;
  height: var(--miniplayer-height);
  border-radius: 22px;
  padding: 6px 9px 6px 8px;
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
  overflow: hidden;
  will-change: transform;
}

.mini-ambient-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.14;
  background: radial-gradient(circle at 14% 50%, var(--mini-glow-color, #3456be) 0%, transparent 66%);
  transition: opacity 320ms ease;
}

.mini-cover {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
}

.mini-btn {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-progress-rail {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 2px;
  border-radius: 999px;
  overflow: hidden;
  background: transparent;
}

.mini-progress-fill {
  height: 100%;
  background: var(--accent);
  opacity: 0.72;
  border-radius: 999px;
  transition: width 260ms linear;
}
</style>
