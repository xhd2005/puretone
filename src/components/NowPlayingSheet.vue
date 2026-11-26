<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconPlayerTrackPrevFilled from '@iconify/icons-tabler/player-track-prev-filled';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconDots from '@iconify/icons-tabler/dots';
import iconMessageQuote from '@iconify/icons-tabler/blockquote';
import iconPlaylist from '@iconify/icons-tabler/playlist';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconRepeat from '@iconify/icons-tabler/repeat';
import iconRepeatOnce from '@iconify/icons-tabler/repeat-once';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconX from '@iconify/icons-tabler/x';
import iconMusic from '@iconify/icons-tabler/music';
import iconLanguage from '@iconify/icons-tabler/language';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import FluidCoverBackground from './FluidCoverBackground.vue';
import KrcLyricsView from './KrcLyricsView.vue';

const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();

const scrubbing = ref(false);
const scrubRatio = ref(0);
const dragOffsetY = ref(0);
let sheetTouchY = 0;

watch(
  () => ui.nowPlayingOpen,
  (open) => {
    settings.applyThemeClass(open);
    if (!open) dragOffsetY.value = 0;
  },
);

const progressRatio = computed(() => {
  if (scrubbing.value) return scrubRatio.value;
  if (!player.durationMs) return 0;
  return Math.max(0, Math.min(1, player.currentTimeMs / player.durationMs));
});

const displayElapsedMs = computed(() =>
  scrubbing.value ? Math.round(scrubRatio.value * player.durationMs) : player.currentTimeMs,
);

const displayRemainingMs = computed(() => Math.max(0, player.durationMs - displayElapsedMs.value));

function fmtTime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateScrubFromClientX(el: HTMLElement, clientX: number) {
  const rect = el.getBoundingClientRect();
  scrubRatio.value = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
}

function onScrubStart(e: TouchEvent | MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  scrubbing.value = true;
  const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
  updateScrubFromClientX(el, x);
}

function onScrubMove(e: TouchEvent | MouseEvent) {
  if (!scrubbing.value) return;
  const el = e.currentTarget as HTMLElement;
  const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
  updateScrubFromClientX(el, x);
}

function onScrubEnd() {
  if (!scrubbing.value) return;
  scrubbing.value = false;
  void player.seek(Math.round(scrubRatio.value * player.durationMs));
}

function onHandleTouchStart(e: TouchEvent) {
  sheetTouchY = e.touches[0]?.clientY ?? 0;
}
function onHandleTouchMove(e: TouchEvent) {
  const dy = (e.touches[0]?.clientY ?? 0) - sheetTouchY;
  dragOffsetY.value = Math.max(0, dy);
}
function onHandleTouchEnd() {
  if (dragOffsetY.value > 100) {
    ui.nowPlayingOpen = false;
  }
  dragOffsetY.value = 0;
}

function toggleMode(target: 'lyrics' | 'queue') {
  ui.nowPlayingMode = ui.nowPlayingMode === target ? 'cover' : target;
}

const playModeIcon = computed(() => {
  if (player.playMode === 'shuffle') return iconArrowsShuffle;
  if (player.playMode === 'repeat-one') return iconRepeatOnce;
  return iconRepeat;
});

const playModeLabel = computed(() => {
  if (player.playMode === 'shuffle') return '随机播放';
  if (player.playMode === 'repeat-one') return '单曲循环';
  if (player.playMode === 'fm') return '私人电台';
  return '列表循环';
});
</script>

<template>
  <Transition name="am-sheet">
    <div
      v-if="ui.nowPlayingOpen && player.currentSong"
      class="np-overlay"
      :style="dragOffsetY ? { transform: `translateY(${dragOffsetY}px)`, transition: 'none' } : undefined"
    >
      <FluidCoverBackground :active="ui.nowPlayingOpen" />

      <div class="np-content">
        <!-- Top drag pill (Apple Music dismiss handle) -->
        <div
          class="np-handle-area"
          @click="ui.nowPlayingOpen = false"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
        >
          <div class="np-handle" />
        </div>

        <!-- Compact Header in Lyrics / Queue mode -->
        <div v-if="ui.nowPlayingMode !== 'cover'" class="np-mini-header">
          <button
            type="button"
            class="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0"
            @click="ui.nowPlayingMode = 'cover'"
          >
            <div class="w-12 h-12 rounded-[9px] overflow-hidden shrink-0 shadow-lg bg-white/10">
              <img
                v-if="player.currentSong.coverUrl"
                :src="player.currentSong.coverUrl"
                class="w-full h-full object-cover"
                alt=""
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[16px] font-semibold text-white truncate">{{ player.currentSong.title }}</div>
              <div class="text-[14px] text-white/65 truncate">{{ player.currentSong.artist }}</div>
            </div>
          </button>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="ui.nowPlayingMode === 'lyrics' && player.lyrics.hasTranslation"
              type="button"
              class="np-circle-btn am-tap"
              :class="{ 'bg-white/25 text-white': settings.showTranslation }"
              aria-label="切换双语翻译"
              @click="settings.showTranslation = !settings.showTranslation"
            >
              <Icon :icon="iconLanguage" class="w-5 h-5" />
            </button>
            <button
              type="button"
              class="np-circle-btn am-tap"
              aria-label="更多操作"
              @click="ui.actionSheetSong = player.currentSong"
            >
              <Icon :icon="iconDots" class="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- MODE 1: AUTHENTIC APPLE MUSIC COVER MODE -->
        <div v-if="ui.nowPlayingMode === 'cover'" class="np-cover-stage">
          <div class="np-artwork-wrap">
            <div class="np-artwork" :class="player.isPlaying ? 'is-playing' : 'is-paused'">
              <img
                v-if="player.currentSong.coverUrl"
                :src="player.currentSong.coverUrl"
                :alt="player.currentSong.title"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center bg-white/10 text-white/40">
                <Icon :icon="iconMusic" class="w-20 h-20" />
              </div>
            </div>
          </div>

          <div class="np-meta-row">
            <div class="min-w-0 flex-1 pr-3">
              <h1 class="text-[22px] font-bold text-white truncate tracking-tight leading-snug">
                {{ player.currentSong.title }}
              </h1>
              <p class="text-[17px] text-white/65 truncate mt-0.5">
                {{ player.currentSong.artist }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                class="np-circle-btn am-tap"
                aria-label="收藏到我喜欢"
                @click="player.toggleFavorite(player.currentSong)"
              >
                <Icon
                  :icon="player.isCurrentFavorite ? iconHeartFilled : iconHeart"
                  class="w-[21px] h-[21px]"
                  :class="player.isCurrentFavorite ? 'text-[#ff375f]' : 'text-white/90'"
                />
              </button>
              <button
                type="button"
                class="np-circle-btn am-tap"
                aria-label="更多选项"
                @click="ui.actionSheetSong = player.currentSong"
              >
                <Icon :icon="iconDots" class="w-[21px] h-[21px] text-white/90" />
              </button>
            </div>
          </div>
        </div>

        <!-- MODE 2: APPLE MUSIC WORD-BY-WORD KRC LYRICS -->
        <div v-else-if="ui.nowPlayingMode === 'lyrics'" class="flex-1 min-h-0">
          <KrcLyricsView :active="ui.nowPlayingOpen && ui.nowPlayingMode === 'lyrics'" />
        </div>

        <!-- MODE 3: TRANSLUCENT UP NEXT QUEUE -->
        <div v-else class="flex-1 min-h-0 flex flex-col px-6 pt-3 pb-2">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h2 class="text-[17px] font-bold text-white">待播清单</h2>
              <p class="text-[12px] text-white/55">{{ player.queue.length }} 首歌曲 · {{ playModeLabel }}</p>
            </div>
            <button
              type="button"
              class="px-3.5 py-2 rounded-full bg-white/15 text-white text-[13px] font-medium flex items-center gap-1.5 am-tap border-0"
              @click="player.cyclePlayMode()"
            >
              <Icon :icon="playModeIcon" class="w-4 h-4" />
              <span>{{ playModeLabel }}</span>
            </button>
          </div>

          <div class="flex-1 am-scroll -mx-2 px-2 space-y-1">
            <div
              v-for="(item, idx) in player.queue"
              :key="`${item.id}-${idx}`"
              class="flex items-center gap-3 p-2 rounded-xl transition-colors"
              :class="idx === player.currentIndex ? 'bg-white/18' : 'active:bg-white/10'"
              @click="player.playQueue(player.queue, idx)"
            >
              <div class="w-11 h-11 rounded-[8px] overflow-hidden shrink-0 bg-white/10">
                <img v-if="item.coverUrl" :src="item.coverUrl" class="w-full h-full object-cover" alt="" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[15px] font-medium truncate" :class="idx === player.currentIndex ? 'text-white' : 'text-white/90'">
                  {{ item.title }}
                </div>
                <div class="text-[13px] text-white/55 truncate">{{ item.artist }}</div>
              </div>
              <button
                type="button"
                class="w-9 h-9 rounded-full flex items-center justify-center text-white/50 bg-transparent border-0 am-tap"
                aria-label="移出队列"
                @click.stop="player.removeFromQueue(idx)"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <!-- Scrubber & Transport Controls (always crisp in cover/lyrics/queue) -->
        <div class="np-controls" :class="{ 'is-compact': ui.nowPlayingMode !== 'cover' }">
          <!-- Scrub Bar -->
          <div class="px-1">
            <div
              class="scrub-hit"
              @touchstart.passive="onScrubStart"
              @touchmove.passive="onScrubMove"
              @touchend.passive="onScrubEnd"
              @mousedown="onScrubStart"
              @mousemove="onScrubMove"
              @mouseup="onScrubEnd"
              @mouseleave="onScrubEnd"
            >
              <div class="scrub-track" :class="{ 'is-scrubbing': scrubbing }">
                <div class="scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
              </div>
            </div>
            <div class="flex items-center justify-between text-[11px] font-medium text-white/55 tabular-nums mt-1.5">
              <span>{{ fmtTime(displayElapsedMs) }}</span>
              <span
                v-if="player.sourceTag"
                class="px-2 py-0.5 rounded-[5px] bg-white/12 text-white/80 text-[10px] font-semibold tracking-wide"
              >
                {{ player.sourceTag }}
              </span>
              <span>-{{ fmtTime(displayRemainingMs) }}</span>
            </div>
          </div>

          <!-- Transport Buttons -->
          <div class="np-transport">
            <button type="button" class="np-skip-btn am-tap" aria-label="上一首" @click="player.previous()">
              <Icon :icon="iconPlayerTrackPrevFilled" class="w-9 h-9" />
            </button>
            <button
              type="button"
              class="np-play-btn am-tap"
              :aria-label="player.isPlaying ? '暂停' : '播放'"
              @click="player.togglePlay()"
            >
              <Icon
                :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled"
                class="w-12 h-12"
              />
            </button>
            <button type="button" class="np-skip-btn am-tap" aria-label="下一首" @click="player.next()">
              <Icon :icon="iconPlayerTrackNextFilled" class="w-9 h-9" />
            </button>
          </div>

          <!-- Bottom 3 Apple Music Utility Icons -->
          <div class="np-footer-bar">
            <button
              type="button"
              class="np-tool-btn am-tap"
              :class="{ 'is-on': ui.nowPlayingMode === 'lyrics' }"
              aria-label="逐字歌词"
              @click="toggleMode('lyrics')"
            >
              <Icon :icon="iconMessageQuote" class="w-6 h-6" />
            </button>

            <button
              type="button"
              class="np-tool-btn am-tap"
              aria-label="换源与解灰"
              @click="ui.unblockModalSong = player.currentSong"
            >
              <Icon :icon="iconSparkles" class="w-6 h-6" />
            </button>

            <button
              type="button"
              class="np-tool-btn am-tap"
              :class="{ 'is-on': ui.nowPlayingMode === 'queue' }"
              aria-label="待播清单"
              @click="toggleMode('queue')"
            >
              <Icon :icon="iconPlaylist" class="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.np-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #ffffff;
}

.np-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: calc(var(--safe-top) + 6px);
  padding-bottom: calc(var(--safe-bottom) + 14px);
}

.np-handle-area {
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.np-handle {
  width: 38px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.36);
}

.np-mini-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 24px 10px;
  flex-shrink: 0;
}

.np-cover-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px 28px 18px;
}

.np-artwork-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
}

.np-artwork {
  width: min(82vw, 340px);
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transition: transform 480ms var(--spring-ease), box-shadow 480ms ease;
}

.np-artwork.is-playing {
  transform: scale(1);
  box-shadow: 0 28px 65px rgba(0, 0, 0, 0.52), 0 8px 20px rgba(0, 0, 0, 0.32);
}

.np-artwork.is-paused {
  transform: scale(0.84);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.36);
}

.np-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.np-circle-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-controls {
  padding: 0 28px 6px;
  flex-shrink: 0;
}

.np-controls.is-compact {
  padding-top: 8px;
}

.scrub-hit {
  padding: 10px 0 4px;
  cursor: pointer;
}

.scrub-track {
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  overflow: hidden;
  transition: height 180ms var(--spring-ease);
}

.scrub-track.is-scrubbing {
  height: 9px;
}

.scrub-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 999px;
}

.np-transport {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  margin: 18px 0 20px;
}

.np-controls.is-compact .np-transport {
  margin: 10px 0 12px;
}

.np-skip-btn,
.np-play-btn {
  border: 0;
  background: transparent;
  color: #ffffff;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-footer-bar {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding-top: 4px;
}

.np-tool-btn {
  width: 44px;
  height: 38px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 200ms ease, color 200ms ease;
}

.np-tool-btn.is-on {
  background: rgba(255, 255, 255, 0.88);
  color: #111111;
}
</style>
