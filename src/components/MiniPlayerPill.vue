<script setup lang="ts">
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconMusic from '@iconify/icons-tabler/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';

const player = usePlayerStore();
const ui = useUiStore();

let touchStartX = 0;
let touchStartY = 0;

function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0]?.clientX ?? 0;
  touchStartY = e.touches[0]?.clientY ?? 0;
}

function onTouchEnd(e: TouchEvent) {
  const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX;
  const dy = (e.changedTouches[0]?.clientY ?? 0) - touchStartY;
  if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    if (dx < 0) void player.next();
    else void player.previous();
  }
}
</script>

<template>
  <div
    v-if="player.currentSong"
    class="mini-pill am-glass"
    role="button"
    tabindex="0"
    @click="ui.openNowPlaying('cover')"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <div class="mini-cover">
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

    <div class="flex-1 min-w-0 pr-1">
      <div class="text-[15px] font-semibold truncate leading-tight text-[var(--text-primary)]">
        {{ player.currentSong.title }}
      </div>
      <div class="text-[12px] truncate leading-tight mt-0.5 text-[var(--text-secondary)]">
        {{ player.isResolving ? '正在解析音源…' : player.currentSong.artist }}
      </div>
    </div>

    <div class="flex items-center gap-0.5 shrink-0" @click.stop>
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
  </div>
</template>

<style scoped>
.mini-pill {
  height: var(--miniplayer-height);
  border-radius: 15px;
  padding: 6px 8px 6px 8px;
  display: flex;
  align-items: center;
  gap: 11px;
  box-shadow: var(--pill-shadow);
  cursor: pointer;
}

.mini-cover {
  width: 44px;
  height: 44px;
  border-radius: 9px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
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
</style>
