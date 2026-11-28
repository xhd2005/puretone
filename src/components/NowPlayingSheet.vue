<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import iconDisc from '@iconify/icons-tabler/disc';
import iconLayoutColumns from '@iconify/icons-tabler/layout-columns';
import type { SongClimaxRange } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { openArtistProfileFromSong } from '@/services/playback/artistNavigation';
import {
  computeCoverCarouselLayout,
  computeQueueWindow,
  computeSharedArtworkTransform,
  type BoxRect,
} from '@/utils/heroMorph';
import { useDecodedCover } from '@/composables/useDecodedCover';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import FluidCoverBackground from './FluidCoverBackground.vue';
import KrcLyricsView from './KrcLyricsView.vue';
import CoverFlowStage from './CoverFlowStage.vue';

const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { t } = useI18n();

// Double-buffered pre-decoded cover URL: zero empty gray flash on track switch!
const { displayedCoverUrl } = useDecodedCover(() => player.currentSong?.coverUrl || '');

// Landscape Dual-Mode detection (Split Lyrics + Cover / 3D Cover Flow)
function checkIsLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth > window.innerHeight && window.innerWidth >= 560;
}
const isLandscape = ref(checkIsLandscape());
const landscapeMode = ref<'split' | 'coverflow'>('split');
const landscapeRightPane = ref<'lyrics' | 'queue'>('lyrics');

function handleViewportResize() {
  const next = checkIsLandscape();
  if (next !== isLandscape.value) {
    isLandscape.value = next;
    if (!next && ui.nowPlayingOpen) {
      void nextTick(() => {
        measureArtworkSlots();
        attachSlotObserver();
      });
    }
  } else if (!next && ui.nowPlayingOpen) {
    measureArtworkSlots();
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('orientationchange', handleViewportResize);
  }
});

// Track extras: Chorus Climax marker (no comment count badge!)
const climaxRange = ref<SongClimaxRange | null>(null);
const showLyricOffsetBar = ref(false);

// Adjacent queue songs for 3-card interactive physical swipe carousel
const prevQueueSong = computed(() => {
  const len = player.queue.length;
  if (len <= 1 || player.currentIndex < 0) return null;
  return player.queue[(player.currentIndex - 1 + len) % len] || null;
});

const nextQueueSong = computed(() => {
  const len = player.queue.length;
  if (len <= 1 || player.currentIndex < 0) return null;
  return player.queue[(player.currentIndex + 1) % len] || null;
});

// Windowed Up Next Queue (~60 rows max instead of 1,500+ DOM nodes)
const queueBeforeCount = ref(15);
const queueAfterCount = ref(45);

const queueWindow = computed(() =>
  computeQueueWindow(
    player.queue.length,
    player.currentIndex,
    queueBeforeCount.value,
    queueAfterCount.value,
  ),
);

const visibleQueueItems = computed(() => {
  const { start, end } = queueWindow.value;
  return player.queue.slice(start, end).map((item, offset) => ({
    item,
    index: start + offset,
  }));
});

function expandQueuePrev() {
  echoSystem.haptic('selection');
  queueBeforeCount.value += 50;
}

function expandQueueNext() {
  echoSystem.haptic('selection');
  queueAfterCount.value += 50;
}

watch(
  () => [player.currentIndex, player.queue.length],
  () => {
    if (queueBeforeCount.value > 15 || queueAfterCount.value > 45) {
      queueBeforeCount.value = 15;
      queueAfterCount.value = 45;
    }
  },
);

// ==================== SINGLE PERSISTENT SHARED ARTWORK GEOMETRY ====================
// One single always-visible artwork layer lives directly on `.np-stage-host` (z-index: 24).
// Switching Cover <-> Lyrics <-> Queue ONLY changes its GPU `transform`, making double-blank
// cover flicker physically impossible!
const stageHostRef = ref<HTMLElement | null>(null);
const coverSlotRef = ref<HTMLElement | null>(null);
const miniSlotRef = ref<HTMLElement | null>(null);

const stageRect = ref<BoxRect | null>(null);
const coverSlotRect = ref<BoxRect | null>(null);
const miniSlotRect = ref<BoxRect | null>(null);
const artworkReadyForTransition = ref(false);
let slotResizeObserver: ResizeObserver | null = null;
let readyRaf1 = 0;
let readyRaf2 = 0;

function measureArtworkSlots() {
  const host = stageHostRef.value;
  const cover = coverSlotRef.value;
  const mini = miniSlotRef.value;
  if (!host || !cover || !mini) return;

  const hr = host.getBoundingClientRect();
  const cr = cover.getBoundingClientRect();
  const mr = mini.getBoundingClientRect();
  if (hr.width < 10 || cr.width < 10 || mr.width < 10) return;

  stageRect.value = { left: hr.left, top: hr.top, width: hr.width, height: hr.height };
  coverSlotRect.value = { left: cr.left, top: cr.top, width: cr.width, height: cr.height };
  miniSlotRect.value = { left: mr.left, top: mr.top, width: mr.width, height: mr.height };
}

function attachSlotObserver() {
  detachSlotObserver();
  if (typeof ResizeObserver !== 'undefined' && stageHostRef.value) {
    slotResizeObserver = new ResizeObserver(() => measureArtworkSlots());
    slotResizeObserver.observe(stageHostRef.value);
    if (coverSlotRef.value) slotResizeObserver.observe(coverSlotRef.value);
  }
}

function detachSlotObserver() {
  if (slotResizeObserver) {
    slotResizeObserver.disconnect();
    slotResizeObserver = null;
  }
  if (readyRaf1) {
    cancelAnimationFrame(readyRaf1);
    readyRaf1 = 0;
  }
  if (readyRaf2) {
    cancelAnimationFrame(readyRaf2);
    readyRaf2 = 0;
  }
}

// ==================== 120HZ 3-CARD INTERACTIVE COVER SWIPE CAROUSEL ====================
const dragOffsetY = ref(0);
const isDraggingSheet = ref(false);
const coverSwipeX = ref(0);
const swipePhase = ref<'idle' | 'dragging' | 'settling' | 'snapping'>('idle');
const swipeSnapInstant = ref(false);
const skipArtXfade = ref(false);
const swipeFrozenCovers = ref<{ prev: string; cur: string; next: string } | null>(null);
const heartBurst = ref(false);

let sheetTouchY = 0;
let coverTouchStartX = 0;
let coverTouchStartY = 0;
let coverLastTouchX = 0;
let coverLastTouchTime = 0;
let coverSwipeVelocity = 0; // px/ms
let coverGestureAxis: 'none' | 'x' | 'y' = 'none';
let lastCoverTapAt = 0;
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;
let swipeFinishTimer: ReturnType<typeof setTimeout> | null = null;
let swipeXfadeTimer: ReturnType<typeof setTimeout> | null = null;

function clearSwipeTimers() {
  if (swipeFinishTimer) {
    clearTimeout(swipeFinishTimer);
    swipeFinishTimer = null;
  }
  if (swipeXfadeTimer) {
    clearTimeout(swipeXfadeTimer);
    swipeXfadeTimer = null;
  }
}

const isCarouselActive = computed(
  () =>
    !isLandscape.value &&
    ui.nowPlayingMode === 'cover' &&
    (swipePhase.value !== 'idle' || Math.abs(coverSwipeX.value) > 0.5),
);

const portraitSwipeStride = computed(() => Math.max(220, (coverSlotRect.value?.width || 300) + 34));
const landscapeSwipeStride = 230;

const carouselLayout = computed(() =>
  computeCoverCarouselLayout(
    coverSwipeX.value,
    isLandscape.value ? landscapeSwipeStride : portraitSwipeStride.value,
    player.isPlaying ? 1 : 0.84,
  ),
);

const activeCurrentCoverUrl = computed(
  () => swipeFrozenCovers.value?.cur ?? displayedCoverUrl.value,
);
const activePrevCoverUrl = computed(
  () => swipeFrozenCovers.value?.prev ?? prevQueueSong.value?.coverUrl ?? '',
);
const activeNextCoverUrl = computed(
  () => swipeFrozenCovers.value?.next ?? nextQueueSong.value?.coverUrl ?? '',
);

const artworkTransitionRule = computed(() => {
  if (!artworkReadyForTransition.value || swipePhase.value === 'dragging' || swipeSnapInstant.value) {
    return 'none';
  }
  if (swipePhase.value === 'settling' || swipePhase.value === 'snapping') {
    return 'transform 265ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease';
  }
  return undefined;
});

const sharedArtworkStyle = computed(() => {
  const hr = stageRect.value;
  const cr = coverSlotRect.value;
  const mr = miniSlotRect.value;
  if (!hr || !cr || !mr) {
    return { opacity: '0', pointerEvents: 'none' as const };
  }

  const basePos = {
    left: `${(cr.left - hr.left).toFixed(2)}px`,
    top: `${(cr.top - hr.top).toFixed(2)}px`,
    width: `${cr.width.toFixed(2)}px`,
    height: `${cr.height.toFixed(2)}px`,
  };

  if (isCarouselActive.value) {
    return {
      ...basePos,
      transform: carouselLayout.value.current.transform,
      opacity: String(carouselLayout.value.current.opacity),
      transition: artworkTransitionRule.value,
    };
  }

  const tf = computeSharedArtworkTransform(cr, mr, {
    mode: ui.nowPlayingMode,
    isPlaying: player.isPlaying,
    swipeX: 0,
  });

  return {
    ...basePos,
    transform: tf.transform,
    opacity: '1',
    transition: artworkTransitionRule.value,
  };
});

function buildSiblingCardStyle(side: 'prev' | 'next') {
  const hr = stageRect.value;
  const cr = coverSlotRect.value;
  if (!hr || !cr) return { opacity: '0', pointerEvents: 'none' as const };
  const card = side === 'prev' ? carouselLayout.value.prev : carouselLayout.value.next;
  return {
    left: `${(cr.left - hr.left).toFixed(2)}px`,
    top: `${(cr.top - hr.top).toFixed(2)}px`,
    width: `${cr.width.toFixed(2)}px`,
    height: `${cr.height.toFixed(2)}px`,
    transform: card.transform,
    opacity: String(card.opacity),
    transition: artworkTransitionRule.value,
  };
}

const prevSiblingStyle = computed(() => buildSiblingCardStyle('prev'));
const nextSiblingStyle = computed(() => buildSiblingCardStyle('next'));

// Landscape Split-Mode 3-Card Cover Style
const landscapeCurrentCoverStyle = computed(() => {
  if (swipePhase.value !== 'idle' || Math.abs(coverSwipeX.value) > 0.5) {
    return {
      transform: carouselLayout.value.current.transform,
      opacity: String(carouselLayout.value.current.opacity),
      transition:
        swipePhase.value === 'dragging' || swipeSnapInstant.value
          ? 'none'
          : 'transform 265ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease',
    };
  }
  const scale = player.isPlaying ? 1 : 0.90;
  return {
    transform: `translate3d(0, 0, 0) scale3d(${scale}, ${scale}, 1)`,
    opacity: '1',
    transition: swipeSnapInstant.value ? 'none' : 'transform 360ms var(--spring-ease), opacity 220ms ease',
  };
});

function buildLandscapeSiblingStyle(side: 'prev' | 'next') {
  const card = side === 'prev' ? carouselLayout.value.prev : carouselLayout.value.next;
  return {
    transform: card.transform,
    opacity: String(card.opacity),
    transition:
      swipePhase.value === 'dragging' || swipeSnapInstant.value
        ? 'none'
        : 'transform 265ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease',
  };
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
  () => [player.currentSong?.hash, ui.nowPlayingOpen],
  async ([hash, open]) => {
    if (!open || !player.currentSong) return;
    const seq = ++extrasSeq;
    climaxRange.value = null;
    const s = player.currentSong;
    const durMs = player.durationMs || (s.duration ? s.duration * 1000 : 0);
    const clx = hash ? await kugouApi.getSongClimax(String(hash), durMs).catch(() => null) : null;
    if (seq !== extrasSeq) return;
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
  revealLyricsHud(true);
  settings.adjustLyricOffset(key, deltaMs);
}

function resetLyricOffset() {
  const key = currentTrackOffsetKey.value;
  if (!key) return;
  echoSystem.haptic('light');
  revealLyricsHud(true);
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

// Pointer-captured Scrubber state
const scrubbing = ref(false);
const scrubRatio = ref(0);
let activeScrubPointerId: number | null = null;

// Lyrics 3s Auto-Immersive HUD state
const lyricsHudVisible = ref(true);
let lyricsHideTimer: ReturnType<typeof setTimeout> | null = null;

const overlayDragStyle = computed(() => {
  if (dragOffsetY.value <= 0) return undefined;
  return {
    transform: `translate3d(0, ${dragOffsetY.value}px, 0)`,
    transition: isDraggingSheet.value ? 'none' : undefined,
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
  if (isLandscape.value || ui.nowPlayingMode !== 'lyrics' || !ui.nowPlayingOpen) return;
  if (!player.isPlaying || scrubbing.value) return;
  lyricsHideTimer = setTimeout(() => {
    if (!isLandscape.value && ui.nowPlayingMode === 'lyrics' && player.isPlaying && !scrubbing.value) {
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
  if (!isLandscape.value && ui.nowPlayingMode === 'lyrics') {
    revealLyricsHud(true);
  }
}

function onLyricsTapBlank() {
  if (isLandscape.value || ui.nowPlayingMode !== 'lyrics') return;
  if (lyricsHudVisible.value) {
    clearLyricsHideTimer();
    lyricsHudVisible.value = false;
  } else {
    revealLyricsHud(true);
  }
}

const isLyricsImmersive = computed(() => !isLandscape.value && ui.nowPlayingMode === 'lyrics' && !lyricsHudVisible.value);

const coverLyricsPreview = computed(() => {
  if (!settings.showCoverLyricsPreview) return null;
  const lines = player.lyrics.lines;
  if (!lines.length) return null;
  const tMs = Math.max(0, player.currentTimeMs + currentLyricOffsetMs.value + 120);
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= tMs) {
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
  () => [ui.nowPlayingOpen, Boolean(player.currentSong)],
  async ([open, hasSong]) => {
    settings.applyThemeClass(Boolean(open));
    if (open && hasSong) {
      isLandscape.value = checkIsLandscape();
      artworkReadyForTransition.value = false;
      await nextTick();
      if (!isLandscape.value) {
        measureArtworkSlots();
        attachSlotObserver();
        readyRaf1 = requestAnimationFrame(() => {
          measureArtworkSlots();
          readyRaf2 = requestAnimationFrame(() => {
            artworkReadyForTransition.value = true;
          });
        });
      }
      if (ui.nowPlayingMode === 'lyrics') {
        revealLyricsHud(true);
      }
    } else {
      detachSlotObserver();
      clearSwipeTimers();
      artworkReadyForTransition.value = false;
      isDraggingSheet.value = false;
      swipePhase.value = 'idle';
      swipeFrozenCovers.value = null;
      swipeSnapInstant.value = false;
      dragOffsetY.value = 0;
      coverSwipeX.value = 0;
      showLyricOffsetBar.value = false;
      clearLyricsHideTimer();
      lyricsHudVisible.value = true;
    }
  },
  { immediate: true },
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
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleViewportResize);
    window.removeEventListener('orientationchange', handleViewportResize);
  }
  detachSlotObserver();
  clearLyricsHideTimer();
  clearSwipeTimers();
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

// ---- Pointer-Captured Scrubber ----

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

// ---- Cover Gestures: 120Hz 3-Card Physical Swipe / Drag Down Dismiss / Double-Tap Heart ----

function onCoverTouchStart(e: TouchEvent) {
  if (!isLandscape.value && ui.nowPlayingMode !== 'cover') return;
  if (swipePhase.value === 'settling') return;
  const touch = e.touches[0];
  if (!touch) return;
  clearSwipeTimers();
  coverTouchStartX = touch.clientX;
  coverTouchStartY = touch.clientY;
  coverLastTouchX = touch.clientX;
  coverLastTouchTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  coverSwipeVelocity = 0;
  coverGestureAxis = 'none';
}

function onCoverTouchMove(e: TouchEvent) {
  if (!isLandscape.value && ui.nowPlayingMode !== 'cover') return;
  if (swipePhase.value === 'settling') return;
  const touch = e.touches[0];
  if (!touch) return;
  const dx = touch.clientX - coverTouchStartX;
  const dy = touch.clientY - coverTouchStartY;

  if (coverGestureAxis === 'none') {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      coverGestureAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (coverGestureAxis === 'x') {
        swipePhase.value = 'dragging';
      } else if (coverGestureAxis === 'y' && dy > 0 && !isLandscape.value) {
        isDraggingSheet.value = true;
      }
    }
  }

  if (coverGestureAxis === 'x') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(4, now - coverLastTouchTime);
    coverSwipeVelocity = (touch.clientX - coverLastTouchX) / dt;
    coverLastTouchX = touch.clientX;
    coverLastTouchTime = now;

    // 1:1 responsive finger tracking when multiple tracks exist; soft rubber band when single track
    const hasSiblings = player.queue.length > 1;
    coverSwipeX.value = hasSiblings ? dx * 0.96 : dx * 0.24;
  } else if (coverGestureAxis === 'y' && dy > 0 && !isLandscape.value) {
    isDraggingSheet.value = true;
    dragOffsetY.value = dy * 0.85;
  }
}

function onCoverTouchEnd(e: TouchEvent) {
  if (!isLandscape.value && ui.nowPlayingMode !== 'cover') return;
  if (swipePhase.value === 'settling') return;
  const touch = e.changedTouches[0];
  const dx = (touch?.clientX ?? coverTouchStartX) - coverTouchStartX;
  const dy = (touch?.clientY ?? coverTouchStartY) - coverTouchStartY;

  isDraggingSheet.value = false;

  if (coverGestureAxis === 'x') {
    const stride = isLandscape.value ? landscapeSwipeStride : portraitSwipeStride.value;
    const hasSiblings = player.queue.length > 1;
    const vx = coverSwipeVelocity;
    const commitNext = hasSiblings && (dx < -stride * 0.23 || (vx < -0.40 && dx < -20));
    const commitPrev = hasSiblings && (dx > stride * 0.23 || (vx > 0.40 && dx > 20));

    if (commitNext || commitPrev) {
      const dir = commitNext ? -1 : 1;
      // Freeze the 3 visual card images for the 265ms glide while kicking off audio immediately (0ms delay!)
      swipeFrozenCovers.value = {
        prev: prevQueueSong.value?.coverUrl || '',
        cur: displayedCoverUrl.value || '',
        next: nextQueueSong.value?.coverUrl || '',
      };
      skipArtXfade.value = true;
      swipePhase.value = 'settling';
      coverSwipeX.value = dir * stride;

      if (commitNext) {
        void player.next();
      } else {
        void player.previous(true);
      }

      swipeFinishTimer = setTimeout(() => {
        swipeFinishTimer = null;
        swipeSnapInstant.value = true;
        coverSwipeX.value = 0;
        swipePhase.value = 'idle';
        swipeFrozenCovers.value = null;
        requestAnimationFrame(() => {
          swipeSnapInstant.value = false;
          swipeXfadeTimer = setTimeout(() => {
            swipeXfadeTimer = null;
            skipArtXfade.value = false;
          }, 120);
        });
      }, 270);
    } else {
      swipePhase.value = 'snapping';
      coverSwipeX.value = 0;
      swipeFinishTimer = setTimeout(() => {
        swipeFinishTimer = null;
        swipePhase.value = 'idle';
      }, 270);
    }
  } else if (coverGestureAxis === 'y' && !isLandscape.value) {
    if (dragOffsetY.value > 95) {
      echoSystem.haptic('light');
      ui.nowPlayingOpen = false;
    }
    dragOffsetY.value = 0;
  } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
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

function onSharedArtworkClick() {
  if (!isLandscape.value && ui.nowPlayingMode !== 'cover') {
    returnToCover();
  }
}

function toggleMode(target: 'lyrics' | 'queue') {
  echoSystem.haptic('selection');
  measureArtworkSlots();
  ui.nowPlayingMode = ui.nowPlayingMode === target ? 'cover' : target;
}

function returnToCover() {
  echoSystem.haptic('selection');
  measureArtworkSlots();
  ui.nowPlayingMode = 'cover';
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

// Pause ambient background animation while a modal sheet (Comments, Actions, Settings, etc.)
// covers NowPlaying so Android WebView never wastes GPU frames or triggers compositor ghosting.
const fluidBgActive = computed(
  () =>
    ui.nowPlayingOpen &&
    !ui.audioEffectSheetOpen &&
    !ui.commentsSheetSong &&
    !ui.actionSheetSong &&
    !(ui.addToPlaylistSongs && ui.addToPlaylistSongs.length > 0) &&
    !ui.lyricPosterSong &&
    !ui.unblockModalSong &&
    !ui.accountSheetOpen &&
    !ui.loginModalOpen &&
    !ui.artistPickerCandidates,
);

const hasActiveAudioDsp = computed(() => settings.eqPreset !== 'flat' || settings.volumeLeveling);

function openAudioEffectSheet() {
  echoSystem.haptic('light');
  ui.audioEffectSheetOpen = true;
}

function switchLandscapeMode(mode: 'split' | 'coverflow') {
  if (landscapeMode.value === mode) return;
  echoSystem.haptic('selection');
  landscapeMode.value = mode;
}
</script>

<template>
  <Transition name="am-sheet">
    <div
      v-if="ui.nowPlayingOpen && player.currentSong"
      class="np-overlay"
      :class="{ 'is-dragging': isDraggingSheet, 'is-landscape': isLandscape }"
      :style="overlayDragStyle"
    >
      <FluidCoverBackground
        :active="fluidBgActive"
        :colors="player.palette.fluidColors"
      />

      <!-- ==================== LANDSCAPE DUAL-MODE STAGE (Split Lyrics / 3D Cover Flow) ==================== -->
      <div v-if="isLandscape" class="np-land-content" data-landscape-split>
        <!-- Compact Top Floating Bar: Mode Switcher + Actions + Dismiss -->
        <div class="np-land-topbar">
          <div class="np-land-seg">
            <button
              type="button"
              class="np-land-seg-btn am-tap"
              :class="{ 'is-active': landscapeMode === 'split' }"
              @click="switchLandscapeMode('split')"
            >
              <Icon :icon="iconLayoutColumns" class="w-3.5 h-3.5 shrink-0" />
              <span>{{ t('np.landscapeSplit') }}</span>
            </button>
            <button
              type="button"
              class="np-land-seg-btn am-tap"
              :class="{ 'is-active': landscapeMode === 'coverflow' }"
              @click="switchLandscapeMode('coverflow')"
            >
              <Icon :icon="iconDisc" class="w-3.5 h-3.5 shrink-0" />
              <span>{{ t('np.landscapeCoverFlow') }}</span>
            </button>
          </div>

          <div class="flex items-center gap-1.5">
            <template v-if="landscapeMode === 'split'">
              <button
                v-if="landscapeRightPane === 'lyrics'"
                type="button"
                class="np-glass-chip h-8 px-2.5 rounded-full text-[11px] font-semibold text-white/90 tabular-nums am-tap"
                :class="{ '!bg-white/30 !text-white': showLyricOffsetBar || currentLyricOffsetMs !== 0 }"
                @click="showLyricOffsetBar = !showLyricOffsetBar; echoSystem.haptic('selection')"
              >
                {{ currentLyricOffsetMs !== 0 ? lyricOffsetLabel : t('np.lyricOffset') }}
              </button>
              <button
                v-if="landscapeRightPane === 'lyrics' && player.lyrics.hasTranslation"
                type="button"
                class="np-land-circle np-glass-chip am-tap"
                :class="{ '!bg-white/30 !text-white': settings.showTranslation }"
                aria-label="Toggle translation"
                @click="settings.showTranslation = !settings.showTranslation; echoSystem.haptic('selection')"
              >
                <Icon :icon="iconLanguage" class="w-4 h-4" />
              </button>
              <button
                type="button"
                class="np-land-circle np-glass-chip am-tap"
                :class="{ '!bg-white/90 !text-[#111]': landscapeRightPane === 'queue' }"
                aria-label="Up Next"
                @click="echoSystem.haptic('selection'); landscapeRightPane = landscapeRightPane === 'queue' ? 'lyrics' : 'queue'"
              >
                <Icon :icon="iconPlaylist" class="w-4 h-4" />
              </button>
            </template>
            <button
              type="button"
              class="np-land-circle np-glass-chip am-tap"
              :aria-label="t('common.close')"
              @click="echoSystem.haptic('light'); ui.nowPlayingOpen = false"
            >
              <Icon :icon="iconX" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- MODE A: Left Cover & Controls + Right 120Hz Lyrics / Queue -->
        <div v-if="landscapeMode === 'split'" class="np-land-split">
          <!-- Left Column: Interactive 3-Card Swipe Artwork + Transport -->
          <div class="np-land-left">
            <div
              class="np-land-art-stage"
              @touchstart.passive="onCoverTouchStart"
              @touchmove.passive="onCoverTouchMove"
              @touchend.passive="onCoverTouchEnd"
            >
              <div
                v-if="swipePhase !== 'idle' && activePrevCoverUrl"
                class="np-land-art-card is-sibling"
                :style="buildLandscapeSiblingStyle('prev')"
              >
                <img :src="activePrevCoverUrl" decoding="async" class="w-full h-full object-cover" alt="" />
              </div>

              <div
                class="np-land-art-card"
                :style="landscapeCurrentCoverStyle"
              >
                <img
                  v-if="activeCurrentCoverUrl"
                  :src="activeCurrentCoverUrl"
                  decoding="async"
                  :alt="player.currentSong.title"
                  class="w-full h-full object-cover"
                />
                <div
                  v-else
                  class="w-full h-full flex items-center justify-center bg-white/10 text-white/40"
                >
                  <Icon :icon="iconMusic" class="w-12 h-12" />
                </div>
                <Transition name="heart-pop">
                  <div v-if="heartBurst" class="heart-burst-overlay">
                    <Icon :icon="iconHeartFilled" class="w-16 h-16 text-[#ff375f] drop-shadow-2xl" />
                  </div>
                </Transition>
              </div>

              <div
                v-if="swipePhase !== 'idle' && activeNextCoverUrl"
                class="np-land-art-card is-sibling"
                :style="buildLandscapeSiblingStyle('next')"
              >
                <img :src="activeNextCoverUrl" decoding="async" class="w-full h-full object-cover" alt="" />
              </div>
            </div>

            <!-- Song Meta + Heart + More -->
            <div class="flex items-center justify-between gap-2 w-full">
              <div class="min-w-0 flex-1">
                <div class="text-[16px] font-bold text-white truncate leading-snug">
                  {{ player.currentSong.title }}
                </div>
                <button
                  type="button"
                  class="inline-flex items-center gap-0.5 max-w-full bg-transparent border-0 p-0 text-[13px] text-white/68 active:text-white text-left"
                  @click.stop="openCurrentArtist"
                >
                  <span class="truncate">{{ player.currentSong.artist }}</span>
                  <Icon :icon="iconChevronRight" class="w-3.5 h-3.5 opacity-60 shrink-0" />
                </button>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="np-land-circle np-glass-chip am-tap"
                  aria-label="收藏到我喜欢"
                  @click="player.toggleFavorite(player.currentSong)"
                >
                  <Icon
                    :icon="player.isCurrentFavorite ? iconHeartFilled : iconHeart"
                    class="w-4 h-4"
                    :class="player.isCurrentFavorite ? 'text-[#ff375f]' : 'text-white/95'"
                  />
                </button>
                <button
                  type="button"
                  class="np-land-circle np-glass-chip am-tap"
                  aria-label="更多选项"
                  @click="ui.openSongActions(player.currentSong)"
                >
                  <Icon :icon="iconDots" class="w-4 h-4 text-white/95" />
                </button>
              </div>
            </div>

            <!-- Scrubber & Quality/Chorus Chips -->
            <div class="w-full">
              <div
                class="scrub-hit !py-2"
                @pointerdown="onScrubPointerDown"
                @pointermove="onScrubPointerMove"
                @pointerup="finishScrub($event, true)"
                @pointercancel="finishScrub($event, false)"
              >
                <div class="scrub-track" :class="{ 'is-scrubbing': scrubbing }">
                  <div v-if="climaxBarStyle" class="scrub-climax" :style="climaxBarStyle" />
                  <div class="scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
                </div>
              </div>
              <div class="flex items-center justify-between text-[10.5px] font-medium tabular-nums text-white/60 gap-1.5">
                <span>{{ fmtTime(displayElapsedMs) }}</span>
                <div class="flex items-center justify-center gap-1 min-w-0">
                  <button
                    v-if="player.sourceTag"
                    type="button"
                    class="px-1.5 py-0.5 rounded-[5px] bg-white/14 text-white/90 text-[9.5px] font-semibold border-0 truncate am-tap"
                    @click.stop="openAudioEffectSheet"
                  >
                    {{ player.sourceTag }}
                  </button>
                  <button
                    v-if="showChorusJump"
                    type="button"
                    class="px-1.5 py-0.5 rounded-[5px] bg-white/18 text-white/95 text-[9.5px] font-semibold border-0 inline-flex items-center gap-0.5 am-tap shrink-0"
                    @click.stop="jumpToChorus"
                  >
                    <Icon :icon="iconSparkles" class="w-2.5 h-2.5" />
                    <span>{{ t('np.chorusJump') }}</span>
                  </button>
                </div>
                <span>-{{ fmtTime(displayRemainingMs) }}</span>
              </div>
            </div>

            <!-- Compact Landscape Transport & Utility Row -->
            <div class="flex items-center justify-between w-full pt-0.5">
              <button
                type="button"
                class="np-land-tool am-tap"
                :aria-label="t('np.comments')"
                @click="ui.openSongComments(player.currentSong, 'comments')"
              >
                <Icon :icon="iconMessageCircle" class="w-5 h-5" />
              </button>
              <button type="button" class="np-land-skip am-tap" aria-label="上一首" @click="player.previous()">
                <Icon :icon="iconPlayerTrackPrevFilled" class="w-7 h-7" />
              </button>
              <button
                type="button"
                class="np-land-play am-tap"
                :aria-label="player.isPlaying ? '暂停' : '播放'"
                @click="player.togglePlay()"
              >
                <Icon
                  :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled"
                  class="w-9 h-9"
                />
              </button>
              <button type="button" class="np-land-skip am-tap" aria-label="下一首" @click="player.next()">
                <Icon :icon="iconPlayerTrackNextFilled" class="w-7 h-7" />
              </button>
              <button
                type="button"
                class="np-land-tool relative am-tap"
                :class="{ 'text-white': hasActiveAudioDsp }"
                :aria-label="t('audio.sheetTitle')"
                @click="openAudioEffectSheet"
              >
                <Icon :icon="iconAdjustments" class="w-5 h-5" />
                <span v-if="hasActiveAudioDsp" class="np-dsp-dot !top-1 !right-1" />
              </button>
            </div>
          </div>

          <!-- Right Column: Full-Height 120Hz Lyrics OR Queue -->
          <div class="np-land-right">
            <Transition name="am-expand">
              <div
                v-if="landscapeRightPane === 'lyrics' && showLyricOffsetBar"
                class="flex items-center justify-center gap-1.5 pb-1 shrink-0"
              >
                <button type="button" class="np-glass-chip h-7 px-2 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(-1000)">-1s</button>
                <button type="button" class="np-glass-chip h-7 px-2 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(-500)">-0.5s</button>
                <button type="button" class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-bold text-white tabular-nums am-tap" @click="resetLyricOffset">{{ lyricOffsetLabel }}</button>
                <button type="button" class="np-glass-chip h-7 px-2 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(500)">+0.5s</button>
                <button type="button" class="np-glass-chip h-7 px-2 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(1000)">+1s</button>
              </div>
            </Transition>

            <div v-if="landscapeRightPane === 'lyrics'" class="flex-1 min-h-0">
              <KrcLyricsView
                :active="ui.nowPlayingOpen && isLandscape && landscapeMode === 'split' && landscapeRightPane === 'lyrics'"
                @user-scroll="onLyricsUserScroll"
              />
            </div>

            <div v-else class="flex-1 min-h-0 flex flex-col">
              <div class="flex items-center justify-between gap-2 pb-2 shrink-0">
                <div class="text-[14px] font-bold text-white">
                  {{ t('np.upNext') }}
                  <span class="text-[11px] font-normal text-white/55 ml-1.5">{{ player.queue.length }}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="np-glass-chip px-2.5 py-1 rounded-full text-white text-[11px] font-medium flex items-center gap-1 am-tap"
                    @click="player.cyclePlayMode()"
                  >
                    <Icon :icon="playModeIcon" class="w-3.5 h-3.5" />
                    <span>{{ playModeLabel }}</span>
                  </button>
                  <button
                    type="button"
                    class="np-glass-chip w-7 h-7 rounded-full text-white/80 flex items-center justify-center am-tap"
                    :aria-label="t('np.clearQueue')"
                    @click="handleClearQueue"
                  >
                    <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div class="flex-1 am-scroll space-y-1 pr-1">
                <div
                  v-for="row in visibleQueueItems"
                  :key="`land-${row.item.id}-${row.index}`"
                  class="np-queue-row flex items-center gap-2.5 p-1.5 rounded-xl transition-colors"
                  :class="row.index === player.currentIndex ? 'bg-white/18' : 'active:bg-white/10'"
                  @click="player.playQueue(player.queue, row.index)"
                >
                  <div class="w-9 h-9 rounded-[8px] overflow-hidden shrink-0 bg-white/10">
                    <img v-if="row.item.coverUrl" :src="row.item.coverUrl" loading="lazy" decoding="async" class="w-full h-full object-cover" alt="" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[13.5px] font-medium text-white truncate">{{ row.item.title }}</div>
                    <div class="text-[11.5px] text-white/55 truncate">{{ row.item.artist }}</div>
                  </div>
                  <button
                    type="button"
                    class="w-7 h-7 rounded-full flex items-center justify-center text-white/50 bg-transparent border-0 am-tap shrink-0"
                    aria-label="Remove"
                    @click.stop="player.removeFromQueue(row.index)"
                  >
                    <Icon :icon="iconX" class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- MODE B: Classic 3D Cover Flow Album Selector -->
        <div v-else class="flex-1 min-h-0">
          <CoverFlowStage :active="ui.nowPlayingOpen && isLandscape && landscapeMode === 'coverflow'" />
        </div>
      </div>

      <!-- ==================== PORTRAIT STAGE (Single Artwork Morph + 3-Card Swipe Carousel) ==================== -->
      <div v-else class="np-content">
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

        <!-- Fixed-Geometry Stage Host: ZERO flex height shifts & ONE persistent shared artwork! -->
        <div ref="stageHostRef" class="np-stage-host">
          <!-- Floating Sleep Timer Pill (cover mode) -->
          <Transition name="am-expand">
            <div
              v-if="player.sleepTimerBadge && ui.nowPlayingMode === 'cover'"
              class="np-sleep-pill-holder"
            >
              <button
                type="button"
                class="np-glass-chip px-3 py-1 rounded-full text-[11px] font-semibold text-white/90 inline-flex items-center gap-1 am-tap"
                @click="ui.openSongActions(player.currentSong)"
              >
                <Icon :icon="iconMoon" class="w-3.5 h-3.5" />
                <span class="tabular-nums">{{ player.sleepTimerBadge }}</span>
              </button>
            </div>
          </Transition>

          <!-- SIBLING PREV COVER CARD (Only mounted during interactive horizontal cover swipe!) -->
          <div
            v-if="isCarouselActive && activePrevCoverUrl"
            class="np-sibling-artwork"
            :style="prevSiblingStyle"
            aria-hidden="true"
          >
            <img :src="activePrevCoverUrl" decoding="async" class="w-full h-full object-cover" alt="" />
          </div>

          <!-- SINGLE PERSISTENT SHARED ARTWORK (Always opacity:1, pure GPU transform -> ZERO flicker!) -->
          <div
            class="np-shared-artwork"
            :style="sharedArtworkStyle"
            @click="onSharedArtworkClick"
            @touchstart.passive="onCoverTouchStart"
            @touchmove.passive="onCoverTouchMove"
            @touchend.passive="onCoverTouchEnd"
          >
            <Transition :name="skipArtXfade ? '' : 'art-xfade'">
              <img
                v-if="activeCurrentCoverUrl"
                :key="activeCurrentCoverUrl"
                :src="activeCurrentCoverUrl"
                decoding="async"
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

          <!-- SIBLING NEXT COVER CARD (Only mounted during interactive horizontal cover swipe!) -->
          <div
            v-if="isCarouselActive && activeNextCoverUrl"
            class="np-sibling-artwork"
            :style="nextSiblingStyle"
            aria-hidden="true"
          >
            <img :src="activeNextCoverUrl" decoding="async" class="w-full h-full object-cover" alt="" />
          </div>

          <!-- Persistent Mini Header (absolute top inside stage host -> ZERO layout reflow!) -->
          <div
            class="np-mini-header"
            :class="{ 'is-visible': ui.nowPlayingMode !== 'cover' }"
          >
            <button
              type="button"
              class="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0"
              @click="returnToCover"
            >
              <!-- Transparent layout slot where `.np-shared-artwork` lands in Lyrics/Queue mode -->
              <div ref="miniSlotRef" class="np-mini-slot" aria-hidden="true" />
              <div class="np-mini-meta min-w-0 flex-1">
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
                class="np-glass-chip h-9 px-2.5 rounded-full text-[11px] font-semibold text-white/90 tabular-nums am-tap"
                :class="{ '!bg-white/30 !text-white': showLyricOffsetBar || currentLyricOffsetMs !== 0 }"
                @click="showLyricOffsetBar = !showLyricOffsetBar; revealLyricsHud(true); echoSystem.haptic('selection')"
              >
                {{ currentLyricOffsetMs !== 0 ? lyricOffsetLabel : t('np.lyricOffset') }}
              </button>
              <button
                v-if="ui.nowPlayingMode === 'lyrics'"
                type="button"
                class="np-circle-btn np-glass-chip am-tap"
                :aria-label="t('song.poster')"
                @click="ui.lyricPosterSong = player.currentSong"
              >
                <Icon :icon="iconPhoto" class="w-5 h-5" />
              </button>
              <button
                v-if="ui.nowPlayingMode === 'lyrics' && player.lyrics.hasTranslation"
                type="button"
                class="np-circle-btn np-glass-chip am-tap"
                :class="{ '!bg-white/30 !text-white': settings.showTranslation }"
                aria-label="Toggle translation"
                @click="settings.showTranslation = !settings.showTranslation; echoSystem.haptic('selection')"
              >
                <Icon :icon="iconLanguage" class="w-5 h-5" />
              </button>
              <button
                type="button"
                class="np-circle-btn np-glass-chip am-tap"
                aria-label="More options"
                @click="ui.openSongActions(player.currentSong)"
              >
                <Icon :icon="iconDots" class="w-5 h-5" />
              </button>
            </div>
          </div>

          <!-- Floating Lyric Offset Adjuster (Delay / Advance Lyrics Sync) -->
          <Transition name="am-expand">
            <div
              v-if="ui.nowPlayingMode === 'lyrics' && showLyricOffsetBar"
              class="np-offset-bar"
            >
              <button
                type="button"
                class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap"
                @click="nudgeLyricOffset(-1000)"
              >
                -1s
              </button>
              <button
                type="button"
                class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap"
                @click="nudgeLyricOffset(-500)"
              >
                -0.5s
              </button>
              <button
                type="button"
                class="np-glass-chip h-7 px-3 rounded-full text-[11px] font-bold text-white/95 tabular-nums am-tap"
                @click="resetLyricOffset"
              >
                {{
                  currentLyricOffsetMs > 0
                    ? `提前 ${lyricOffsetLabel}`
                    : currentLyricOffsetMs < 0
                      ? `延后 ${lyricOffsetLabel}`
                      : `${t('np.lyricOffset')} 0.0s`
                }}
              </button>
              <button
                type="button"
                class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap"
                @click="nudgeLyricOffset(500)"
              >
                +0.5s
              </button>
              <button
                type="button"
                class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap"
                @click="nudgeLyricOffset(1000)"
              >
                +1s
              </button>
            </div>
          </Transition>

          <!-- PERSISTENT LAYER 1: COVER STAGE -->
          <div
            class="np-pane np-pane-cover np-cover-stage"
            :class="{ 'is-active': ui.nowPlayingMode === 'cover' }"
            @touchstart.passive="onCoverTouchStart"
            @touchmove.passive="onCoverTouchMove"
            @touchend.passive="onCoverTouchEnd"
          >
            <div class="np-artwork-wrap">
              <!-- Transparent layout slot where `.np-shared-artwork` rests in Cover mode -->
              <div ref="coverSlotRef" class="np-artwork-slot" aria-hidden="true" />
            </div>

            <!-- Cover Page 2-Line Live Lyrics Preview -->
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
              <div class="min-w-0 flex-1 pr-3">
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
                  class="np-circle-btn np-glass-chip am-tap"
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
                  class="np-circle-btn np-glass-chip am-tap"
                  aria-label="更多选项"
                  @click="ui.openSongActions(player.currentSong)"
                >
                  <Icon :icon="iconDots" class="w-[21px] h-[21px] text-white/95" />
                </button>
              </div>
            </div>
          </div>

          <!-- PERSISTENT LAYER 2: WORD-BY-WORD KRC LYRICS -->
          <div
            class="np-pane np-pane-detail"
            :class="{ 'is-active': ui.nowPlayingMode === 'lyrics' }"
          >
            <KrcLyricsView
              :active="ui.nowPlayingOpen && !isLandscape && ui.nowPlayingMode === 'lyrics'"
              @user-scroll="onLyricsUserScroll"
              @tap-blank="onLyricsTapBlank"
              @line-seek="scheduleLyricsAutoHide"
            />
          </div>

          <!-- PERSISTENT LAYER 3: WINDOWED UP NEXT QUEUE -->
          <div
            class="np-pane np-pane-detail flex flex-col px-6 pt-[72px] pb-2"
            :class="{ 'is-active': ui.nowPlayingMode === 'queue' }"
          >
            <div class="flex items-center justify-between gap-2 mb-3 shrink-0">
              <div class="min-w-0">
                <h2 class="text-[17px] font-bold text-white">{{ t('np.upNext') }}</h2>
                <p class="text-[12px] text-white/55 truncate">
                  {{ t('np.queueMeta', { count: player.queue.length, mode: playModeLabel }) }}
                </p>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="np-glass-chip px-3 py-1.5 rounded-full text-white text-[12px] font-medium flex items-center gap-1.5 am-tap"
                  @click="player.cyclePlayMode()"
                >
                  <Icon :icon="playModeIcon" class="w-4 h-4" />
                  <span>{{ playModeLabel }}</span>
                </button>
                <button
                  type="button"
                  class="np-glass-chip w-8 h-8 rounded-full text-white/80 flex items-center justify-center am-tap"
                  :aria-label="t('np.clearQueue')"
                  @click="handleClearQueue"
                >
                  <Icon :icon="iconTrash" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="flex-1 am-scroll -mx-2 px-2 space-y-1">
              <button
                v-if="queueWindow.hasPrev"
                type="button"
                class="w-full py-2 mb-1 rounded-xl bg-white/10 text-white/80 text-[12px] font-semibold border-0 am-tap"
                @click="expandQueuePrev"
              >
                ↑ {{ t('common.loadMore') }} ({{ queueWindow.prevCount }})
              </button>

              <div
                v-for="row in visibleQueueItems"
                :key="`${row.item.id}-${row.index}`"
                class="np-queue-row flex items-center gap-2.5 p-2 rounded-xl transition-colors"
                :class="row.index === player.currentIndex ? 'bg-white/18' : 'active:bg-white/10'"
                @click="player.playQueue(player.queue, row.index)"
              >
                <div class="w-11 h-11 rounded-[9px] overflow-hidden shrink-0 bg-white/10">
                  <img
                    v-if="row.item.coverUrl"
                    :src="row.item.coverUrl"
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                    alt=""
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div
                    class="text-[15px] font-medium truncate"
                    :class="row.index === player.currentIndex ? 'text-white' : 'text-white/90'"
                  >
                    {{ row.item.title }}
                  </div>
                  <div class="text-[13px] text-white/55 truncate">{{ row.item.artist }}</div>
                </div>
                <button
                  v-if="row.index !== player.currentIndex && row.index !== player.currentIndex + 1"
                  type="button"
                  class="w-8 h-8 rounded-full flex items-center justify-center text-white/65 bg-transparent border-0 am-tap shrink-0"
                  :aria-label="t('np.pinNext')"
                  @click.stop="player.moveQueueItemNext(row.index)"
                >
                  <Icon :icon="iconPlayerTrackNext" class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full flex items-center justify-center text-white/50 bg-transparent border-0 am-tap shrink-0"
                  aria-label="Remove"
                  @click.stop="player.removeFromQueue(row.index)"
                >
                  <Icon :icon="iconX" class="w-4 h-4" />
                </button>
              </div>

              <button
                v-if="queueWindow.hasNext"
                type="button"
                class="w-full py-2 mt-1 rounded-xl bg-white/10 text-white/80 text-[12px] font-semibold border-0 am-tap"
                @click="expandQueueNext"
              >
                ↓ {{ t('common.loadMore') }} ({{ queueWindow.nextCount }})
              </button>
            </div>
          </div>
        </div>

        <!-- Scrubber & Transport Controls -->
        <div
          class="np-controls"
          :class="{ 'is-immersive-hidden': isLyricsImmersive }"
        >
          <div class="px-1">
            <div
              class="scrub-hit"
              @pointerdown="onScrubPointerDown"
              @pointermove="onScrubPointerMove"
              @pointerup="finishScrub($event, true)"
              @pointercancel="finishScrub($event, false)"
            >
              <div class="scrub-track" :class="{ 'is-scrubbing': scrubbing }">
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
              <div class="flex items-center justify-center gap-1.5 min-w-0">
                <button
                  v-if="player.sourceTag"
                  type="button"
                  class="px-2 py-0.5 rounded-[6px] bg-white/14 text-white/90 text-[10px] font-semibold tracking-wide border-0 truncate am-tap"
                  @click.stop="openAudioEffectSheet"
                >
                  {{ player.sourceTag }}
                </button>
                <button
                  v-if="showChorusJump"
                  type="button"
                  class="px-2 py-0.5 rounded-[6px] bg-white/18 text-white/95 text-[10px] font-semibold tracking-wide border-0 inline-flex items-center gap-0.5 am-tap shrink-0"
                  @click.stop="jumpToChorus"
                >
                  <Icon :icon="iconSparkles" class="w-2.5 h-2.5" />
                  <span>{{ t('np.chorusJump') }}</span>
                </button>
              </div>
              <span>-{{ fmtTime(displayRemainingMs) }}</span>
            </div>
          </div>

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
              class="np-tool-btn am-tap"
              :aria-label="t('np.comments')"
              @click="ui.openSongComments(player.currentSong, 'comments')"
            >
              <Icon :icon="iconMessageCircle" class="w-6 h-6" />
            </button>

            <button
              type="button"
              class="np-tool-btn relative am-tap"
              :class="{ 'text-white': hasActiveAudioDsp }"
              :aria-label="t('audio.sheetTitle')"
              @click="openAudioEffectSheet"
            >
              <Icon :icon="iconAdjustments" class="w-6 h-6" />
              <span v-if="hasActiveAudioDsp" class="np-dsp-dot" />
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
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #ffffff;
  transition: transform 380ms var(--spring-ease);
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

/* ==================== LANDSCAPE DUAL-MODE LAYOUT ==================== */
.np-land-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding-top: calc(var(--safe-top) + 6px);
  padding-bottom: calc(var(--safe-bottom) + 8px);
}

.np-land-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px calc(var(--safe-right) + 20px) 6px calc(var(--safe-left) + 20px);
  flex-shrink: 0;
}

.np-land-seg {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.13);
  border: 0.5px solid rgba(255, 255, 255, 0.18);
}

.np-land-seg-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 11.5px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background-color 200ms ease, color 200ms ease;
}

.np-land-seg-btn.is-active {
  background: rgba(255, 255, 255, 0.92);
  color: #111116;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.22);
}

.np-land-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-land-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(250px, 42%) 1fr;
  gap: 18px;
  padding: 0 calc(var(--safe-right) + 20px) 4px calc(var(--safe-left) + 20px);
}

.np-land-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding-right: 6px;
}

.np-land-art-stage {
  position: relative;
  width: min(44vh, 196px);
  height: min(44vh, 196px);
  flex-shrink: 0;
  overflow: visible;
}

.np-land-art-card {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 18px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.44), 0 4px 12px rgba(0, 0, 0, 0.24);
  will-change: transform, opacity;
  backface-visibility: hidden;
}

.np-land-art-card.is-sibling {
  pointer-events: none;
}

.np-land-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.np-land-skip,
.np-land-play,
.np-land-tool {
  border: 0;
  background: transparent;
  color: #ffffff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-land-tool {
  width: 34px;
  height: 34px;
  color: rgba(255, 255, 255, 0.70);
}

.np-land-skip {
  width: 40px;
  height: 40px;
}

.np-land-play {
  width: 46px;
  height: 46px;
}

/* ==================== PORTRAIT STAGE ==================== */
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

.np-glass-chip {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0.11) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 4px 12px rgba(0, 0, 0, 0.18);
  border: 0.5px solid rgba(255, 255, 255, 0.18);
}

.np-stage-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.np-sleep-pill-holder {
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  z-index: 18;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.np-sleep-pill-holder > button {
  pointer-events: auto;
}

/* Interactive 3-Card Sibling Peeks (pure GPU transform/opacity, zero reflow!) */
.np-sibling-artwork {
  position: absolute;
  z-index: 23;
  border-radius: 22px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transform-origin: center center;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
  will-change: transform, opacity;
  backface-visibility: hidden;
  pointer-events: none;
}

/* SINGLE PERSISTENT SHARED ARTWORK LAYER (Always opacity:1 -> mathematically flicker-free!) */
.np-shared-artwork {
  position: absolute;
  z-index: 24;
  border-radius: 22px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transform-origin: center center;
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.44), 0 6px 16px rgba(0, 0, 0, 0.26);
  transition: transform 390ms var(--spring-ease), opacity 240ms ease;
  will-change: transform, opacity;
  backface-visibility: hidden;
  cursor: pointer;
}

/* Fixed-position Mini Header inside stage host -> zero height shift! */
.np-mini-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 24px 8px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 200ms ease,
    visibility 0s linear 220ms;
  will-change: opacity;
}

.np-mini-header.is-visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 240ms ease 40ms,
    visibility 0s linear 0s;
}

.np-mini-slot {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  pointer-events: none;
}

.np-mini-meta {
  transform: translate3d(0, 10px, 0);
  transition: transform 340ms var(--spring-ease);
  will-change: transform;
}

.np-mini-header.is-visible .np-mini-meta {
  transform: translate3d(0, 0, 0);
}

.np-mini-actions {
  transform: translate3d(10px, 0, 0);
  opacity: 0;
  transition:
    transform 320ms var(--spring-ease),
    opacity 220ms ease;
  will-change: transform, opacity;
}

.np-mini-header.is-visible .np-mini-actions {
  transform: translate3d(0, 0, 0);
  opacity: 1;
  transition-delay: 60ms;
}

.np-offset-bar {
  position: absolute;
  top: 64px;
  left: 0;
  right: 0;
  z-index: 22;
  padding: 2px 24px 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* Persistent GPU-Composited Stage Panes */
.np-pane {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  will-change: transform, opacity;
  backface-visibility: hidden;
  transition:
    opacity 210ms ease,
    transform 340ms var(--spring-ease),
    visibility 0s linear 340ms;
}

.np-pane-cover {
  transform: none;
}

.np-pane-cover .np-cover-lyrics,
.np-pane-cover .np-meta-row {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
  transition:
    opacity 220ms ease,
    transform 320ms var(--spring-ease);
}

.np-pane-cover.is-active .np-cover-lyrics,
.np-pane-cover.is-active .np-meta-row {
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transition-delay: 45ms;
}

.np-pane-detail {
  padding-top: 64px;
  transform: translate3d(0, 20px, 0) scale3d(0.985, 0.985, 1);
}

.np-pane.is-active {
  z-index: 6;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate3d(0, 0, 0) scale3d(1, 1, 1);
  transition:
    opacity 240ms ease 20ms,
    transform 360ms var(--spring-ease),
    visibility 0s linear 0s;
}

.np-cover-stage {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px 28px 14px;
}

.np-artwork-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
}

.np-artwork-slot {
  width: min(79vw, 336px);
  max-height: 100%;
  max-width: 100%;
  aspect-ratio: 1;
  pointer-events: none;
}

.art-layer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.art-xfade-enter-active,
.art-xfade-leave-active {
  transition: opacity 340ms ease, transform 420ms var(--spring-ease);
}
.art-xfade-enter-from {
  opacity: 0;
  transform: scale(1.04);
}
.art-xfade-leave-to {
  opacity: 0;
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

.np-queue-row {
  contain: layout style;
}

.heart-burst-overlay {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.16);
  pointer-events: none;
}

.heart-pop-enter-active {
  animation: heart-pop-kf 560ms var(--spring-bounce);
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
  margin-top: 12px;
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
  padding: 4px 28px 6px;
  flex-shrink: 0;
  max-height: 240px;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transition:
    max-height 380ms var(--spring-ease),
    opacity 240ms ease,
    transform 360ms var(--spring-ease),
    padding 340ms var(--spring-ease);
}

.np-controls.is-immersive-hidden {
  max-height: 0;
  opacity: 0;
  transform: translate3d(0, 26px, 0);
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
  pointer-events: none;
}

.scrub-hit {
  position: relative;
  z-index: 30;
  padding: 14px 0 8px;
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
  transition: height 180ms var(--spring-ease);
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
}

.scrub-fill {
  position: relative;
  z-index: 1;
  height: 100%;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 999px;
}

.np-transport {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
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
  padding-top: 2px;
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
    background-color 220ms ease,
    color 220ms ease,
    transform 200ms var(--spring-bounce);
}

.np-tool-btn.is-on {
  background: rgba(255, 255, 255, 0.92);
  color: #111111;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
}

.np-dsp-dot {
  position: absolute;
  top: 5px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #67b0ff;
  box-shadow: 0 0 8px rgba(103, 176, 255, 0.85);
}
</style>
