<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import iconDots from '@iconify/icons-tabler/dots';
import iconMusic from '@iconify/icons-tabler/music';
import type { Song } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{
  song: Song;
  index?: number;
  showCover?: boolean;
}>();

const emit = defineEmits<{
  play: [song: Song];
}>();

const player = usePlayerStore();
const ui = useUiStore();

const isCurrent = computed(
  () => Boolean(player.currentSong && player.currentSong.id === props.song.id && player.currentSong.hash === props.song.hash),
);

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let triggeredLongPress = false;

function onTouchStart() {
  triggeredLongPress = false;
  longPressTimer = setTimeout(() => {
    triggeredLongPress = true;
    ui.actionSheetSong = props.song;
  }, 480);
}

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onRowClick() {
  if (triggeredLongPress) {
    triggeredLongPress = false;
    return;
  }
  emit('play', props.song);
}
</script>

<template>
  <div
    class="song-row"
    role="button"
    tabindex="0"
    @click="onRowClick"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="clearLongPress"
    @touchend.passive="clearLongPress"
    @touchcancel.passive="clearLongPress"
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
            song.isGray ? 'opacity-60' : '',
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
        @click.stop="ui.actionSheetSong = song"
      >
        <Icon :icon="iconDots" class="w-5 h-5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.song-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  cursor: pointer;
}
.song-row:active {
  background-color: var(--bg-subtle);
}

.song-cover {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 8px;
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
