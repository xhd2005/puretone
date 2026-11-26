<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import iconPlayerTrackNext from '@iconify/icons-tabler/player-track-next';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconCopy from '@iconify/icons-tabler/copy';
import iconPlayerPlay from '@iconify/icons-tabler/player-play';
import iconMoon from '@iconify/icons-tabler/moon';
import type { SleepTimerMode } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';

const player = usePlayerStore();
const ui = useUiStore();

const song = computed(() => ui.actionSheetSong);
const isFav = computed(() => Boolean(song.value?.hash && player.favoriteHashes.has(song.value.hash.toLowerCase())));

const dragSheet = useDraggableSheet({
  onDismiss: () => {
    ui.actionSheetSong = null;
  },
});

const sleepOptions: Array<{ id: SleepTimerMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: '15', label: '15分' },
  { id: '30', label: '30分' },
  { id: '60', label: '60分' },
  { id: 'track', label: '播完本曲' },
];

function close() {
  ui.actionSheetSong = null;
}

function playNow() {
  if (!song.value) return;
  const s = song.value;
  close();
  void player.playSong(s);
}

function playNext() {
  if (!song.value) return;
  player.addToQueueNext(song.value);
  close();
}

function toggleFav() {
  if (!song.value) return;
  const s = song.value;
  close();
  void player.toggleFavorite(s);
}

function openUnblock() {
  if (!song.value) return;
  const s = song.value;
  close();
  ui.unblockModalSong = s;
}

async function copyTitle() {
  if (!song.value) return;
  echoSystem.haptic('light');
  await echoSystem.copyToClipboard(`${song.value.title} - ${song.value.artist}`);
  close();
  ui.showToast('已复制歌曲名称');
}
</script>

<template>
  <Transition name="lg-modal">
    <div v-if="song" class="fixed inset-0 z-[80] flex flex-col justify-end lg-scrim" @click="close">
      <div
        class="lg-sheet-panel rounded-t-[28px] px-4 pt-2 pb-[calc(var(--safe-bottom)+18px)]"
        :style="dragSheet.sheetStyle.value"
        @click.stop
      >
        <div
          class="pt-1 pb-3 touch-none"
          @touchstart="dragSheet.onHandleTouchStart"
          @touchmove="dragSheet.onHandleTouchMove"
          @touchend="dragSheet.onHandleTouchEnd"
          @touchcancel="dragSheet.onHandleTouchEnd"
        >
          <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />
        </div>

        <!-- Song Header -->
        <div class="flex items-center gap-3 px-2 pb-3.5 am-hairline-b">
          <div class="w-12 h-12 rounded-[11px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-sm">
            <img v-if="song.coverUrl" :src="song.coverUrl" class="w-full h-full object-cover" alt="" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[16px] font-semibold truncate text-[var(--text-primary)]">{{ song.title }}</div>
            <div class="text-[13px] truncate text-[var(--text-secondary)] mt-0.5">{{ song.artist }}</div>
          </div>
        </div>

        <!-- Sleep Timer Pill Strip -->
        <div class="mt-3 rounded-[18px] bg-[var(--bg-card)] px-4 py-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5 text-[14px] font-semibold text-[var(--text-primary)]">
              <Icon :icon="iconMoon" class="w-4 h-4 am-accent-text" />
              <span>睡眠定时</span>
            </div>
            <span v-if="player.sleepTimerBadge" class="text-[12px] font-semibold am-accent-text tabular-nums">
              {{ player.sleepTimerBadge }}
            </span>
          </div>
          <div class="grid grid-cols-5 gap-1.5">
            <button
              v-for="opt in sleepOptions"
              :key="opt.id"
              type="button"
              class="h-8 rounded-xl text-[12px] font-semibold border-0 am-tap transition-colors"
              :class="
                player.sleepTimerMode === opt.id
                  ? 'am-accent-bg text-white shadow-sm'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
              "
              @click="player.setSleepTimer(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Grouped Actions -->
        <div class="mt-3 rounded-[18px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)]">
          <button type="button" class="sheet-item am-tap" @click="playNow">
            <span>立即播放</span>
            <Icon :icon="iconPlayerPlay" class="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
          <button type="button" class="sheet-item am-tap" @click="playNext">
            <span>插队下一首播放</span>
            <Icon :icon="iconPlayerTrackNext" class="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
          <button type="button" class="sheet-item am-tap" @click="toggleFav">
            <span>{{ isFav ? '取消收藏“我喜欢”' : '收藏到“我喜欢”' }}</span>
            <Icon
              :icon="isFav ? iconHeartFilled : iconHeart"
              class="w-5 h-5"
              :class="isFav ? 'am-accent-text' : 'text-[var(--text-secondary)]'"
            />
          </button>
          <button type="button" class="sheet-item am-tap" @click="openUnblock">
            <span class="am-accent-text font-medium">换源 / 灰歌解灰</span>
            <Icon :icon="iconSparkles" class="w-5 h-5 am-accent-text" />
          </button>
          <button type="button" class="sheet-item am-tap" @click="copyTitle">
            <span>复制歌名与歌手</span>
            <Icon :icon="iconCopy" class="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        <button
          type="button"
          class="w-full mt-3 h-12 rounded-[16px] bg-[var(--bg-card)] border-0 text-[16px] font-semibold text-[var(--text-primary)] am-tap"
          @click="close"
        >
          取消
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet-item {
  width: 100%;
  height: 50px;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  font-size: 15px;
  color: var(--text-primary);
  text-align: left;
}
</style>
