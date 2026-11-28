<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconDisc from '@iconify/icons-tabler/disc';
import iconCarouselHorizontal from '@iconify/icons-tabler/carousel-horizontal';
import iconMovie from '@iconify/icons-tabler/movie';
import iconX from '@iconify/icons-tabler/x';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconDots from '@iconify/icons-tabler/dots';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconPlayerPauseFilled from '@iconify/icons-tabler/player-pause-filled';
import iconPlayerTrackNextFilled from '@iconify/icons-tabler/player-track-next-filled';
import iconPlayerTrackPrevFilled from '@iconify/icons-tabler/player-track-prev-filled';
import iconMessageCircle from '@iconify/icons-tabler/message-circle';
import iconAdjustments from '@iconify/icons-tabler/adjustments';
import iconPlaylist from '@iconify/icons-tabler/playlist';
import iconLanguage from '@iconify/icons-tabler/language';
import iconMusic from '@iconify/icons-tabler/music';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconRepeat from '@iconify/icons-tabler/repeat';
import iconRepeatOnce from '@iconify/icons-tabler/repeat-once';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconTrash from '@iconify/icons-tabler/trash';
import type { SongClimaxRange } from '@/types/music';
import { openArtistProfileFromSong } from '@/services/playback/artistNavigation';
import { computeQueueWindow, stepCriticallyDampedSpring } from '@/utils/heroMorph';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import KrcLyricsView from './KrcLyricsView.vue';
import CoverFlowStage from './CoverFlowStage.vue';

const props = defineProps<{
  active: boolean;
  displayedCoverUrl: string;
  climaxRange: SongClimaxRange | null;
}>();

const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();
const ui = useUiStore();
const { t } = useI18n();

type LandscapeMode = 'vinyl' | 'coverflow' | 'cinema';
const mode = ref<LandscapeMode>('vinyl');
const rightPane = ref<'lyrics' | 'queue'>('lyrics');
const showOffsetBar = ref(false);
const hudVisible = ref(true);
const heartBurst = ref(false);

let hudHideTimer: ReturnType<typeof setTimeout> | null = null;
let heartBurstTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Auto-hiding Floating Glass HUD (3.5s idle in Vinyl & Cinema modes -> 100% height free!) ----

function clearHudTimer() {
  if (hudHideTimer) {
    clearTimeout(hudHideTimer);
    hudHideTimer = null;
  }
}

function scheduleHudAutoHide() {
  clearHudTimer();
  if (!props.active || mode.value === 'coverflow' || !player.isPlaying || scrubbing.value || showOffsetBar.value || rightPane.value === 'queue') {
    return;
  }
  hudHideTimer = setTimeout(() => {
    if (props.active && mode.value !== 'coverflow' && player.isPlaying && !scrubbing.value && rightPane.value !== 'queue') {
      hudVisible.value = false;
    }
  }, 3500);
}

function revealHud(autoHide = true) {
  hudVisible.value = true;
  if (autoHide) scheduleHudAutoHide();
  else clearHudTimer();
}

function toggleHud() {
  if (mode.value === 'coverflow') return;
  if (hudVisible.value) {
    clearHudTimer();
    hudVisible.value = false;
  } else {
    revealHud(true);
  }
}

function switchMode(next: LandscapeMode) {
  if (mode.value === next) return;
  echoSystem.haptic('selection');
  mode.value = next;
  showOffsetBar.value = false;
  revealHud(next !== 'coverflow');
}

watch(
  () => [props.active, player.isPlaying],
  ([isAct, playing]) => {
    if (!isAct) {
      clearHudTimer();
      hudVisible.value = true;
      return;
    }
    if (!playing) revealHud(false);
    else scheduleHudAutoHide();
  },
  { immediate: true },
);

// ---- Direct-DOM Zero-Rebound Vinyl Disc Gesture (Tap Play / Double-Tap Heart / Horizontal Disc Flick) ----

const vinylDiscRef = ref<HTMLElement | null>(null);
let touchStartX = 0;
let touchStartY = 0;
let lastTouchX = 0;
let lastTouchTime = 0;
let swipeVel = 0;
let dragX = 0;
let gestureAxis: 'none' | 'x' | 'y' = 'none';
let vinylRaf = 0;
let vinylRafLast = 0;
let vinylTarget = 0;
let vinylCommitDir: 'next' | 'prev' | null = null;
let lastTapAt = 0;

function stopVinylAnim() {
  if (vinylRaf) {
    cancelAnimationFrame(vinylRaf);
    vinylRaf = 0;
  }
  vinylRafLast = 0;
}

function applyVinylTransformDirect(tx: number) {
  const el = vinylDiscRef.value;
  if (!el) return;
  const ratio = Math.min(1, Math.abs(tx) / 180);
  const scale = 1 - ratio * 0.1;
  const opacity = Math.max(0.2, 1 - ratio * 0.72);
  el.style.transform = `translate3d(${tx.toFixed(2)}px, 0, 0) scale3d(${scale.toFixed(4)}, ${scale.toFixed(4)}, 1)`;
  el.style.opacity = String(opacity.toFixed(3));
}

function stepVinylSpring(now: number) {
  const dt = vinylRafLast > 0 ? (now - vinylRafLast) / 1000 : 1 / 120;
  vinylRafLast = now;
  const step = stepCriticallyDampedSpring(dragX, vinylTarget, swipeVel, dt, 18, 0.8, 12);
  dragX = step.position;
  swipeVel = step.velocity;
  applyVinylTransformDirect(dragX);

  if (!step.settled) {
    vinylRaf = requestAnimationFrame(stepVinylSpring);
    return;
  }

  stopVinylAnim();
  if (vinylCommitDir) {
    const dir = vinylCommitDir;
    vinylCommitDir = null;
    // Slide new disc in from the direction the user swiped FROM (never opposite rebound!)
    const enterFrom = dir === 'next' ? 140 : -140;
    dragX = enterFrom;
    vinylTarget = 0;
    swipeVel = dir === 'next' ? -420 : 420;
    applyVinylTransformDirect(dragX);
    vinylRafLast = typeof performance !== 'undefined' ? performance.now() : 0;
    vinylRaf = requestAnimationFrame(stepVinylSpring);
  } else {
    const el = vinylDiscRef.value;
    if (el) {
      el.style.transform = '';
      el.style.opacity = '';
    }
  }
}

function onVinylTouchStart(e: TouchEvent) {
  const t0 = e.touches[0];
  if (!t0) return;
  stopVinylAnim();
  vinylCommitDir = null;
  touchStartX = t0.clientX;
  touchStartY = t0.clientY;
  lastTouchX = t0.clientX;
  lastTouchTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  swipeVel = 0;
  dragX = 0;
  gestureAxis = 'none';
}

function onVinylTouchMove(e: TouchEvent) {
  const t0 = e.touches[0];
  if (!t0) return;
  const dx = t0.clientX - touchStartX;
  const dy = t0.clientY - touchStartY;
  if (gestureAxis === 'none' && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
    gestureAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  }
  if (gestureAxis !== 'x') return;

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = Math.max(4, now - lastTouchTime);
  swipeVel = ((t0.clientX - lastTouchX) / dt) * 1000;
  lastTouchX = t0.clientX;
  lastTouchTime = now;
  dragX = player.queue.length > 1 ? dx * 0.9 : dx * 0.25;
  applyVinylTransformDirect(dragX);
}

function onVinylTouchEnd(e: TouchEvent) {
  const t0 = e.changedTouches[0];
  const dx = (t0?.clientX ?? touchStartX) - touchStartX;
  const dy = (t0?.clientY ?? touchStartY) - touchStartY;

  if (gestureAxis === 'x') {
    const hasSiblings = player.queue.length > 1;
    const commitNext = hasSiblings && (dx < -54 || (swipeVel < -380 && dx < -18));
    const commitPrev = hasSiblings && (dx > 54 || (swipeVel > 380 && dx > 18));
    if (commitNext || commitPrev) {
      vinylCommitDir = commitNext ? 'next' : 'prev';
      vinylTarget = commitNext ? -185 : 185;
      if (commitNext) void player.next();
      else void player.previous(true);
    } else {
      vinylCommitDir = null;
      vinylTarget = 0;
    }
    vinylRafLast = typeof performance !== 'undefined' ? performance.now() : 0;
    vinylRaf = requestAnimationFrame(stepVinylSpring);
  } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    const now = Date.now();
    if (now - lastTapAt < 280 && player.currentSong) {
      lastTapAt = 0;
      void player.toggleFavorite(player.currentSong);
      heartBurst.value = true;
      if (heartBurstTimer) clearTimeout(heartBurstTimer);
      heartBurstTimer = setTimeout(() => {
        heartBurst.value = false;
      }, 620);
    } else {
      lastTapAt = now;
      // Single tap platter toggles playback (tonearm drops/lifts smoothly!)
      void player.togglePlay();
      revealHud(true);
    }
  }
  gestureAxis = 'none';
}

// ---- Scrubber & Helpers ----

const scrubbing = ref(false);
const scrubRatio = ref(0);
let scrubPointerId: number | null = null;

const progressRatio = computed(() => {
  if (scrubbing.value) return scrubRatio.value;
  if (!player.durationMs) return 0;
  return Math.max(0, Math.min(1, player.currentTimeMs / player.durationMs));
});

const displayElapsedMs = computed(() =>
  scrubbing.value ? Math.round(scrubRatio.value * player.durationMs) : player.currentTimeMs,
);

const displayRemainingMs = computed(() => Math.max(0, player.durationMs - displayElapsedMs.value));

const climaxBarStyle = computed(() => {
  const clx = props.climaxRange;
  const dur = player.durationMs;
  if (!clx || dur <= 0) return null;
  const startPct = Math.max(0, Math.min(98, (clx.startMs / dur) * 100));
  const endPct = Math.max(startPct + 2, Math.min(100, (clx.endMs / dur) * 100));
  return { left: `${startPct.toFixed(2)}%`, width: `${(endPct - startPct).toFixed(2)}%` };
});

function fmtTime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateScrub(el: HTMLElement, clientX: number) {
  const rect = el.getBoundingClientRect();
  scrubRatio.value = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
}

function onScrubDown(e: PointerEvent) {
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  scrubPointerId = e.pointerId;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  scrubbing.value = true;
  clearHudTimer();
  echoSystem.haptic('selection');
  updateScrub(el, e.clientX);
}

function onScrubMove(e: PointerEvent) {
  if (!scrubbing.value || e.pointerId !== scrubPointerId) return;
  e.stopPropagation();
  updateScrub(e.currentTarget as HTMLElement, e.clientX);
}

function finishScrub(e: PointerEvent, commit: boolean) {
  if (!scrubbing.value || e.pointerId !== scrubPointerId) return;
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  try {
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }
  scrubPointerId = null;
  scrubbing.value = false;
  if (commit && player.durationMs > 0) {
    echoSystem.haptic('light');
    void player.seek(Math.round(scrubRatio.value * player.durationMs));
  }
  scheduleHudAutoHide();
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

function nudgeOffset(deltaMs: number) {
  const key = currentTrackOffsetKey.value;
  if (!key) return;
  echoSystem.haptic('selection');
  revealHud(false);
  settings.adjustLyricOffset(key, deltaMs);
}

function resetOffset() {
  const key = currentTrackOffsetKey.value;
  if (!key) return;
  echoSystem.haptic('light');
  settings.resetLyricOffset(key);
  ui.showToast(t('np.lyricOffsetReset'));
}

const hasActiveAudioDsp = computed(() => settings.eqPreset !== 'flat' || settings.volumeLeveling);

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

const visibleQueueItems = computed(() => {
  const win = computeQueueWindow(player.queue.length, player.currentIndex, 12, 40);
  return player.queue.slice(win.start, win.end).map((item, offset) => ({
    item,
    index: win.start + offset,
  }));
});

async function openCurrentArtist() {
  const s = player.currentSong;
  if (!s) return;
  echoSystem.haptic('light');
  await openArtistProfileFromSong(s, router, ui, {
    resolving: t('artist.resolving'),
    notFound: t('artist.notFound'),
  });
}

onUnmounted(() => {
  clearHudTimer();
  stopVinylAnim();
  if (heartBurstTimer) clearTimeout(heartBurstTimer);
});
</script>

<template>
  <div v-if="player.currentSong" class="ls-root" data-landscape-studio @click="revealHud(true)">
    <!-- Auto-Hiding Floating Mode Pill HUD (ZERO permanent topbar height lost!) -->
    <div
      class="ls-floating-hud"
      :class="{ 'is-hidden': !hudVisible && mode !== 'coverflow' }"
      @click.stop
    >
      <div class="ls-mode-seg">
        <button
          type="button"
          class="ls-mode-btn am-tap"
          :class="{ 'is-active': mode === 'vinyl' }"
          @click="switchMode('vinyl')"
        >
          <Icon :icon="iconDisc" class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t('np.landscapeVinyl') }}</span>
        </button>
        <button
          type="button"
          class="ls-mode-btn am-tap"
          :class="{ 'is-active': mode === 'coverflow' }"
          @click="switchMode('coverflow')"
        >
          <Icon :icon="iconCarouselHorizontal" class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t('np.landscapeCoverFlow') }}</span>
        </button>
        <button
          type="button"
          class="ls-mode-btn am-tap"
          :class="{ 'is-active': mode === 'cinema' }"
          @click="switchMode('cinema')"
        >
          <Icon :icon="iconMovie" class="w-3.5 h-3.5 shrink-0" />
          <span>{{ t('np.landscapeCinema') }}</span>
        </button>
      </div>

      <div class="flex items-center gap-1.5">
        <template v-if="mode === 'vinyl'">
          <button
            v-if="rightPane === 'lyrics'"
            type="button"
            class="ls-pill-chip h-7.5 px-2.5 text-[11px] font-semibold tabular-nums am-tap"
            :class="{ 'is-on': showOffsetBar || currentLyricOffsetMs !== 0 }"
            @click="showOffsetBar = !showOffsetBar; revealHud(!showOffsetBar); echoSystem.haptic('selection')"
          >
            {{ currentLyricOffsetMs !== 0 ? lyricOffsetLabel : t('np.lyricOffset') }}
          </button>
          <button
            v-if="rightPane === 'lyrics' && player.lyrics.hasTranslation"
            type="button"
            class="ls-circle-chip am-tap"
            :class="{ 'is-on': settings.showTranslation }"
            aria-label="Toggle translation"
            @click="settings.showTranslation = !settings.showTranslation; echoSystem.haptic('selection')"
          >
            <Icon :icon="iconLanguage" class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="ls-circle-chip am-tap"
            :class="{ 'is-solid': rightPane === 'queue' }"
            aria-label="Up Next"
            @click="echoSystem.haptic('selection'); rightPane = rightPane === 'queue' ? 'lyrics' : 'queue'; revealHud(rightPane === 'lyrics')"
          >
            <Icon :icon="iconPlaylist" class="w-4 h-4" />
          </button>
        </template>

        <button
          type="button"
          class="ls-circle-chip am-tap"
          :aria-label="t('common.close')"
          @click="echoSystem.haptic('light'); ui.nowPlayingOpen = false"
        >
          <Icon :icon="iconX" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- ==================== MODE 1: VINYL TURNTABLE STUDIO (黑胶唱片台) ==================== -->
    <div v-if="mode === 'vinyl'" class="ls-vinyl-grid" data-landscape-vinyl>
      <!-- Left Column: Interactive Vinyl Turntable + Ultra-Compact Lower Strip (<= 76px!) -->
      <div class="ls-vinyl-left">
        <div
          class="ls-turntable"
          @touchstart.passive="onVinylTouchStart"
          @touchmove.passive="onVinylTouchMove"
          @touchend.passive="onVinylTouchEnd"
          @click.stop
        >
          <!-- Animated Metallic Tonearm (drops onto groove on play, lifts on pause) -->
          <div class="ls-tonearm" :class="{ 'is-playing': player.isPlaying }" aria-hidden="true">
            <svg viewBox="0 0 80 120" class="w-full h-full overflow-visible">
              <circle cx="62" cy="14" r="10" fill="rgba(255,255,255,0.28)" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" />
              <circle cx="62" cy="14" r="4" fill="#ffffff" />
              <path
                d="M62 18 L52 72 L30 98"
                fill="none"
                stroke="rgba(245,248,255,0.92)"
                stroke-width="3.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <rect x="20" y="92" width="13" height="19" rx="3" transform="rotate(36 26 101)" fill="#ffffff" />
            </svg>
          </div>

          <!-- Platter & Grooved Vinyl Disc -->
          <div ref="vinylDiscRef" class="ls-disc-holder">
            <div class="ls-disc-ring">
              <div class="ls-disc-spin" :class="{ 'is-paused': !player.isPlaying }">
                <div class="ls-disc-grooves" />
                <div class="ls-disc-label">
                  <img
                    v-if="displayedCoverUrl"
                    :src="displayedCoverUrl"
                    decoding="async"
                    :alt="player.currentSong.title"
                    class="w-full h-full object-cover"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center bg-white/10 text-white/40">
                    <Icon :icon="iconMusic" class="w-8 h-8" />
                  </div>
                  <div class="ls-disc-spindle" />
                </div>
              </div>
              <!-- Static studio sheen above rotating grooves -->
              <div class="ls-disc-sheen" />
              <Transition name="heart-pop">
                <div v-if="heartBurst" class="ls-heart-burst">
                  <Icon :icon="iconHeartFilled" class="w-12 h-12 text-[#ff375f] drop-shadow-2xl" />
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Compact Metadata + Scrubber + Transport (Strictly height-safe on 340dp phones!) -->
        <div class="ls-compact-deck" @click.stop>
          <div class="flex items-center justify-between gap-2 min-w-0">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-[14.5px] font-bold text-white truncate leading-tight">
                  {{ player.currentSong.title }}
                </span>
                <button
                  v-if="player.sourceTag"
                  type="button"
                  class="px-1.5 py-0.5 rounded-[5px] bg-white/15 text-white/90 text-[9px] font-semibold border-0 shrink-0 am-tap"
                  @click="echoSystem.haptic('light'); ui.audioEffectSheetOpen = true"
                >
                  {{ player.sourceTag }}
                </button>
              </div>
              <button
                type="button"
                class="inline-flex items-center gap-0.5 max-w-full bg-transparent border-0 p-0 text-[11.5px] text-white/65 active:text-white text-left"
                @click="openCurrentArtist"
              >
                <span class="truncate">{{ player.currentSong.artist }}</span>
                <Icon :icon="iconChevronRight" class="w-3 h-3 opacity-60 shrink-0" />
              </button>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                type="button"
                class="ls-mini-btn am-tap"
                aria-label="Favorite"
                @click="player.toggleFavorite(player.currentSong)"
              >
                <Icon
                  :icon="player.isCurrentFavorite ? iconHeartFilled : iconHeart"
                  class="w-4 h-4"
                  :class="player.isCurrentFavorite ? 'text-[#ff375f]' : 'text-white/90'"
                />
              </button>
              <button
                type="button"
                class="ls-mini-btn am-tap"
                aria-label="More"
                @click="ui.openSongActions(player.currentSong)"
              >
                <Icon :icon="iconDots" class="w-4 h-4 text-white/90" />
              </button>
            </div>
          </div>

          <!-- Slim Inline Scrubber -->
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium tabular-nums text-white/58 shrink-0">{{ fmtTime(displayElapsedMs) }}</span>
            <div
              class="ls-scrub-hit flex-1"
              @pointerdown="onScrubDown"
              @pointermove="onScrubMove"
              @pointerup="finishScrub($event, true)"
              @pointercancel="finishScrub($event, false)"
            >
              <div class="ls-scrub-track" :class="{ 'is-scrubbing': scrubbing }">
                <div v-if="climaxBarStyle" class="ls-scrub-climax" :style="climaxBarStyle" />
                <div class="ls-scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
              </div>
            </div>
            <span class="text-[10px] font-medium tabular-nums text-white/58 shrink-0">-{{ fmtTime(displayRemainingMs) }}</span>
          </div>

          <!-- Slim Transport Row -->
          <div class="flex items-center justify-between pt-0.5">
            <button
              type="button"
              class="ls-mini-btn am-tap text-white/70"
              :aria-label="t('np.comments')"
              @click="ui.openSongComments(player.currentSong, 'comments')"
            >
              <Icon :icon="iconMessageCircle" class="w-4.5 h-4.5" />
            </button>
            <button type="button" class="ls-mini-btn am-tap text-white" aria-label="Previous" @click="player.previous()">
              <Icon :icon="iconPlayerTrackPrevFilled" class="w-6 h-6" />
            </button>
            <button
              type="button"
              class="ls-play-btn am-tap"
              :aria-label="player.isPlaying ? 'Pause' : 'Play'"
              @click="player.togglePlay()"
            >
              <Icon
                :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled"
                class="w-6 h-6"
              />
            </button>
            <button type="button" class="ls-mini-btn am-tap text-white" aria-label="Next" @click="player.next()">
              <Icon :icon="iconPlayerTrackNextFilled" class="w-6 h-6" />
            </button>
            <button
              type="button"
              class="ls-mini-btn relative am-tap"
              :class="hasActiveAudioDsp ? 'text-white' : 'text-white/70'"
              :aria-label="t('audio.sheetTitle')"
              @click="echoSystem.haptic('light'); ui.audioEffectSheetOpen = true"
            >
              <Icon :icon="iconAdjustments" class="w-4.5 h-4.5" />
              <span v-if="hasActiveAudioDsp" class="ls-dsp-dot" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right Column: Full-Height Zero-Flicker Lyrics OR Queue -->
      <div class="ls-vinyl-right">
        <Transition name="am-expand">
          <div
            v-if="rightPane === 'lyrics' && showOffsetBar"
            class="flex items-center justify-center gap-1.5 pt-8 pb-1 shrink-0"
            @click.stop
          >
            <button type="button" class="ls-pill-chip h-7 px-2 text-[11px] font-semibold tabular-nums am-tap" @click="nudgeOffset(-1000)">-1s</button>
            <button type="button" class="ls-pill-chip h-7 px-2 text-[11px] font-semibold tabular-nums am-tap" @click="nudgeOffset(-500)">-0.5s</button>
            <button type="button" class="ls-pill-chip h-7 px-2.5 text-[11px] font-bold tabular-nums am-tap" @click="resetOffset">{{ lyricOffsetLabel }}</button>
            <button type="button" class="ls-pill-chip h-7 px-2 text-[11px] font-semibold tabular-nums am-tap" @click="nudgeOffset(500)">+0.5s</button>
            <button type="button" class="ls-pill-chip h-7 px-2 text-[11px] font-semibold tabular-nums am-tap" @click="nudgeOffset(1000)">+1s</button>
          </div>
        </Transition>

        <div v-if="rightPane === 'lyrics'" class="flex-1 min-h-0">
          <KrcLyricsView
            :active="active && mode === 'vinyl' && rightPane === 'lyrics'"
            :compact="true"
            @user-scroll="revealHud(true)"
            @tap-blank="toggleHud"
          />
        </div>

        <div v-else class="flex-1 min-h-0 flex flex-col pt-9" @click.stop>
          <div class="flex items-center justify-between gap-2 pb-2 shrink-0">
            <div class="text-[13.5px] font-bold text-white">
              {{ t('np.upNext') }}
              <span class="text-[11px] font-normal text-white/55 ml-1">{{ player.queue.length }}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="ls-pill-chip px-2.5 py-1 text-[11px] font-medium flex items-center gap-1 am-tap"
                @click="player.cyclePlayMode()"
              >
                <Icon :icon="playModeIcon" class="w-3.5 h-3.5" />
                <span>{{ playModeLabel }}</span>
              </button>
              <button
                type="button"
                class="ls-circle-chip !w-7 !h-7 am-tap"
                :aria-label="t('np.clearQueue')"
                @click="player.clearQueue(); ui.nowPlayingOpen = false"
              >
                <Icon :icon="iconTrash" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div class="flex-1 am-scroll space-y-1 pr-1">
            <div
              v-for="row in visibleQueueItems"
              :key="`ls-q-${row.item.id}-${row.index}`"
              class="flex items-center gap-2.5 p-1.5 rounded-xl transition-colors"
              :class="row.index === player.currentIndex ? 'bg-white/18' : 'active:bg-white/10'"
              @click="player.playQueue(player.queue, row.index)"
            >
              <div class="w-8 h-8 rounded-[7px] overflow-hidden shrink-0 bg-white/10">
                <img v-if="row.item.coverUrl" :src="row.item.coverUrl" loading="lazy" decoding="async" class="w-full h-full object-cover" alt="" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] font-medium text-white truncate">{{ row.item.title }}</div>
                <div class="text-[11px] text-white/55 truncate">{{ row.item.artist }}</div>
              </div>
              <button
                type="button"
                class="w-7 h-7 rounded-full flex items-center justify-center text-white/50 bg-transparent border-0 am-tap shrink-0"
                @click.stop="player.removeFromQueue(row.index)"
              >
                <Icon :icon="iconX" class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== MODE 2: 3D COVER FLOW RECORD WALL ==================== -->
    <div v-else-if="mode === 'coverflow'" class="w-full h-full" @click.stop>
      <CoverFlowStage :active="active && mode === 'coverflow'" />
    </div>

    <!-- ==================== MODE 3: CINEMA LYRICS THEATER (巨幕影院) ==================== -->
    <div v-else class="ls-cinema-stage" data-landscape-cinema>
      <KrcLyricsView
        :active="active && mode === 'cinema'"
        :centered="true"
        @user-scroll="revealHud(true)"
        @tap-blank="toggleHud"
        @line-seek="scheduleHudAutoHide"
      />

      <!-- Auto-Hiding Floating Mini Dock at Bottom -->
      <div
        class="ls-cinema-dock"
        :class="{ 'is-hidden': !hudVisible }"
        @click.stop
      >
        <div class="w-9 h-9 rounded-[9px] overflow-hidden bg-white/12 shrink-0">
          <img v-if="displayedCoverUrl" :src="displayedCoverUrl" decoding="async" class="w-full h-full object-cover" alt="" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[13px] font-bold text-white truncate">{{ player.currentSong.title }}</div>
          <div class="text-[11px] text-white/62 truncate">{{ player.currentSong.artist }}</div>
        </div>
        <div class="w-[120px] sm:w-[170px] shrink-0">
          <div
            class="ls-scrub-hit"
            @pointerdown="onScrubDown"
            @pointermove="onScrubMove"
            @pointerup="finishScrub($event, true)"
            @pointercancel="finishScrub($event, false)"
          >
            <div class="ls-scrub-track" :class="{ 'is-scrubbing': scrubbing }">
              <div class="ls-scrub-fill" :style="{ width: `${progressRatio * 100}%` }" />
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" class="ls-mini-btn am-tap text-white" aria-label="Previous" @click="player.previous()">
            <Icon :icon="iconPlayerTrackPrevFilled" class="w-5 h-5" />
          </button>
          <button
            type="button"
            class="ls-play-btn !w-9 !h-9 am-tap"
            :aria-label="player.isPlaying ? 'Pause' : 'Play'"
            @click="player.togglePlay()"
          >
            <Icon :icon="player.isPlaying ? iconPlayerPauseFilled : iconPlayerPlayFilled" class="w-5 h-5" />
          </button>
          <button type="button" class="ls-mini-btn am-tap text-white" aria-label="Next" @click="player.next()">
            <Icon :icon="iconPlayerTrackNextFilled" class="w-5 h-5" />
          </button>
          <button
            type="button"
            class="ls-mini-btn am-tap text-white/80"
            :aria-label="t('song.unblock')"
            @click="ui.unblockModalSong = player.currentSong"
          >
            <Icon :icon="iconSparkles" class="w-4.5 h-4.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ls-root {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
}

/* Auto-Hiding Floating Glass Mode Bar (0px layout height footprint!) */
.ls-floating-hud {
  position: absolute;
  top: calc(var(--safe-top) + 8px);
  left: calc(var(--safe-left) + 18px);
  right: calc(var(--safe-right) + 18px);
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
  transition: opacity 260ms ease, transform 300ms var(--spring-ease);
}

.ls-floating-hud > * {
  pointer-events: auto;
}

.ls-floating-hud.is-hidden {
  opacity: 0;
  transform: translate3d(0, -10px, 0);
}

.ls-floating-hud.is-hidden > * {
  pointer-events: none;
}

.ls-mode-seg {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  background: rgba(16, 20, 32, 0.42);
  border: 0.5px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
}

.ls-mode-btn {
  height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.74);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: background-color 200ms ease, color 200ms ease;
}

.ls-mode-btn.is-active {
  background: rgba(255, 255, 255, 0.94);
  color: #111116;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
}

.ls-pill-chip,
.ls-circle-chip {
  border-radius: 999px;
  border: 0.5px solid rgba(255, 255, 255, 0.22);
  background: rgba(16, 20, 32, 0.40);
  color: rgba(255, 255, 255, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ls-circle-chip {
  width: 30px;
  height: 30px;
}

.ls-pill-chip.is-on,
.ls-circle-chip.is-on {
  background: rgba(255, 255, 255, 0.28);
  color: #ffffff;
}

.ls-circle-chip.is-solid {
  background: rgba(255, 255, 255, 0.94);
  color: #111116;
}

/* ==================== MODE 1: VINYL TURNTABLE STUDIO ==================== */
.ls-vinyl-grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(220px, 43%) 1fr;
  gap: 16px;
  padding: calc(var(--safe-top) + 12px) calc(var(--safe-right) + 18px) calc(var(--safe-bottom) + 10px) calc(var(--safe-left) + 18px);
  overflow: hidden;
}

.ls-vinyl-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding-top: 22px;
}

.ls-turntable {
  position: relative;
  width: min(52vh, 188px);
  height: min(52vh, 188px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.ls-tonearm {
  position: absolute;
  top: -12px;
  right: -18px;
  width: 46%;
  height: 66%;
  z-index: 6;
  pointer-events: none;
  transform-origin: 77% 12%;
  transform: rotate(-26deg);
  transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.42));
}

.ls-tonearm.is-playing {
  transform: rotate(0deg);
}

.ls-disc-holder {
  width: 100%;
  height: 100%;
  will-change: transform, opacity;
  backface-visibility: hidden;
}

.ls-disc-ring {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  padding: 5px;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.22), rgba(14, 16, 22, 0.85) 68%);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.ls-disc-spin {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: melune-vinyl-spin 22s linear infinite;
  will-change: transform;
}

.ls-disc-spin.is-paused {
  animation-play-state: paused;
}

@keyframes melune-vinyl-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ls-disc-grooves {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 50%;
  background:
    repeating-radial-gradient(
      circle at center,
      #14151a 0px,
      #14151a 2px,
      #20222a 2.5px,
      #101116 4px
    );
}

.ls-disc-label {
  position: relative;
  z-index: 2;
  width: 58%;
  height: 58%;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.45);
}

.ls-disc-spindle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  margin-top: -7px;
  border-radius: 50%;
  background: rgba(16, 18, 24, 0.88);
  border: 2px solid rgba(255, 255, 255, 0.45);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
}

.ls-disc-sheen {
  position: absolute;
  top: 5px;
  right: 5px;
  bottom: 5px;
  left: 5px;
  border-radius: 50%;
  pointer-events: none;
  background: linear-gradient(
    132deg,
    rgba(255, 255, 255, 0.20) 0%,
    transparent 34%,
    transparent 64%,
    rgba(255, 255, 255, 0.12) 100%
  );
}

.ls-heart-burst {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.ls-compact-deck {
  width: 100%;
  max-width: 310px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex-shrink: 0;
}

.ls-mini-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ls-play-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.94);
  color: #111116;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.30);
}

.ls-dsp-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #67b0ff;
}

.ls-scrub-hit {
  padding: 7px 0;
  cursor: pointer;
  touch-action: none;
}

.ls-scrub-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
  overflow: hidden;
  transition: height 160ms var(--spring-ease);
}

.ls-scrub-track.is-scrubbing {
  height: 8px;
}

.ls-scrub-climax {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(176, 214, 255, 0.45);
  pointer-events: none;
}

.ls-scrub-fill {
  position: relative;
  z-index: 1;
  height: 100%;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 999px;
}

.ls-vinyl-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* ==================== MODE 3: CINEMA LYRICS THEATER ==================== */
.ls-cinema-stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.ls-cinema-dock {
  position: absolute;
  left: 50%;
  bottom: calc(var(--safe-bottom) + 12px);
  z-index: 28;
  width: min(540px, calc(100% - var(--safe-left) - var(--safe-right) - 32px));
  transform: translate3d(-50%, 0, 0);
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(16, 20, 32, 0.56);
  border: 0.5px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
  display: flex;
  align-items: center;
  gap: 10px;
  transition: opacity 260ms ease, transform 320ms var(--spring-ease);
}

.ls-cinema-dock.is-hidden {
  opacity: 0;
  transform: translate3d(-50%, 16px, 0);
  pointer-events: none;
}
</style>
