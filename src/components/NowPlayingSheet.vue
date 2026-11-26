<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
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
import iconMoon from '@iconify/icons-tabler/moon';
import iconPhoto from '@iconify/icons-tabler/photo';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { echoSystem } from '@/native/echoSystem';
import FluidCoverBackground from './FluidCoverBackground.vue';
import KrcLyricsView from './KrcLyricsView.vue';

const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();

// Pointer-captured Scrubber state (works smoothly on BOTH Cover & Lyrics views!)
const scrubbing = ref(false);
const scrubRatio = ref(0);
let activeScrubPointerId: number | null = null;

// Lyrics 3s Auto-Immersive HUD state
const lyricsHudVisible = ref(true);
let lyricsHideTimer: ReturnType<typeof setTimeout> | null = null;

// Sheet Drag-to-Dismiss & Cover Swipe/Double-Tap state
const dragOffsetY = ref(0);
const coverSwipeX = ref(0);
const heartBurst = ref(false);
let sheetTouchY = 0;
let coverTouchStartX = 0;
let coverTouchStartY = 0;
let coverGestureAxis: 'none' | 'x' | 'y' = 'none';
let lastCoverTapAt = 0;
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;

function clearLyricsHideTimer() {
  if (lyricsHideTimer) {
    clearTimeout(lyricsHideTimer);
    lyricsHideTimer = null;
  }
}

function scheduleLyricsAutoHide() {
  clearLyricsHideTimer();
  if (ui.nowPlayingMode !== 'lyrics' || !ui.nowPlayingOpen) return;
  if (!player.isPlaying || scrubbing.value) return;
  lyricsHideTimer = setTimeout(() => {
    if (ui.nowPlayingMode === 'lyrics' && player.isPlaying && !scrubbing.value) {
      lyricsHudVisible.value = false;
    }
  }, 3000);
}

function revealLyricsHud(autoHide = true) {
  lyricsHudVisible.value = true;
  if (autoHide) scheduleLyricsAutoHide();
  else clearLyricsHideTimer();
}

function onLyricsUserScroll() {
  if (ui.nowPlayingMode === 'lyrics') {
    revealLyricsHud(true);
  }
}

function onLyricsTapBlank() {
  if (ui.nowPlayingMode !== 'lyrics') return;
  if (lyricsHudVisible.value) {
    clearLyricsHideTimer();
    lyricsHudVisible.value = false;
  } else {
    revealLyricsHud(true);
  }
}

const isLyricsImmersive = computed(() => ui.nowPlayingMode === 'lyrics' && !lyricsHudVisible.value);

const coverLyricsPreview = computed(() => {
  if (!settings.showCoverLyricsPreview) return null;
  const lines = player.lyrics.lines;
  if (!lines.length) return null;
  const t = player.currentTimeMs + 120;
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) {
    return {
      current: lines[0]?.text || '',
      next: lines[1]?.text || '',
      isIntro: true,
    };
  }
  return {
    current: lines[idx]?.text || '',
    next: lines[idx + 1]?.text || '',
    isIntro: false,
  };
});

watch(
  () => ui.nowPlayingOpen,
  (open) => {
    settings.applyThemeClass(open);
    if (!open) {
      dragOffsetY.value = 0;
      coverSwipeX.value = 0;
      clearLyricsHideTimer();
      lyricsHudVisible.value = true;
    } else if (ui.nowPlayingMode === 'lyrics') {
      revealLyricsHud(true);
    }
  },
);

watch(
  () => ui.nowPlayingMode,
  (mode) => {
    if (mode === 'lyrics') {
      revealLyricsHud(true);
    } else {
      clearLyricsHideTimer();
      lyricsHudVisible.value = true;
    }
  },
);

watch(
  () => player.isPlaying,
  (playing) => {
    if (ui.nowPlayingMode !== 'lyrics') return;
    if (!playing) {
      revealLyricsHud(false);
    } else {
      scheduleLyricsAutoHide();
    }
  },
);

onUnmounted(() => {
  clearLyricsHideTimer();
  if (heartBurstTimer) clearTimeout(heartBurstTimer);
});

// ---- Progress Computation ----

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

// ---- Pointer-Captured Scrubber (Zero conflict with lyrics scrolling!) ----

function updateScrubFromClientX(el: HTMLElement, clientX: number) {
  const rect = el.getBoundingClientRect();
  scrubRatio.value = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
}

function onScrubPointerDown(e: PointerEvent) {
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  activeScrubPointerId = e.pointerId;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // non-fatal
  }
  scrubbing.value = true;
  clearLyricsHideTimer();
  echoSystem.haptic('selection');
  updateScrubFromClientX(el, e.clientX);
}

function onScrubPointerMove(e: PointerEvent) {
  if (!scrubbing.value || e.pointerId !== activeScrubPointerId) return;
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  updateScrubFromClientX(el, e.clientX);
}

function finishScrub(e: PointerEvent, commit: boolean) {
  if (!scrubbing.value || e.pointerId !== activeScrubPointerId) return;
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  try {
    if (el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
  } catch {
    // ignore
  }
  activeScrubPointerId = null;
  scrubbing.value = false;
  if (commit && player.durationMs > 0) {
    echoSystem.haptic('light');
    void player.seek(Math.round(scrubRatio.value * player.durationMs));
  }
  scheduleLyricsAutoHide();
}

// ---- Top Handle Drag-to-Dismiss ----

function onHandleTouchStart(e: TouchEvent) {
  sheetTouchY = e.touches[0]?.clientY ?? 0;
}
function onHandleTouchMove(e: TouchEvent) {
  const dy = (e.touches[0]?.clientY ?? 0) - sheetTouchY;
  dragOffsetY.value = Math.max(0, dy);
}
function onHandleTouchEnd() {
  if (dragOffsetY.value > 95) {
    echoSystem.haptic('light');
    ui.nowPlayingOpen = false;
  }
  dragOffsetY.value = 0;
}

// ---- Intuitive Cover Gestures: Swipe Skip / Drag Down Dismiss / Double-Tap Heart ----

function onCoverTouchStart(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  coverTouchStartX = t.clientX;
  coverTouchStartY = t.clientY;
  coverGestureAxis = 'none';
}

function onCoverTouchMove(e: TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  const dx = t.clientX - coverTouchStartX;
  const dy = t.clientY - coverTouchStartY;

  if (coverGestureAxis === 'none') {
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      coverGestureAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    }
  }
  if (coverGestureAxis === 'x') {
    // Elastic horizontal swipe preview
    coverSwipeX.value = dx * 0.42;
  } else if (coverGestureAxis === 'y' && dy > 0) {
    dragOffsetY.value = dy * 0.85;
  }
}

function onCoverTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  const dx = (t?.clientX ?? coverTouchStartX) - coverTouchStartX;
  const dy = (t?.clientY ?? coverTouchStartY) - coverTouchStartY;

  if (coverGestureAxis === 'x') {
    if (dx < -58) {
      void player.next();
    } else if (dx > 58) {
      void player.previous();
    }
    coverSwipeX.value = 0;
  } else if (coverGestureAxis === 'y') {
    if (dragOffsetY.value > 95) {
      echoSystem.haptic('light');
      ui.nowPlayingOpen = false;
    }
    dragOffsetY.value = 0;
  } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    // Double-tap artwork to favorite with heart burst!
    const now = Date.now();
    if (now - lastCoverTapAt < 290 && player.currentSong) {
      lastCoverTapAt = 0;
      void player.toggleFavorite(player.currentSong);
      heartBurst.value = true;
      if (heartBurstTimer) clearTimeout(heartBurstTimer);
      heartBurstTimer = setTimeout(() => {
        heartBurst.value = false;
      }, 650);
    } else {
      lastCoverTapAt = now;
    }
  }
  coverGestureAxis = 'none';
}

function toggleMode(target: 'lyrics' | 'queue') {
  echoSystem.haptic('selection');
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

        <!-- Subtle Sleep Timer Pill (when active in cover mode) -->
        <div
          v-if="player.sleepTimerBadge && ui.nowPlayingMode === 'cover'"
          class="flex justify-center pb-1 shrink-0"
        >
          <button
            type="button"
            class="lg-fluid-btn px-3 py-1 rounded-full text-[11px] font-semibold text-white/90 inline-flex items-center gap-1 am-tap"
            @click="ui.actionSheetSong = player.currentSong"
          >
            <Icon :icon="iconMoon" class="w-3.5 h-3.5" />
            <span class="tabular-nums">{{ player.sleepTimerBadge }}</span>
          </button>
        </div>

        <!-- Compact Header in Lyrics / Queue mode -->
        <div v-if="ui.nowPlayingMode !== 'cover'" class="np-mini-header">
          <button
            type="button"
            class="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0"
            @click="ui.nowPlayingMode = 'cover'"
          >
            <div class="w-12 h-12 rounded-[10px] overflow-hidden shrink-0 shadow-lg bg-white/10">
              <img
                v-if="player.currentSong.coverUrl"
                :src="player.currentSong.coverUrl"
                class="w-full h-full object-cover"
                alt=""
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[16px] font-semibold text-white truncate">{{ player.currentSong.title }}</div>
              <div class="text-[13px] text-white/65 truncate flex items-center gap-1.5">
                <span class="truncate">{{ player.currentSong.artist }}</span>
                <span
                  v-if="player.sleepTimerBadge"
                  class="px-1.5 py-0.5 rounded-full bg-white/15 text-[10px] font-semibold text-white/90 tabular-nums shrink-0 inline-flex items-center gap-0.5"
                >
                  <Icon :icon="iconMoon" class="w-2.5 h-2.5" />
                  {{ player.sleepTimerBadge }}
                </span>
              </div>
            </div>
          </button>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="ui.nowPlayingMode === 'lyrics'"
              type="button"
              class="np-circle-btn lg-fluid-btn am-tap"
              aria-label="生成歌词海报"
              @click="ui.lyricPosterSong = player.currentSong"
            >
              <Icon :icon="iconPhoto" class="w-5 h-5" />
            </button>
            <button
              v-if="ui.nowPlayingMode === 'lyrics' && player.lyrics.hasTranslation"
              type="button"
              class="np-circle-btn lg-fluid-btn am-tap"
              :class="{ '!bg-white/30 !text-white': settings.showTranslation }"
              aria-label="切换双语翻译"
              @click="settings.showTranslation = !settings.showTranslation; echoSystem.haptic('selection')"
            >
              <Icon :icon="iconLanguage" class="w-5 h-5" />
            </button>
            <button
              type="button"
              class="np-circle-btn lg-fluid-btn am-tap"
              aria-label="更多操作"
              @click="ui.actionSheetSong = player.currentSong"
            >
              <Icon :icon="iconDots" class="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- MODE 1: AUTHENTIC APPLE MUSIC + LIQUID GLASS COVER MODE -->
        <div
          v-if="ui.nowPlayingMode === 'cover'"
          class="np-cover-stage"
          @touchstart.passive="onCoverTouchStart"
          @touchmove.passive="onCoverTouchMove"
          @touchend.passive="onCoverTouchEnd"
        >
          <div class="np-artwork-wrap">
            <div
              class="np-artwork"
              :class="player.isPlaying ? 'is-playing' : 'is-paused'"
              :style="coverSwipeX ? { transform: `translateX(${coverSwipeX}px) scale(0.96)`, transition: 'none' } : undefined"
            >
              <img
                v-if="player.currentSong.coverUrl"
                :src="player.currentSong.coverUrl"
                :alt="player.currentSong.title"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center bg-white/10 text-white/40">
                <Icon :icon="iconMusic" class="w-20 h-20" />
              </div>

              <!-- Double-Tap Heart Burst -->
              <Transition name="heart-pop">
                <div v-if="heartBurst" class="heart-burst-overlay">
                  <Icon :icon="iconHeartFilled" class="w-20 h-20 text-[#ff375f] drop-shadow-2xl" />
                </div>
              </Transition>
            </div>
          </div>

          <!-- Cover Page 2-Line Live Lyrics Preview (Tap to enter full-screen KRC lyrics) -->
          <button
            v-if="coverLyricsPreview"
            type="button"
            class="np-cover-lyrics am-tap"
            @click.stop="toggleMode('lyrics')"
          >
            <div
              class="text-[14px] leading-snug truncate transition-colors"
              :class="coverLyricsPreview.isIntro ? 'text-white/62 font-medium' : 'text-white/94 font-semibold'"
            >
              {{ coverLyricsPreview.current }}
            </div>
            <div v-if="coverLyricsPreview.next" class="text-[12px] leading-snug text-white/46 truncate mt-0.5">
              {{ coverLyricsPreview.next }}
            </div>
          </button>

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
                class="np-circle-btn lg-fluid-btn am-tap"
                aria-label="收藏到我喜欢"
                @click="player.toggleFavorite(player.currentSong)"
              >
                <Icon
                  :icon="player.isCurrentFavorite ? iconHeartFilled : iconHeart"
                  class="w-[21px] h-[21px]"
                  :class="player.isCurrentFavorite ? 'text-[#ff375f]' : 'text-white/95'"
                />
              </button>
              <button
                type="button"
                class="np-circle-btn lg-fluid-btn am-tap"
                aria-label="更多选项"
                @click="ui.actionSheetSong = player.currentSong"
              >
                <Icon :icon="iconDots" class="w-[21px] h-[21px] text-white/95" />
              </button>
            </div>
          </div>
        </div>

        <!-- MODE 2: APPLE MUSIC WORD-BY-WORD KRC LYRICS (Instant Sync + Auto-Immersive!) -->
        <div v-else-if="ui.nowPlayingMode === 'lyrics'" class="flex-1 min-h-0 relative">
          <KrcLyricsView
            :active="ui.nowPlayingOpen && ui.nowPlayingMode === 'lyrics'"
            @user-scroll="onLyricsUserScroll"
            @tap-blank="onLyricsTapBlank"
            @line-seek="scheduleLyricsAutoHide"
          />
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
              class="lg-fluid-btn px-3.5 py-2 rounded-full text-white text-[13px] font-medium flex items-center gap-1.5 am-tap"
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
              <div class="w-11 h-11 rounded-[9px] overflow-hidden shrink-0 bg-white/10">
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

        <!-- Scrubber & Transport Controls (Smoothly auto-hides in Immersive Lyrics Mode!) -->
        <div
          class="np-controls"
          :class="{
            'is-compact': ui.nowPlayingMode !== 'cover',
            'is-immersive-hidden': isLyricsImmersive,
          }"
        >
          <!-- Pointer-Captured Scrub Bar -->
          <div class="px-1">
            <div
              class="scrub-hit"
              @pointerdown="onScrubPointerDown"
              @pointermove="onScrubPointerMove"
              @pointerup="finishScrub($event, true)"
              @pointercancel="finishScrub($event, false)"
            >
              <div class="scrub-track" :class="{ 'is-scrubbing': scrubbing }">
                <div class="scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
              </div>
            </div>
            <div
              class="flex items-center justify-between text-[11px] font-medium tabular-nums mt-0.5 transition-colors"
              :class="scrubbing ? 'text-white' : 'text-white/58'"
            >
              <span>{{ fmtTime(displayElapsedMs) }}</span>
              <span
                v-if="player.sourceTag"
                class="px-2 py-0.5 rounded-[6px] bg-white/14 text-white/88 text-[10px] font-semibold tracking-wide"
              >
                {{ player.sourceTag }}
              </span>
              <span>-{{ fmtTime(displayRemainingMs) }}</span>
            </div>
          </div>

          <!-- Transport Buttons -->
          <div class="np-transport">
            <button type="button" class="np-skip-btn am-tap" aria-label="上一首" @click="player.previous(); scheduleLyricsAutoHide()">
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
            <button type="button" class="np-skip-btn am-tap" aria-label="下一首" @click="player.next(); scheduleLyricsAutoHide()">
              <Icon :icon="iconPlayerTrackNextFilled" class="w-9 h-9" />
            </button>
          </div>

          <!-- Bottom 3 Liquid Glass Utility Icons -->
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
  padding-bottom: calc(var(--safe-bottom) + 12px);
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
  width: 40px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
}

.np-mini-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 24px 8px;
  flex-shrink: 0;
}

.np-cover-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 28px 16px;
}

.np-artwork-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
}

.np-artwork {
  position: relative;
  width: min(79vw, 336px);
  max-height: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transition: transform 480ms var(--spring-ease), box-shadow 480ms ease;
}

.np-cover-lyrics {
  display: block;
  width: 100%;
  text-align: center;
  background: transparent;
  border: 0;
  padding: 6px 8px 2px;
  margin-top: 4px;
  flex-shrink: 0;
}

.np-artwork.is-playing {
  transform: scale(1);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.54), 0 8px 22px rgba(0, 0, 0, 0.32);
}

.np-artwork.is-paused {
  transform: scale(0.84);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.36);
}

.heart-burst-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.16);
  pointer-events: none;
}

.heart-pop-enter-active {
  animation: heart-pop-kf 620ms var(--spring-ease);
}
.heart-pop-leave-active {
  transition: opacity 180ms ease;
}
.heart-pop-leave-to {
  opacity: 0;
}
@keyframes heart-pop-kf {
  0% { opacity: 0; transform: scale(0.45); }
  45% { opacity: 1; transform: scale(1.14); }
  100% { opacity: 0.96; transform: scale(1); }
}

.np-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.np-circle-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-controls {
  position: relative;
  z-index: 25;
  padding: 0 28px 6px;
  flex-shrink: 0;
  max-height: 260px;
  opacity: 1;
  transform: translateY(0);
  transition:
    max-height 400ms var(--spring-ease),
    opacity 260ms ease,
    transform 380ms var(--spring-ease),
    padding 380ms var(--spring-ease);
}

.np-controls.is-compact {
  padding-top: 4px;
}

.np-controls.is-immersive-hidden {
  max-height: 0;
  opacity: 0;
  transform: translateY(28px);
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
  pointer-events: none;
}

.scrub-hit {
  position: relative;
  z-index: 30;
  padding: 16px 0 10px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}

.scrub-track {
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
  transition: height 180ms var(--spring-ease), box-shadow 180ms ease;
}

.scrub-track.is-scrubbing {
  height: 10px;
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.28);
}

.scrub-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 999px;
}

.np-transport {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  margin: 14px 0 16px;
}

.np-controls.is-compact .np-transport {
  margin: 8px 0 10px;
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
  width: 46px;
  height: 38px;
  border-radius: 12px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.68);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 220ms ease, color 220ms ease, box-shadow 220ms ease;
}

.np-tool-btn.is-on {
  background: rgba(255, 255, 255, 0.92);
  color: #111111;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
}
</style>
