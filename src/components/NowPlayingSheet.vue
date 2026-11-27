<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconPlayerTrackPrevFilled from '@iconify/icons-tabler/player-track-prev-filled';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconDots from '@iconify/icons-tabler/dots';
import iconMessageQuote from '@iconify/icons-tabler/blockquote';
import iconMessageCircle from '@iconify/icons-tabler/message-circle';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
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
import iconPlayerTrackNext from '@iconify/icons-tabler/player-track-next';
import iconTrash from '@iconify/icons-tabler/trash';
import type { SongClimaxRange } from '@/types/music';
import { formatCompactCount, kugouApi } from '@/services/kugou/kugouEngine';
import { openArtistProfileFromSong } from '@/services/playback/artistNavigation';
import {
  computeHeroFlipTransform,
  computeMetaGlideTransform,
  HERO_MORPH_EASING,
  type BoxRect,
} from '@/utils/heroMorph';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import FluidCoverBackground from './FluidCoverBackground.vue';
import KrcLyricsView from './KrcLyricsView.vue';

const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { t, effectiveLocale } = useI18n();

// Track extras: Comment Count badge & Chorus Climax marker
const commentCount = ref(0);
const climaxRange = ref<SongClimaxRange | null>(null);
const showLyricOffsetBar = ref(false);

// Shared-Element Hero Morph refs & animation handles
const coverArtworkRef = ref<HTMLElement | null>(null);
const coverMetaRef = ref<HTMLElement | null>(null);
const miniThumbRef = ref<HTMLElement | null>(null);
const miniMetaRef = ref<HTMLElement | null>(null);
const stageTransitionName = ref<'np-to-detail' | 'np-to-cover' | 'np-cross-depth'>('np-to-detail');
const morphHideLeavingCover = ref(false);
const morphHideLeavingMini = ref(false);
let activeArtworkAnim: Animation | null = null;
let activeMetaAnim: Animation | null = null;
let morphCleanupTimer: ReturnType<typeof setTimeout> | null = null;

function snapshotRect(el: HTMLElement | null): BoxRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function cancelActiveMorph() {
  if (activeArtworkAnim) {
    try {
      activeArtworkAnim.cancel();
    } catch {
      // ignore
    }
    activeArtworkAnim = null;
  }
  if (activeMetaAnim) {
    try {
      activeMetaAnim.cancel();
    } catch {
      // ignore
    }
    activeMetaAnim = null;
  }
  if (morphCleanupTimer) {
    clearTimeout(morphCleanupTimer);
    morphCleanupTimer = null;
  }
}

async function switchModeWithMorph(target: 'cover' | 'lyrics' | 'queue') {
  const fromMode = ui.nowPlayingMode;
  if (fromMode === target) return;

  const leavingCover = fromMode === 'cover';
  const enteringCover = target === 'cover';
  const needsHeroMorph = leavingCover !== enteringCover;

  // Capture LIVE mid-flight rects BEFORE cancelling previous animation for 100% interruptible physics!
  const fromArtRect = needsHeroMorph
    ? snapshotRect(leavingCover ? coverArtworkRef.value : miniThumbRef.value)
    : null;
  const fromMetaRect = needsHeroMorph
    ? snapshotRect(leavingCover ? coverMetaRef.value : miniMetaRef.value)
    : null;

  cancelActiveMorph();

  if (leavingCover) {
    stageTransitionName.value = 'np-to-detail';
    morphHideLeavingCover.value = true;
    morphHideLeavingMini.value = false;
  } else if (enteringCover) {
    stageTransitionName.value = 'np-to-cover';
    morphHideLeavingCover.value = false;
    morphHideLeavingMini.value = true;
  } else {
    stageTransitionName.value = 'np-cross-depth';
    morphHideLeavingCover.value = false;
    morphHideLeavingMini.value = false;
  }

  ui.nowPlayingMode = target;

  if (!needsHeroMorph || !fromArtRect) {
    return;
  }

  await nextTick();

  const targetArtEl = enteringCover ? coverArtworkRef.value : miniThumbRef.value;
  const targetMetaEl = enteringCover ? coverMetaRef.value : miniMetaRef.value;

  if (targetArtEl && typeof targetArtEl.animate === 'function') {
    const toArtRect = snapshotRect(targetArtEl);
    if (toArtRect) {
      const restScale = enteringCover ? (player.isPlaying ? 1 : 0.84) : 1;
      const plan = computeHeroFlipTransform(fromArtRect, toArtRect, {
        fromRadiusPx: leavingCover ? 18 : 10,
        toRadiusPx: enteringCover ? 18 : 10,
        targetRestScale: restScale,
      });
      if (plan) {
        activeArtworkAnim = targetArtEl.animate(
          [
            {
              transform: plan.fromTransform,
              borderRadius: plan.fromBorderRadius,
              boxShadow: leavingCover
                ? '0 26px 60px rgba(0, 0, 0, 0.48)'
                : '0 8px 20px rgba(0, 0, 0, 0.30)',
            },
            {
              transform: plan.toTransform,
              borderRadius: plan.toBorderRadius,
              boxShadow: enteringCover
                ? player.isPlaying
                  ? '0 30px 70px rgba(0, 0, 0, 0.54), 0 8px 22px rgba(0, 0, 0, 0.32)'
                  : '0 12px 28px rgba(0, 0, 0, 0.36)'
                : '0 8px 18px rgba(0, 0, 0, 0.32)',
            },
          ],
          {
            duration: enteringCover ? 480 : 460,
            easing: HERO_MORPH_EASING,
            fill: 'none',
          },
        );
        activeArtworkAnim.onfinish = () => {
          activeArtworkAnim = null;
        };
      }
    }
  }

  if (fromMetaRect && targetMetaEl && typeof targetMetaEl.animate === 'function') {
    const toMetaRect = snapshotRect(targetMetaEl);
    if (toMetaRect) {
      const glide = computeMetaGlideTransform(fromMetaRect, toMetaRect);
      if (glide) {
        activeMetaAnim = targetMetaEl.animate(
          [
            { transform: glide.fromTransform, opacity: 0.65 },
            { transform: glide.toTransform, opacity: 1 },
          ],
          {
            duration: 440,
            easing: HERO_MORPH_EASING,
            fill: 'none',
          },
        );
        activeMetaAnim.onfinish = () => {
          activeMetaAnim = null;
        };
      }
    }
  }

  morphCleanupTimer = setTimeout(() => {
    morphHideLeavingCover.value = false;
    morphHideLeavingMini.value = false;
    morphCleanupTimer = null;
  }, 500);
}

const currentTrackOffsetKey = computed(() => {
  const s = player.currentSong;
  return s ? (s.hash ? s.hash.toLowerCase() : s.id) : '';
});

const currentLyricOffsetMs = computed(() => settings.getLyricOffset(currentTrackOffsetKey.value));
const lyricOffsetLabel = computed(() => {
  const sec = currentLyricOffsetMs.value / 1000;
  if (sec === 0) return '0.0s';
  return `${sec > 0 ? '+' : ''}${sec.toFixed(1)}s`;
});

let extrasSeq = 0;
watch(
  () => [player.currentSong?.hash, player.currentSong?.mixSongId, ui.nowPlayingOpen],
  async ([hash, mixId, open]) => {
    if (!open || !player.currentSong) return;
    const seq = ++extrasSeq;
    commentCount.value = 0;
    climaxRange.value = null;
    const s = player.currentSong;
    const durMs = player.durationMs || (s.duration ? s.duration * 1000 : 0);
    const [cnt, clx] = await Promise.all([
      kugouApi.getSongCommentCount({ hash: String(hash || ''), mixSongId: Number(mixId || 0) || undefined }).catch(() => 0),
      hash ? kugouApi.getSongClimax(String(hash), durMs).catch(() => null) : Promise.resolve(null),
    ]);
    if (seq !== extrasSeq) return;
    commentCount.value = cnt;
    climaxRange.value = clx;
  },
  { immediate: true },
);

const climaxBarStyle = computed(() => {
  const clx = climaxRange.value;
  const dur = player.durationMs;
  if (!clx || dur <= 0) return null;
  const startPct = Math.max(0, Math.min(98, (clx.startMs / dur) * 100));
  const endPct = Math.max(startPct + 2, Math.min(100, (clx.endMs / dur) * 100));
  return {
    left: `${startPct.toFixed(2)}%`,
    width: `${(endPct - startPct).toFixed(2)}%`,
  };
});

const showChorusJump = computed(() => {
  const clx = climaxRange.value;
  if (!clx || !player.durationMs) return false;
  return player.currentTimeMs < clx.startMs - 2000;
});

function jumpToChorus() {
  const clx = climaxRange.value;
  if (!clx) return;
  echoSystem.haptic('medium');
  void player.seek(clx.startMs);
}

function nudgeLyricOffset(deltaMs: number) {
  const key = currentTrackOffsetKey.value;
  if (!key) return;
  echoSystem.haptic('selection');
  settings.adjustLyricOffset(key, deltaMs);
}

function resetLyricOffset() {
  const key = currentTrackOffsetKey.value;
  if (!key) return;
  echoSystem.haptic('light');
  settings.resetLyricOffset(key);
  ui.showToast(t('np.lyricOffsetReset'));
}

async function openCurrentArtist() {
  const s = player.currentSong;
  if (!s) return;
  echoSystem.haptic('light');
  await openArtistProfileFromSong(s, router, ui, {
    resolving: t('artist.resolving'),
    notFound: t('artist.notFound'),
  });
}

// Pointer-captured Scrubber state (works smoothly on BOTH Cover & Lyrics views!)
const scrubbing = ref(false);
const scrubRatio = ref(0);
let activeScrubPointerId: number | null = null;

// Lyrics 3s Auto-Immersive HUD state
const lyricsHudVisible = ref(true);
let lyricsHideTimer: ReturnType<typeof setTimeout> | null = null;

// Sheet Drag-to-Dismiss & Cover Swipe/Double-Tap state (with spring rebound!)
const dragOffsetY = ref(0);
const isDraggingSheet = ref(false);
const coverSwipeX = ref(0);
const isSwipingCover = ref(false);
const heartBurst = ref(false);
let sheetTouchY = 0;
let coverTouchStartX = 0;
let coverTouchStartY = 0;
let coverGestureAxis: 'none' | 'x' | 'y' = 'none';
let lastCoverTapAt = 0;
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;

const overlayDragStyle = computed(() => {
  if (dragOffsetY.value <= 0) return undefined;
  const radius = Math.min(30, Math.round(dragOffsetY.value * 0.28));
  return {
    transform: `translate3d(0, ${dragOffsetY.value}px, 0)`,
    borderRadius: `${radius}px`,
    transition: isDraggingSheet.value ? 'none' : undefined,
  };
});

const artworkSwipeStyle = computed(() => {
  if (!coverSwipeX.value) return undefined;
  const tilt = Math.max(-5, Math.min(5, coverSwipeX.value * 0.032));
  return {
    transform: `translate3d(${coverSwipeX.value}px, 0, 0) rotate(${tilt.toFixed(2)}deg) scale(0.95)`,
    transition: isSwipingCover.value ? 'none' : undefined,
  };
});

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
      cancelActiveMorph();
      morphHideLeavingCover.value = false;
      morphHideLeavingMini.value = false;
      isDraggingSheet.value = false;
      isSwipingCover.value = false;
      dragOffsetY.value = 0;
      coverSwipeX.value = 0;
      showLyricOffsetBar.value = false;
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
      showLyricOffsetBar.value = false;
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
  cancelActiveMorph();
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

// ---- Top Handle Drag-to-Dismiss (with Spring Rebound!) ----

function onHandleTouchStart(e: TouchEvent) {
  sheetTouchY = e.touches[0]?.clientY ?? 0;
  isDraggingSheet.value = true;
}
function onHandleTouchMove(e: TouchEvent) {
  const dy = (e.touches[0]?.clientY ?? 0) - sheetTouchY;
  dragOffsetY.value = Math.max(0, dy);
}
function onHandleTouchEnd() {
  isDraggingSheet.value = false;
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
      if (coverGestureAxis === 'x') isSwipingCover.value = true;
      else if (coverGestureAxis === 'y' && dy > 0) isDraggingSheet.value = true;
    }
  }
  if (coverGestureAxis === 'x') {
    coverSwipeX.value = dx * 0.42;
  } else if (coverGestureAxis === 'y' && dy > 0) {
    isDraggingSheet.value = true;
    dragOffsetY.value = dy * 0.85;
  }
}

function onCoverTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0];
  const dx = (t?.clientX ?? coverTouchStartX) - coverTouchStartX;
  const dy = (t?.clientY ?? coverTouchStartY) - coverTouchStartY;

  isSwipingCover.value = false;
  isDraggingSheet.value = false;

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
  void switchModeWithMorph(ui.nowPlayingMode === target ? 'cover' : target);
}

function returnToCover() {
  echoSystem.haptic('selection');
  void switchModeWithMorph('cover');
}

const playModeIcon = computed(() => {
  if (player.playMode === 'shuffle') return iconArrowsShuffle;
  if (player.playMode === 'repeat-one') return iconRepeatOnce;
  return iconRepeat;
});

const playModeLabel = computed(() => {
  if (player.playMode === 'shuffle') return t('np.mode.shuffle');
  if (player.playMode === 'repeat-one') return t('np.mode.repeatOne');
  if (player.playMode === 'fm') return t('np.mode.fm');
  return t('np.mode.sequence');
});

function handleClearQueue() {
  player.clearQueue();
  ui.nowPlayingOpen = false;
  ui.showToast(t('np.queueCleared'));
}
</script>

<template>
  <Transition name="am-sheet">
    <div
      v-if="ui.nowPlayingOpen && player.currentSong"
      class="np-overlay"
      :class="{ 'is-dragging': isDraggingSheet }"
      :style="overlayDragStyle"
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
        <Transition name="am-expand">
          <div
            v-if="player.sleepTimerBadge && ui.nowPlayingMode === 'cover'"
            class="flex justify-center pb-1 shrink-0"
          >
            <button
              type="button"
              class="lg-fluid-btn px-3 py-1 rounded-full text-[11px] font-semibold text-white/90 inline-flex items-center gap-1 am-tap"
              @click="ui.openSongActions(player.currentSong)"
            >
              <Icon :icon="iconMoon" class="w-3.5 h-3.5" />
              <span class="tabular-nums">{{ player.sleepTimerBadge }}</span>
            </button>
          </div>
        </Transition>

        <!-- Compact Header in Lyrics / Queue mode (Shared-Element Destination!) -->
        <Transition name="np-header-fade">
          <div v-if="ui.nowPlayingMode !== 'cover'" class="np-mini-header">
            <button
              type="button"
              class="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0"
              @click="returnToCover"
            >
              <div
                ref="miniThumbRef"
                class="np-mini-thumb"
                :class="{ 'is-morph-hidden': morphHideLeavingMini }"
              >
                <Transition name="art-xfade">
                  <img
                    v-if="player.currentSong.coverUrl"
                    :key="player.currentSong.coverUrl"
                    :src="player.currentSong.coverUrl"
                    class="art-layer w-full h-full object-cover"
                    alt=""
                  />
                  <div
                    v-else
                    key="mini-fallback"
                    class="art-layer w-full h-full flex items-center justify-center bg-white/10 text-white/40"
                  >
                    <Icon :icon="iconMusic" class="w-5 h-5" />
                  </div>
                </Transition>
              </div>
              <div ref="miniMetaRef" class="min-w-0 flex-1">
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

            <div class="np-mini-actions flex items-center gap-1.5 shrink-0">
              <button
                v-if="ui.nowPlayingMode === 'lyrics'"
                type="button"
                class="lg-fluid-btn h-9 px-2.5 rounded-full text-[11px] font-semibold text-white/90 tabular-nums am-tap"
                :class="{ '!bg-white/30 !text-white': showLyricOffsetBar || currentLyricOffsetMs !== 0 }"
                @click="showLyricOffsetBar = !showLyricOffsetBar; echoSystem.haptic('selection')"
              >
                {{ currentLyricOffsetMs !== 0 ? lyricOffsetLabel : t('np.lyricOffset') }}
              </button>
              <button
                v-if="ui.nowPlayingMode === 'lyrics'"
                type="button"
                class="np-circle-btn lg-fluid-btn am-tap"
                :aria-label="t('song.poster')"
                @click="ui.lyricPosterSong = player.currentSong"
              >
                <Icon :icon="iconPhoto" class="w-5 h-5" />
              </button>
              <button
                v-if="ui.nowPlayingMode === 'lyrics' && player.lyrics.hasTranslation"
                type="button"
                class="np-circle-btn lg-fluid-btn am-tap"
                :class="{ '!bg-white/30 !text-white': settings.showTranslation }"
                aria-label="Toggle translation"
                @click="settings.showTranslation = !settings.showTranslation; echoSystem.haptic('selection')"
              >
                <Icon :icon="iconLanguage" class="w-5 h-5" />
              </button>
              <button
                type="button"
                class="np-circle-btn lg-fluid-btn am-tap"
                aria-label="More options"
                @click="ui.openSongActions(player.currentSong)"
              >
                <Icon :icon="iconDots" class="w-5 h-5" />
              </button>
            </div>
          </div>
        </Transition>

        <!-- Inline Lyrics Timeline Offset Adjuster (±0.5s, per-track persisted!) -->
        <Transition name="am-expand">
          <div
            v-if="ui.nowPlayingMode === 'lyrics' && showLyricOffsetBar"
            class="px-6 pb-2 flex items-center justify-center gap-2 shrink-0"
          >
            <button
              type="button"
              class="lg-fluid-btn h-7 px-3 rounded-full text-[11.5px] font-semibold text-white tabular-nums am-tap"
              @click="nudgeLyricOffset(-500)"
            >
              -0.5s
            </button>
            <button
              type="button"
              class="lg-fluid-btn h-7 px-3.5 rounded-full text-[11.5px] font-bold text-white/95 tabular-nums am-tap"
              @click="resetLyricOffset"
            >
              {{ t('np.lyricOffset') }} {{ lyricOffsetLabel }}
            </button>
            <button
              type="button"
              class="lg-fluid-btn h-7 px-3 rounded-full text-[11.5px] font-semibold text-white tabular-nums am-tap"
              @click="nudgeLyricOffset(500)"
            >
              +0.5s
            </button>
          </div>
        </Transition>

        <!-- Overlapping Stage Host for Smooth Cover <-> Lyrics <-> Queue Transitions -->
        <div class="np-stage-host">
          <Transition :name="stageTransitionName">
            <!-- MODE 1: AUTHENTIC APPLE MUSIC + LIQUID GLASS COVER MODE -->
            <div
              v-if="ui.nowPlayingMode === 'cover'"
              key="stage-cover"
              class="np-stage-pane np-cover-stage"
              @touchstart.passive="onCoverTouchStart"
              @touchmove.passive="onCoverTouchMove"
              @touchend.passive="onCoverTouchEnd"
            >
              <div class="np-artwork-wrap">
                <div
                  ref="coverArtworkRef"
                  class="np-artwork"
                  :class="[
                    player.isPlaying ? 'is-playing' : 'is-paused',
                    { 'is-morph-hidden': morphHideLeavingCover },
                  ]"
                  :style="artworkSwipeStyle"
                >
                  <Transition name="art-xfade">
                    <img
                      v-if="player.currentSong.coverUrl"
                      :key="player.currentSong.coverUrl"
                      :src="player.currentSong.coverUrl"
                      :alt="player.currentSong.title"
                      class="art-layer w-full h-full object-cover"
                    />
                    <div
                      v-else
                      key="cover-fallback"
                      class="art-layer w-full h-full flex items-center justify-center bg-white/10 text-white/40"
                    >
                      <Icon :icon="iconMusic" class="w-20 h-20" />
                    </div>
                  </Transition>

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
                  class="text-[14px] leading-snug truncate transition-colors duration-300"
                  :class="coverLyricsPreview.isIntro ? 'text-white/62 font-medium' : 'text-white/94 font-semibold'"
                >
                  {{ coverLyricsPreview.current }}
                </div>
                <div v-if="coverLyricsPreview.next" class="text-[12px] leading-snug text-white/46 truncate mt-0.5">
                  {{ coverLyricsPreview.next }}
                </div>
              </button>

              <div class="np-meta-row">
                <div ref="coverMetaRef" class="min-w-0 flex-1 pr-3">
                  <h1 class="text-[22px] font-bold text-white truncate tracking-tight leading-snug">
                    {{ player.currentSong.title }}
                  </h1>
                  <button
                    type="button"
                    class="mt-0.5 max-w-full inline-flex items-center gap-0.5 bg-transparent border-0 p-0 text-[16px] text-white/70 active:text-white transition-colors text-left"
                    @click.stop="openCurrentArtist"
                  >
                    <span class="truncate">{{ player.currentSong.artist }}</span>
                    <Icon :icon="iconChevronRight" class="w-4 h-4 opacity-60 shrink-0" />
                  </button>
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
                      class="w-[21px] h-[21px] transition-transform duration-200"
                      :class="player.isCurrentFavorite ? 'text-[#ff375f] scale-110' : 'text-white/95'"
                    />
                  </button>
                  <button
                    type="button"
                    class="np-circle-btn lg-fluid-btn am-tap"
                    aria-label="更多选项"
                    @click="ui.openSongActions(player.currentSong)"
                  >
                    <Icon :icon="iconDots" class="w-[21px] h-[21px] text-white/95" />
                  </button>
                </div>
              </div>
            </div>

            <!-- MODE 2: APPLE MUSIC WORD-BY-WORD KRC LYRICS (Instant Sync + Auto-Immersive!) -->
            <div v-else-if="ui.nowPlayingMode === 'lyrics'" key="stage-lyrics" class="np-stage-pane">
              <KrcLyricsView
                :active="ui.nowPlayingOpen && ui.nowPlayingMode === 'lyrics'"
                @user-scroll="onLyricsUserScroll"
                @tap-blank="onLyricsTapBlank"
                @line-seek="scheduleLyricsAutoHide"
              />
            </div>

            <!-- MODE 3: TRANSLUCENT UP NEXT QUEUE (with Pin-Next & Clear Queue!) -->
            <div v-else key="stage-queue" class="np-stage-pane flex flex-col px-6 pt-3 pb-2">
              <div class="flex items-center justify-between gap-2 mb-3">
                <div class="min-w-0">
                  <h2 class="text-[17px] font-bold text-white">{{ t('np.upNext') }}</h2>
                  <p class="text-[12px] text-white/55 truncate">
                    {{ t('np.queueMeta', { count: player.queue.length, mode: playModeLabel }) }}
                  </p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    class="lg-fluid-btn px-3 py-1.5 rounded-full text-white text-[12px] font-medium flex items-center gap-1.5 am-tap"
                    @click="player.cyclePlayMode()"
                  >
                    <Icon :icon="playModeIcon" class="w-4 h-4" />
                    <span>{{ playModeLabel }}</span>
                  </button>
                  <button
                    type="button"
                    class="lg-fluid-btn w-8 h-8 rounded-full text-white/80 flex items-center justify-center am-tap"
                    :aria-label="t('np.clearQueue')"
                    @click="handleClearQueue"
                  >
                    <Icon :icon="iconTrash" class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div class="flex-1 am-scroll -mx-2 px-2 space-y-1">
                <div
                  v-for="(item, idx) in player.queue"
                  :key="`${item.id}-${idx}`"
                  class="flex items-center gap-2.5 p-2 rounded-xl transition-colors"
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
                    v-if="idx !== player.currentIndex && idx !== player.currentIndex + 1"
                    type="button"
                    class="w-8 h-8 rounded-full flex items-center justify-center text-white/65 bg-transparent border-0 am-tap shrink-0"
                    :aria-label="t('np.pinNext')"
                    @click.stop="player.moveQueueItemNext(idx)"
                  >
                    <Icon :icon="iconPlayerTrackNext" class="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-full flex items-center justify-center text-white/50 bg-transparent border-0 am-tap shrink-0"
                    aria-label="Remove"
                    @click.stop="player.removeFromQueue(idx)"
                  >
                    <Icon :icon="iconX" class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </Transition>
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
                <!-- Subtle Luminous Chorus / Climax Segment Marker -->
                <div
                  v-if="climaxBarStyle"
                  class="scrub-climax"
                  :style="climaxBarStyle"
                />
                <div class="scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
              </div>
            </div>
            <div
              class="flex items-center justify-between text-[11px] font-medium tabular-nums mt-0.5 transition-colors gap-2"
              :class="scrubbing ? 'text-white' : 'text-white/58'"
            >
              <span>{{ fmtTime(displayElapsedMs) }}</span>
              <div class="flex items-center gap-1.5 min-w-0">
                <button
                  v-if="showChorusJump"
                  type="button"
                  class="px-2 py-0.5 rounded-[6px] bg-white/18 text-white/95 text-[10px] font-semibold tracking-wide border-0 inline-flex items-center gap-0.5 am-tap shrink-0"
                  @click.stop="jumpToChorus"
                >
                  <Icon :icon="iconSparkles" class="w-2.5 h-2.5" />
                  <span>{{ t('np.chorusJump') }}</span>
                </button>
                <span
                  v-else-if="player.sourceTag"
                  class="px-2 py-0.5 rounded-[6px] bg-white/14 text-white/88 text-[10px] font-semibold tracking-wide truncate"
                >
                  {{ player.sourceTag }}
                </span>
              </div>
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

          <!-- Bottom 4 Balanced Liquid Glass Utility Icons (Lyrics / Comments / Sources / Queue) -->
          <div class="np-footer-bar">
            <button
              type="button"
              class="np-tool-btn am-tap"
              :class="{ 'is-on': ui.nowPlayingMode === 'lyrics' }"
              aria-label="Lyrics"
              @click="toggleMode('lyrics')"
            >
              <Icon :icon="iconMessageQuote" class="w-6 h-6" />
            </button>

            <button
              type="button"
              class="np-tool-btn relative am-tap"
              :aria-label="t('np.comments')"
              @click="ui.openSongComments(player.currentSong, 'comments')"
            >
              <Icon :icon="iconMessageCircle" class="w-6 h-6" />
              <span
                v-if="commentCount > 0"
                class="np-cmt-badge tabular-nums"
              >
                {{ formatCompactCount(commentCount, effectiveLocale) }}
              </span>
            </button>

            <button
              type="button"
              class="np-tool-btn am-tap"
              :aria-label="t('song.unblock')"
              @click="ui.unblockModalSong = player.currentSong"
            >
              <Icon :icon="iconSparkles" class="w-6 h-6" />
            </button>

            <button
              type="button"
              class="np-tool-btn am-tap"
              :class="{ 'is-on': ui.nowPlayingMode === 'queue' }"
              aria-label="Up Next"
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
  transition:
    transform 420ms var(--spring-ease),
    border-radius 380ms var(--spring-ease);
  will-change: transform;
}

.np-overlay.is-dragging {
  transition: none;
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
  position: relative;
  z-index: 12;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 24px 8px;
  flex-shrink: 0;
}

.np-mini-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.32);
  transform-origin: center center;
  will-change: transform;
}

.np-stage-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: visible;
}

.np-stage-pane {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.np-cover-stage {
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
  transform-origin: center center;
  transition: transform 480ms var(--spring-ease), box-shadow 480ms ease;
  will-change: transform;
}

.is-morph-hidden {
  opacity: 0 !important;
  visibility: hidden !important;
}

.art-layer {
  position: absolute;
  inset: 0;
}

.art-xfade-enter-active,
.art-xfade-leave-active {
  transition: opacity 420ms ease, transform 520ms var(--spring-ease);
}
.art-xfade-enter-from {
  opacity: 0;
  transform: scale(1.06);
}
.art-xfade-leave-to {
  opacity: 0;
  transform: scale(0.97);
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

/* ==================== APPLE MUSIC COVER <-> LYRICS / QUEUE TRANSITIONS ==================== */

/* Mini header entrance/exit alongside FLIP artwork */
.np-header-fade-enter-active {
  transition: opacity 440ms ease;
}
.np-header-fade-enter-active .np-mini-actions {
  transition: opacity 320ms ease 90ms, transform 380ms var(--spring-ease) 60ms;
}
.np-header-fade-enter-from .np-mini-actions {
  opacity: 0;
  transform: translate3d(12px, 0, 0);
}
.np-header-fade-leave-active {
  position: absolute;
  top: calc(var(--safe-top) + 32px);
  left: 0;
  right: 0;
  pointer-events: none;
  transition: opacity 220ms ease, transform 260ms var(--spring-ease);
}
.np-header-fade-leave-to {
  opacity: 0;
  transform: translate3d(0, -6px, 0);
}

/* 1. Cover -> Lyrics / Queue: lyrics softly unfurl upward while cover's non-hero UI dissolves */
.np-to-detail-enter-active {
  z-index: 5;
  transition:
    opacity 360ms ease 60ms,
    transform 460ms var(--spring-ease) 30ms;
  will-change: transform, opacity;
}
.np-to-detail-enter-from {
  opacity: 0;
  transform: translate3d(0, 34px, 0) scale3d(0.975, 0.975, 1);
}
.np-to-detail-leave-active {
  z-index: 2;
  pointer-events: none;
  transition:
    opacity 220ms ease,
    transform 280ms var(--spring-ease);
  will-change: transform, opacity;
}
.np-to-detail-leave-to {
  opacity: 0;
  transform: translate3d(0, -18px, 0) scale3d(0.96, 0.96, 1);
}

/* 2. Lyrics / Queue -> Cover: artwork flies back down via FLIP while lyrics descend softly */
.np-to-cover-enter-active {
  z-index: 5;
  transition: opacity 480ms ease;
}
.np-to-cover-enter-active .np-cover-lyrics,
.np-to-cover-enter-active .np-meta-row {
  transition:
    opacity 320ms ease 80ms,
    transform 420ms var(--spring-ease) 60ms;
}
.np-to-cover-enter-from .np-cover-lyrics,
.np-to-cover-enter-from .np-meta-row {
  opacity: 0;
  transform: translate3d(0, 14px, 0);
}
.np-to-cover-leave-active {
  z-index: 2;
  pointer-events: none;
  transition:
    opacity 230ms ease,
    transform 300ms var(--ios-curve);
  will-change: transform, opacity;
}
.np-to-cover-leave-to {
  opacity: 0;
  transform: translate3d(0, 28px, 0) scale3d(0.97, 0.97, 1);
}

/* 3. Lyrics <-> Queue cross-depth glide (mini header stays completely stationary!) */
.np-cross-depth-enter-active {
  z-index: 5;
  transition:
    opacity 280ms ease 40ms,
    transform 360ms var(--spring-ease);
  will-change: transform, opacity;
}
.np-cross-depth-enter-from {
  opacity: 0;
  transform: translate3d(0, 18px, 0) scale3d(0.985, 0.985, 1);
}
.np-cross-depth-leave-active {
  z-index: 2;
  pointer-events: none;
  transition:
    opacity 190ms ease,
    transform 220ms ease;
  will-change: transform, opacity;
}
.np-cross-depth-leave-to {
  opacity: 0;
  transform: scale3d(0.97, 0.97, 1);
}

.heart-burst-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.16);
  pointer-events: none;
}

.heart-pop-enter-active {
  animation: heart-pop-kf 620ms var(--spring-bounce);
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
  transform: translate3d(0, 0, 0);
  transition:
    max-height 420ms var(--spring-ease),
    opacity 260ms ease,
    transform 400ms var(--spring-ease),
    padding 380ms var(--spring-ease);
}

.np-controls.is-compact {
  padding-top: 4px;
}

.np-controls.is-immersive-hidden {
  max-height: 0;
  opacity: 0;
  transform: translate3d(0, 28px, 0);
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
  position: relative;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
  transition: height 200ms var(--spring-ease), box-shadow 200ms ease;
}

.scrub-climax {
  position: absolute;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(166, 204, 255, 0.32), rgba(255, 255, 255, 0.56), rgba(166, 204, 255, 0.32));
  border-radius: 999px;
  pointer-events: none;
}

.scrub-track.is-scrubbing {
  height: 10px;
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.28);
}

.scrub-fill {
  position: relative;
  z-index: 1;
  height: 100%;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 999px;
}

.np-cmt-badge {
  position: absolute;
  top: 1px;
  right: -2px;
  min-width: 18px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  backdrop-filter: blur(8px);
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

.np-transport {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  margin: 14px 0 16px;
  transition: margin 360ms var(--spring-ease);
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
  transition:
    background-color 240ms ease,
    color 240ms ease,
    box-shadow 240ms ease,
    transform 200ms var(--spring-bounce);
}

.np-tool-btn.is-on {
  background: rgba(255, 255, 255, 0.92);
  color: #111111;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
}
</style>
