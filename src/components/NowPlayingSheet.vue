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
import iconDeviceMobileRotated from '@iconify/icons-tabler/device-mobile-rotated';
import type { SongClimaxRange } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { openArtistProfileFromSong } from '@/services/playback/artistNavigation';
import {
  computeCoverCarouselLayout,
  computeQueueWindow,
  computeSharedArtworkTransform,
  getRingSlotAssignment,
  rotateRingCenter,
  stepCriticallyDampedSpring,
  type BoxRect,
  type RingSlotId,
} from '@/utils/heroMorph';
import { useDecodedCover } from '@/composables/useDecodedCover';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import FluidCoverBackground from './FluidCoverBackground.vue';
import KrcLyricsView from './KrcLyricsView.vue';
import LandscapeStudioStage from './LandscapeStudioStage.vue';

const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { t } = useI18n();

// Double-buffered pre-decoded cover URL: zero empty gray flash on track switch!
const { displayedCoverUrl } = useDecodedCover(() => player.currentSong?.coverUrl || '');

// Explicit user-controlled true-fullscreen landscape playback (phone stays locked portrait unless toggled!)
const isLandscape = computed(() => ui.nowPlayingLandscape);

function enterLandscapeMode() {
  ui.setNowPlayingLandscape(true);
}

function handleViewportResize() {
  if (!isLandscape.value && ui.nowPlayingOpen) {
    measureArtworkSlots();
  }
}

watch(isLandscape, (next) => {
  if (!next && ui.nowPlayingOpen) {
    artworkReadyForTransition.value = false;
    void nextTick(() => {
      measureArtworkSlots();
      attachSlotObserver();
      readyRaf1 = requestAnimationFrame(() => {
        measureArtworkSlots();
        readyRaf2 = requestAnimationFrame(() => {
          artworkReadyForTransition.value = true;
        });
      });
    });
  } else {
    detachSlotObserver();
  }
});

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('orientationchange', handleViewportResize);
  }
});

// Track extras: Chorus Climax marker (no comment count badge!)
const climaxRange = ref<SongClimaxRange | null>(null);
const showLyricOffsetBar = ref(false);

// Adjacent queue songs for 3-slot ring cover carousel
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

// Background pre-decode adjacent covers so frame 1 of horizontal drag is 100% crisp
const predecodedUrls = new Set<string>();
function preloadCoverImage(url?: string) {
  if (!url || predecodedUrls.has(url) || typeof Image === 'undefined') return;
  predecodedUrls.add(url);
  if (predecodedUrls.size > 48) {
    const first = predecodedUrls.values().next().value;
    if (first) predecodedUrls.delete(first);
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (typeof img.decode === 'function') {
    void img.decode().catch(() => {});
  }
}

watch(
  () => [prevQueueSong.value?.coverUrl, nextQueueSong.value?.coverUrl],
  ([prevUrl, nextUrl]) => {
    preloadCoverImage(prevUrl);
    preloadCoverImage(nextUrl);
  },
  { immediate: true },
);

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

// ==================== DIRECT-DOM 3-SLOT RING CAROUSEL & HERO MORPH ====================
// Three permanent DOM card slots (0, 1, 2) rotate in-place on swipe commit:
// - Dragging mutates DOM transforms directly inside rAF -> ZERO Vue re-renders per frame!
// - On swipe commit, the incoming card glides to tx=0 and BECOMES centerSlotId in-place ->
//   0.00px teleport delta, mathematically IMPOSSIBLE to bounce back from the opposite direction!
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

const RING_SLOT_IDS: readonly RingSlotId[] = [0, 1, 2];
const centerSlotId = ref<RingSlotId>(0);
const slotUrls = ref<[string, string, string]>(['', '', '']);
const slotEls: Array<HTMLElement | null> = [null, null, null];

function setSlotEl(id: RingSlotId, el: unknown) {
  slotEls[id] = el instanceof HTMLElement ? el : null;
}

const ringAssignment = computed(() => getRingSlotAssignment(centerSlotId.value));

function syncIdleSlotUrls() {
  const assign = getRingSlotAssignment(centerSlotId.value);
  const nextUrls: [string, string, string] = [...slotUrls.value];
  nextUrls[assign.center] = displayedCoverUrl.value || player.currentSong?.coverUrl || '';
  nextUrls[assign.prev] = prevQueueSong.value?.coverUrl || '';
  nextUrls[assign.next] = nextQueueSong.value?.coverUrl || '';
  slotUrls.value = nextUrls;
}

const dragOffsetY = ref(0);
const isDraggingSheet = ref(false);
const heartBurst = ref(false);

// Non-reactive 120Hz gesture & spring state (ZERO Vue reactivity overhead while swiping!)
let ringSwipeActive = false;
let ringDragX = 0;
let ringTargetX = 0;
let ringVelocity = 0; // px/sec
let ringCommitDir: 'next' | 'prev' | null = null;
let ringRafId = 0;
let ringRafLast = 0;
let sheetTouchY = 0;
let coverTouchStartX = 0;
let coverTouchStartY = 0;
let coverLastTouchX = 0;
let coverLastTouchTime = 0;
let coverGestureAxis: 'none' | 'x' | 'y' = 'none';
let lastCoverTapAt = 0;
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;

function getPortraitStride(): number {
  return Math.max(220, (coverSlotRect.value?.width || 300) + 34);
}

function stopRingSpring() {
  if (ringRafId) {
    cancelAnimationFrame(ringRafId);
    ringRafId = 0;
  }
  ringRafLast = 0;
}

function clearRingDirectStyles() {
  for (const id of RING_SLOT_IDS) {
    const el = slotEls[id];
    if (!el) continue;
    el.style.removeProperty('transition');
    el.style.removeProperty('transform');
    el.style.removeProperty('opacity');
    el.style.removeProperty('z-index');
  }
}

/**
 * Writes synchronized GPU transforms directly to the 3 ring slot DOM nodes (0 Vue VDOM diff!).
 */
function paintRingDirect(tx: number) {
  const assign = getRingSlotAssignment(centerSlotId.value);
  const stride = getPortraitStride();
  const baseScale = player.isPlaying ? 1 : 0.84;
  const layout = computeCoverCarouselLayout(tx, stride, baseScale);

  const applyOne = (id: RingSlotId, transform: string, opacity: number, zIndex: number) => {
    const el = slotEls[id];
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = transform;
    el.style.opacity = String(opacity);
    el.style.zIndex = String(zIndex);
  };

  applyOne(assign.prev, layout.prev.transform, slotUrls.value[assign.prev] ? layout.prev.opacity : 0, 23);
  applyOne(assign.center, layout.current.transform, layout.current.opacity, 24);
  applyOne(assign.next, layout.next.transform, slotUrls.value[assign.next] ? layout.next.opacity : 0, 23);
}

function finishRingSpring() {
  stopRingSpring();
  const committed = ringCommitDir;
  ringCommitDir = null;
  ringDragX = 0;
  ringTargetX = 0;
  ringVelocity = 0;

  if (committed) {
    // Rotate ring center in-place: the incoming slot already sitting at tx=0 stays at tx=0!
    centerSlotId.value = rotateRingCenter(centerSlotId.value, committed);
  }

  // Keep transition disabled while Vue commits the rotated idle styles so 0 reverse motion occurs
  for (const id of RING_SLOT_IDS) {
    const el = slotEls[id];
    if (el) el.style.transition = 'none';
  }

  ringSwipeActive = false;
  syncIdleSlotUrls();

  void nextTick(() => {
    // Flush style snapshot in idle coordinates before releasing inline transition override
    clearRingDirectStyles();
    for (const id of RING_SLOT_IDS) {
      const el = slotEls[id];
      if (el) {
        el.style.transition = 'none';
        void el.offsetWidth;
      }
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const id of RING_SLOT_IDS) {
          const el = slotEls[id];
          if (el) el.style.removeProperty('transition');
        }
      });
    });
  });
}

function stepRingSpring(now: number) {
  const dt = ringRafLast > 0 ? (now - ringRafLast) / 1000 : 1 / 120;
  ringRafLast = now;

  const step = stepCriticallyDampedSpring(ringDragX, ringTargetX, ringVelocity, dt, 16.5, 0.5, 10);
  ringDragX = step.position;
  ringVelocity = step.velocity;
  paintRingDirect(ringDragX);

  if (step.settled) {
    finishRingSpring();
    return;
  }
  ringRafId = requestAnimationFrame(stepRingSpring);
}

watch(
  () => [displayedCoverUrl.value, prevQueueSong.value?.coverUrl, nextQueueSong.value?.coverUrl],
  () => {
    if (!ringSwipeActive && !ringCommitDir) {
      syncIdleSlotUrls();
    }
  },
  { immediate: true },
);

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

function getSlotIdleStyle(slotId: RingSlotId) {
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

  const assign = ringAssignment.value;
  const stride = getPortraitStride();

  if (slotId === assign.center) {
    const tf = computeSharedArtworkTransform(cr, mr, {
      mode: ui.nowPlayingMode,
      isPlaying: player.isPlaying,
      swipeX: 0,
    });
    return {
      ...basePos,
      transform: tf.transform,
      opacity: '1',
      zIndex: '24',
      transition: artworkReadyForTransition.value ? undefined : 'none',
    };
  }

  // Off-screen sibling slot rests invisibly at -stride / +stride
  const offX = slotId === assign.prev ? -stride : stride;
  return {
    ...basePos,
    transform: `perspective(1000px) translate3d(${offX.toFixed(2)}px, 0, 0) scale3d(0.84, 0.84, 1)`,
    opacity: '0',
    zIndex: '23',
    pointerEvents: 'none' as const,
    transition: 'none',
  };
}

// ---- Track Extras & Climax ----

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
      artworkReadyForTransition.value = false;
      syncIdleSlotUrls();
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
      if (ui.nowPlayingLandscape) {
        ui.setNowPlayingLandscape(false);
      }
      detachSlotObserver();
      stopRingSpring();
      clearRingDirectStyles();
      ringSwipeActive = false;
      ringCommitDir = null;
      ringDragX = 0;
      artworkReadyForTransition.value = false;
      isDraggingSheet.value = false;
      dragOffsetY.value = 0;
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
  stopRingSpring();
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

// ---- Cover Gestures: 120Hz Direct-DOM 3-Slot Ring Swipe / Drag Down Dismiss / Double-Tap Heart ----

function onCoverTouchStart(e: TouchEvent) {
  if (isLandscape.value || ui.nowPlayingMode !== 'cover') return;
  // If a prior commit spring was still settling, finalize it immediately so rapid flicks feel instant!
  if (ringCommitDir) {
    finishRingSpring();
  } else {
    stopRingSpring();
  }
  const touch = e.touches[0];
  if (!touch) return;
  coverTouchStartX = touch.clientX;
  coverTouchStartY = touch.clientY;
  coverLastTouchX = touch.clientX;
  coverLastTouchTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  ringVelocity = 0;
  coverGestureAxis = 'none';
}

function onCoverTouchMove(e: TouchEvent) {
  if (isLandscape.value || ui.nowPlayingMode !== 'cover') return;
  const touch = e.touches[0];
  if (!touch) return;
  const dx = touch.clientX - coverTouchStartX;
  const dy = touch.clientY - coverTouchStartY;

  if (coverGestureAxis === 'none') {
    if (Math.abs(dx) > 9 || Math.abs(dy) > 9) {
      coverGestureAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (coverGestureAxis === 'x') {
        ringSwipeActive = true;
      } else if (coverGestureAxis === 'y' && dy > 0) {
        isDraggingSheet.value = true;
      }
    }
  }

  if (coverGestureAxis === 'x') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(4, now - coverLastTouchTime);
    ringVelocity = ((touch.clientX - coverLastTouchX) / dt) * 1000;
    coverLastTouchX = touch.clientX;
    coverLastTouchTime = now;

    const hasSiblings = player.queue.length > 1;
    ringDragX = hasSiblings ? dx * 0.96 : dx * 0.24;
    paintRingDirect(ringDragX);
  } else if (coverGestureAxis === 'y' && dy > 0) {
    isDraggingSheet.value = true;
    dragOffsetY.value = dy * 0.85;
  }
}

function onCoverTouchEnd(e: TouchEvent) {
  if (isLandscape.value || ui.nowPlayingMode !== 'cover') return;
  const touch = e.changedTouches[0];
  const dx = (touch?.clientX ?? coverTouchStartX) - coverTouchStartX;
  const dy = (touch?.clientY ?? coverTouchStartY) - coverTouchStartY;

  isDraggingSheet.value = false;

  if (coverGestureAxis === 'x') {
    const stride = getPortraitStride();
    const hasSiblings = player.queue.length > 1;
    const commitNext = hasSiblings && (dx < -stride * 0.22 || (ringVelocity < -420 && dx < -18));
    const commitPrev = hasSiblings && (dx > stride * 0.22 || (ringVelocity > 420 && dx > 18));

    if (commitNext || commitPrev) {
      ringCommitDir = commitNext ? 'next' : 'prev';
      ringTargetX = commitNext ? -stride : stride;
      if (commitNext) void player.next();
      else void player.previous(true);
    } else {
      ringCommitDir = null;
      ringTargetX = 0;
    }

    ringRafLast = typeof performance !== 'undefined' ? performance.now() : 0;
    ringRafId = requestAnimationFrame(stepRingSpring);
  } else if (coverGestureAxis === 'y') {
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

function onSharedArtworkClick(slotId: RingSlotId) {
  if (slotId !== centerSlotId.value) return;
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

const fluidBgActive = computed(
  () =>
    ui.nowPlayingOpen &&
    !isLandscape.value &&
    ui.nowPlayingMode !== 'lyrics' &&
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

      <!-- ==================== LANDSCAPE 3-MODE STUDIO (Vinyl / Cover Flow / Cinema) ==================== -->
      <LandscapeStudioStage
        v-if="isLandscape"
        :active="ui.nowPlayingOpen && isLandscape"
        :displayed-cover-url="displayedCoverUrl"
        :climax-range="climaxRange"
      />

      <!-- ==================== PORTRAIT STAGE (Direct-DOM 3-Slot Ring + Hero Morph) ==================== -->
      <div v-else class="np-content">
        <div
          class="np-handle-area"
          @click="ui.nowPlayingOpen = false"
          @touchstart.passive="onHandleTouchStart"
          @touchmove.passive="onHandleTouchMove"
          @touchend.passive="onHandleTouchEnd"
        >
          <div class="np-handle" />
          <button
            v-if="ui.nowPlayingMode === 'cover'"
            type="button"
            class="np-landscape-trigger np-glass-chip am-tap"
            :aria-label="t('np.enterLandscape')"
            data-enter-landscape-btn
            @click.stop="enterLandscapeMode"
          >
            <Icon :icon="iconDeviceMobileRotated" class="w-4 h-4 text-white/92" />
          </button>
        </div>

        <div ref="stageHostRef" class="np-stage-host" data-ring-carousel>
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

          <!-- 3 PERMANENT RING ARTWORK SLOTS (0, 1, 2): zero unmount, zero teleport, zero opposite rebound! -->
          <div
            v-for="slotId in RING_SLOT_IDS"
            :key="slotId"
            :ref="(el) => setSlotEl(slotId, el)"
            class="np-shared-artwork"
            :class="{ 'is-center-slot': slotId === centerSlotId }"
            :style="getSlotIdleStyle(slotId)"
            @click="onSharedArtworkClick(slotId)"
            @touchstart.passive="onCoverTouchStart"
            @touchmove.passive="onCoverTouchMove"
            @touchend.passive="onCoverTouchEnd"
          >
            <img
              v-if="slotUrls[slotId]"
              :src="slotUrls[slotId]"
              decoding="async"
              :alt="slotId === centerSlotId ? player.currentSong.title : ''"
              class="art-layer w-full h-full object-cover"
            />
            <div
              v-else
              class="art-layer w-full h-full flex items-center justify-center bg-white/10 text-white/40"
            >
              <Icon :icon="iconMusic" class="w-20 h-20" />
            </div>

            <Transition name="heart-pop">
              <div v-if="heartBurst && slotId === centerSlotId" class="heart-burst-overlay">
                <Icon :icon="iconHeartFilled" class="w-20 h-20 text-[#ff375f] drop-shadow-2xl" />
              </div>
            </Transition>
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
                :aria-label="t('np.enterLandscape')"
                data-enter-landscape-btn
                @click="enterLandscapeMode"
              >
                <Icon :icon="iconDeviceMobileRotated" class="w-4.5 h-4.5" />
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

          <!-- Floating Lyric Offset Adjuster -->
          <Transition name="am-expand">
            <div
              v-if="ui.nowPlayingMode === 'lyrics' && showLyricOffsetBar"
              class="np-offset-bar"
            >
              <button type="button" class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(-1000)">-1s</button>
              <button type="button" class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(-500)">-0.5s</button>
              <button type="button" class="np-glass-chip h-7 px-3 rounded-full text-[11px] font-bold text-white/95 tabular-nums am-tap" @click="resetLyricOffset">
                {{
                  currentLyricOffsetMs > 0
                    ? `提前 ${lyricOffsetLabel}`
                    : currentLyricOffsetMs < 0
                      ? `延后 ${lyricOffsetLabel}`
                      : `${t('np.lyricOffset')} 0.0s`
                }}
              </button>
              <button type="button" class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(500)">+0.5s</button>
              <button type="button" class="np-glass-chip h-7 px-2.5 rounded-full text-[11px] font-semibold text-white tabular-nums am-tap" @click="nudgeLyricOffset(1000)">+1s</button>
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
              <div ref="coverSlotRef" class="np-artwork-slot" aria-hidden="true" />
            </div>

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

          <!-- PERSISTENT LAYER 2: 120HZ CANVAS ZERO-FLICKER LYRICS (constant height, zero reflow!) -->
          <div
            class="np-pane np-pane-detail np-pane-lyrics"
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
            class="np-pane np-pane-detail np-pane-queue flex flex-col px-6 pt-[72px]"
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

        <!-- Pure-GPU Floating Overlay Scrubber & Transport Controls (ZERO layout reflow!) -->
        <div
          class="np-controls"
          :class="{
            'is-immersive-hidden': isLyricsImmersive,
            'is-lyrics-backdrop': ui.nowPlayingMode === 'lyrics',
          }"
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
                <div v-if="climaxBarStyle" class="scrub-climax" :style="climaxBarStyle" />
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
              <Icon :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled" class="w-12 h-12" />
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
}

.np-handle-area {
  position: relative;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.np-landscape-trigger {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
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

/* 3 Permanent Ring Artwork Slots: active slot handles Cover <-> Mini hero morph cleanly! */
.np-shared-artwork {
  position: absolute;
  border-radius: 22px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  transform-origin: center center;
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.44), 0 6px 16px rgba(0, 0, 0, 0.26);
  transition: transform 390ms var(--spring-ease), opacity 220ms ease;
  will-change: transform, opacity;
  backface-visibility: hidden;
  cursor: pointer;
}

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

.np-pane {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  backface-visibility: hidden;
  transition:
    opacity 220ms ease,
    transform 320ms var(--spring-ease),
    visibility 0s linear 320ms;
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
  transform: translate3d(0, 16px, 0);
}

.np-pane-lyrics {
  padding-bottom: calc(var(--safe-bottom) + 12px);
}

.np-pane-queue {
  padding-bottom: calc(var(--safe-bottom) + 196px);
}

.np-pane.is-active {
  z-index: 6;
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate3d(0, 0, 0);
  transition:
    opacity 240ms ease 20ms,
    transform 340ms var(--spring-ease),
    visibility 0s linear 0s;
}

.np-cover-stage {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px 28px calc(var(--safe-bottom) + 202px);
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
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 25;
  padding: 8px 28px calc(var(--safe-bottom) + 14px);
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transition:
    opacity 260ms ease,
    transform 360ms var(--spring-ease),
    background 260ms ease;
}

.np-controls.is-lyrics-backdrop {
  padding-top: 24px;
  background: linear-gradient(
    180deg,
    rgba(10, 12, 20, 0) 0%,
    rgba(10, 12, 20, 0.48) 32%,
    rgba(10, 12, 20, 0.78) 100%
  );
}

.np-controls.is-immersive-hidden {
  opacity: 0;
  transform: translate3d(0, 100%, 0);
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
