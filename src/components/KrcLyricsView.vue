<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import {
  advanceMonotonicLyricTime,
  computeWordSweepPosPercent,
  findActiveLyricIndex,
} from '@/utils/lyricClock';
import type { LyricLine } from '@/types/music';

const props = defineProps<{
  active: boolean;
}>();

const emit = defineEmits<{
  userScroll: [];
  tapBlank: [];
  lineSeek: [];
}>();

const player = usePlayerStore();
const settings = useSettingsStore();
const { t } = useI18n();

const fontSizeClass = computed(() => `krc-size-${settings.lyricFontSize}`);
const currentTrackOffsetKey = computed(() => {
  const s = player.currentSong;
  return s ? (s.hash ? s.hash.toLowerCase() : s.id) : '';
});
const lyricOffsetMs = computed(() => settings.getLyricOffset(currentTrackOffsetKey.value));

function getRawShiftedTimeMs(): number {
  return Math.max(0, player.getInterpolatedTimeMs() + lyricOffsetMs.value);
}

const scrollerRef = ref<HTMLElement | null>(null);
const lineRefs = ref<HTMLElement[]>([]);
// Only flips on actual lyric line transitions (~every 3-5s) -> ZERO 60/120fps Vue VDOM diff!
const activeIndex = ref(-1);
const userScrolling = ref(false);

let displayTimeMs = -1;
let scrollResumeTimer: ReturnType<typeof setTimeout> | null = null;
let rafId = 0;
let touchStartY = 0;
let didScrollGesture = false;
let paintedLineIdx = -1;
let cachedWordNodes: HTMLElement[] = [];

function clearWordCache() {
  for (let i = 0; i < cachedWordNodes.length; i += 1) {
    const el = cachedWordNodes[i];
    if (el) {
      el.style.removeProperty('--wp-pos');
      delete el.dataset.wpq;
    }
  }
  cachedWordNodes = [];
  paintedLineIdx = -1;
}

function paintActiveLineWords(idx: number, nowMs: number) {
  if (idx < 0) {
    if (paintedLineIdx >= 0) clearWordCache();
    return;
  }
  const line = player.lyrics.lines[idx];
  if (!line?.words?.length) {
    if (paintedLineIdx >= 0) clearWordCache();
    return;
  }

  if (paintedLineIdx !== idx) {
    clearWordCache();
    const rowEl = lineRefs.value[idx];
    if (!rowEl) return;
    cachedWordNodes = Array.from(rowEl.querySelectorAll<HTMLElement>('.krc-word'));
    paintedLineIdx = idx;
  }

  const words = line.words;
  const count = Math.min(words.length, cachedWordNodes.length);
  for (let i = 0; i < count; i += 1) {
    const posPct = computeWordSweepPosPercent(words[i], nowMs);
    // 0.5% quantization avoids redundant style writes while staying ultra-smooth at 120fps
    const q = String(Math.round(posPct * 2));
    const el = cachedWordNodes[i];
    if (el.dataset.wpq !== q) {
      el.dataset.wpq = q;
      el.style.setProperty('--wp-pos', `${posPct.toFixed(1)}%`);
    }
  }
}

function syncFrame(forceSnap = false) {
  const rawMs = getRawShiftedTimeMs();
  displayTimeMs = forceSnap
    ? rawMs
    : advanceMonotonicLyricTime(displayTimeMs, rawMs, player.isPlaying);

  const nextIdx = findActiveLyricIndex(player.lyrics.lines, displayTimeMs, 90);
  if (nextIdx !== activeIndex.value) {
    activeIndex.value = nextIdx;
  }
  paintActiveLineWords(activeIndex.value, displayTimeMs);
}

function tick() {
  if (!props.active || !player.isPlaying) {
    rafId = 0;
    return;
  }
  syncFrame(false);
  rafId = requestAnimationFrame(tick);
}

function syncLoop(forceSnap = false) {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  syncFrame(forceSnap);
  if (props.active && player.isPlaying) {
    rafId = requestAnimationFrame(tick);
  }
}

function scrollToActive(smooth = true) {
  if (userScrolling.value) return;
  const idx = activeIndex.value;
  const container = scrollerRef.value;
  if (!container) return;
  if (idx < 0) {
    container.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    return;
  }
  const el = lineRefs.value[idx];
  if (!el) return;
  const targetTop = el.offsetTop - container.clientHeight * 0.30;
  container.scrollTo({
    top: Math.max(0, targetTop),
    behavior: smooth ? 'smooth' : 'auto',
  });
}

function snapToActiveNow() {
  userScrolling.value = false;
  displayTimeMs = -1;
  syncLoop(true);
  void nextTick(() => {
    paintActiveLineWords(activeIndex.value, Math.max(0, displayTimeMs));
    scrollToActive(false);
    requestAnimationFrame(() => scrollToActive(false));
  });
}

// Start/stop single RAF loop strictly on visibility or play/pause state (NEVER cancelled on 250ms ticks!)
watch(
  () => [props.active, player.isPlaying],
  ([isActive]) => {
    if (isActive) {
      syncLoop(!player.isPlaying);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  },
  { immediate: true },
);

// Handle external seeks (scrubber drag / chorus jump) or paused position updates cleanly
watch(
  () => player.currentTimeMs,
  () => {
    if (!props.active) return;
    if (!player.isPlaying) {
      syncFrame(true);
      return;
    }
    const rawMs = getRawShiftedTimeMs();
    if (displayTimeMs < 0 || Math.abs(rawMs - displayTimeMs) > 450) {
      syncFrame(true);
    }
  },
);

watch(lyricOffsetMs, () => {
  displayTimeMs = -1;
  syncFrame(true);
  if (props.active) {
    userScrolling.value = false;
    void nextTick(() => scrollToActive(true));
  }
});

watch(
  () => player.lyrics.lines,
  () => {
    clearWordCache();
    lineRefs.value = [];
    displayTimeMs = -1;
    if (props.active) snapToActiveNow();
  },
);

watch(activeIndex, (nextIdx) => {
  void nextTick(() => {
    paintActiveLineWords(nextIdx, Math.max(0, displayTimeMs));
    scrollToActive(true);
  });
});

watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      snapToActiveNow();
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.active) {
    snapToActiveNow();
  }
});

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  clearWordCache();
});

function markUserScrolling() {
  userScrolling.value = true;
  emit('userScroll');
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
  scrollResumeTimer = setTimeout(() => {
    userScrolling.value = false;
    scrollToActive(true);
  }, 3000);
}

function onTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY ?? 0;
  didScrollGesture = false;
}

function onTouchMove(e: TouchEvent) {
  const dy = Math.abs((e.touches[0]?.clientY ?? 0) - touchStartY);
  if (dy > 6) {
    didScrollGesture = true;
    markUserScrolling();
  }
}

function onContainerClick(e: MouseEvent) {
  if (didScrollGesture) {
    didScrollGesture = false;
    return;
  }
  const target = e.target as HTMLElement | null;
  if (target?.closest('.krc-line')) return;
  emit('tapBlank');
}

function handleLineClick(line: LyricLine) {
  if (didScrollGesture) {
    didScrollGesture = false;
    return;
  }
  echoSystem.haptic('selection');
  userScrolling.value = false;
  displayTimeMs = line.startMs;
  const targetAudioMs = Math.max(0, line.startMs - lyricOffsetMs.value);
  void player.seek(targetAudioMs);
  const nextIdx = findActiveLyricIndex(player.lyrics.lines, displayTimeMs, 90);
  if (nextIdx !== activeIndex.value) activeIndex.value = nextIdx;
  paintActiveLineWords(activeIndex.value, displayTimeMs);
  emit('lineSeek');
  void nextTick(() => scrollToActive(true));
}

function getLineClass(idx: number) {
  const diff = Math.abs(idx - activeIndex.value);
  if (idx === activeIndex.value) return 'is-active';
  if (userScrolling.value) return 'is-scrolling';
  if (diff === 1) return 'is-near';
  return 'is-far';
}
</script>

<template>
  <div
    ref="scrollerRef"
    class="krc-scroller"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @wheel.passive="markUserScrolling"
    @click="onContainerClick"
  >
    <Transition name="am-fade" mode="out-in">
      <div v-if="player.lyricsLoading" key="krc-loading" class="krc-empty">
        <div class="krc-dots">
          <span /><span /><span />
        </div>
      </div>

      <div v-else-if="!player.lyrics.lines.length" key="krc-none" class="krc-empty">
        <p class="text-[22px] font-bold text-white/75 tracking-tight">{{ t('lyrics.none') }}</p>
        <p class="text-[14px] text-white/45 mt-2">{{ t('lyrics.noneSub') }}</p>
      </div>

      <div v-else key="krc-list" class="krc-list" :class="fontSizeClass">
        <button
          v-for="(line, idx) in player.lyrics.lines"
          :key="`${line.startMs}-${idx}`"
          :ref="(el) => { if (el) lineRefs[idx] = el as HTMLElement }"
          type="button"
          class="krc-line"
          :class="getLineClass(idx)"
          @click.stop="handleLineClick(line)"
        >
          <!-- Word-by-word karaoke: constant GPU gradient mask driven imperatively -> ZERO flicker! -->
          <div v-if="line.words && line.words.length" class="krc-main">
            <span
              v-for="(w, wi) in line.words"
              :key="wi"
              class="krc-word"
            >{{ w.text }}</span>
          </div>

          <!-- Standard LRC line -->
          <div v-else class="krc-main">
            {{ line.text }}
          </div>

          <!-- Bilingual translation -->
          <div
            v-if="settings.showTranslation && line.translation"
            class="krc-trans"
          >
            {{ line.translation }}
          </div>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.krc-scroller {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  contain: layout style;
  -webkit-overflow-scrolling: touch;
  padding: 20vh 26px 40vh;
  scrollbar-width: none;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 9%,
    black 88%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 9%,
    black 88%,
    transparent 100%
  );
}
.krc-scroller::-webkit-scrollbar {
  display: none;
}

.krc-list {
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.krc-line {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 4px 0;
  color: rgba(255, 255, 255, 0.36);
  transform-origin: left center;
  backface-visibility: hidden;
  transition:
    transform 340ms var(--spring-ease),
    opacity 300ms ease,
    color 240ms ease;
}

.krc-main {
  font-size: 25px;
  line-height: 1.30;
  font-weight: 700;
  letter-spacing: -0.02em;
  word-break: break-word;
}

.krc-size-large .krc-main {
  font-size: 29px;
  line-height: 1.26;
}

.krc-size-xlarge .krc-main {
  font-size: 34px;
  line-height: 1.22;
}

.krc-trans {
  margin-top: 6px;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 500;
  opacity: 0.78;
}

.krc-size-large .krc-trans {
  font-size: 17px;
}

.krc-size-xlarge .krc-trans {
  font-size: 19px;
}

.krc-line.is-active {
  color: #ffffff;
  transform: scale(1.03);
  opacity: 1;
}

.krc-line.is-near {
  opacity: 0.50;
  transform: scale(0.985);
}

.krc-line.is-far {
  opacity: 0.28;
  transform: scale(0.97);
}

.krc-line.is-scrolling {
  opacity: 0.68;
  transform: scale(1);
}

/* Constant-layer Apple Music syllable sweep:
   100% -> dim unsung white; 0% -> solid pure #ffffff.
   NEVER switches background:none or toggles text-shadow -> ZERO Skia syllable flash! */
.krc-line.is-active .krc-word {
  display: inline-block;
  white-space: pre-wrap;
  background-image: linear-gradient(
    90deg,
    #ffffff 0%,
    #ffffff 48%,
    rgba(255, 255, 255, 0.36) 52%,
    rgba(255, 255, 255, 0.36) 100%
  );
  background-size: 220% 100%;
  background-repeat: no-repeat;
  background-position: var(--wp-pos, 100%) 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.krc-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.krc-dots {
  display: flex;
  gap: 8px;
}
.krc-dots span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  animation: krc-pulse 1.2s ease-in-out infinite;
}
.krc-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.krc-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes krc-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.82); }
  40% { opacity: 1; transform: scale(1.1); }
}
</style>
