<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { echoSystem } from '@/native/echoSystem';
import type { LyricLine, LyricWord } from '@/types/music';

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

const scrollerRef = ref<HTMLElement | null>(null);
const lineRefs = ref<HTMLElement[]>([]);
const liveTimeMs = ref(player.getInterpolatedTimeMs());
const userScrolling = ref(false);
let scrollResumeTimer: ReturnType<typeof setTimeout> | null = null;
let rafId = 0;
let touchStartY = 0;
let didScrollGesture = false;

function tick() {
  if (!props.active) {
    rafId = 0;
    return;
  }
  liveTimeMs.value = player.getInterpolatedTimeMs();
  if (player.isPlaying) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = 0;
  }
}

function syncLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  liveTimeMs.value = player.getInterpolatedTimeMs();
  if (props.active && player.isPlaying) {
    rafId = requestAnimationFrame(tick);
  }
}

const activeIndex = computed(() => {
  const lines = player.lyrics.lines;
  if (!lines.length) return -1;
  const t = liveTimeMs.value + 90;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
});

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

/**
 * Instant (<16ms) non-animated snap to the current line on mount, mode switch,
 * or fresh lyrics arrival — completely eliminates the 3-second waiting lag!
 */
function snapToActiveNow() {
  userScrolling.value = false;
  liveTimeMs.value = player.getInterpolatedTimeMs();
  void nextTick(() => {
    scrollToActive(false);
    requestAnimationFrame(() => scrollToActive(false));
  });
}

watch(
  () => [props.active, player.isPlaying, player.currentTimeMs],
  () => syncLoop(),
  { immediate: true },
);

watch(
  () => player.lyrics.lines,
  () => {
    lineRefs.value = [];
    if (props.active) snapToActiveNow();
  },
);

watch(activeIndex, () => {
  void nextTick(() => scrollToActive(true));
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
  syncLoop();
  if (props.active) {
    snapToActiveNow();
  }
});

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
  if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
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
  if (dy > 10) {
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
  liveTimeMs.value = line.startMs;
  void player.seek(line.startMs);
  emit('lineSeek');
  void nextTick(() => scrollToActive(true));
}

function getWordProgress(word: LyricWord, lineIdx: number): number {
  if (lineIdx < activeIndex.value) return 1;
  if (lineIdx > activeIndex.value) return 0;
  const t = liveTimeMs.value;
  if (t <= word.startMs) return 0;
  if (t >= word.startMs + word.durationMs) return 1;
  return (t - word.startMs) / Math.max(1, word.durationMs);
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
    <div v-if="player.lyricsLoading" class="krc-empty">
      <div class="krc-dots">
        <span /><span /><span />
      </div>
    </div>

    <div v-else-if="!player.lyrics.lines.length" class="krc-empty">
      <p class="text-[22px] font-bold text-white/75 tracking-tight">暂无同步歌词</p>
      <p class="text-[14px] text-white/45 mt-2">纯音乐或暂未匹配到歌词</p>
    </div>

    <div v-else class="krc-list">
      <button
        v-for="(line, idx) in player.lyrics.lines"
        :key="`${line.startMs}-${idx}`"
        :ref="(el) => { if (el) lineRefs[idx] = el as HTMLElement }"
        type="button"
        class="krc-line"
        :class="getLineClass(idx)"
        @click.stop="handleLineClick(line)"
      >
        <!-- Word-by-word Apple Music style karaoke rendering -->
        <div v-if="line.words && line.words.length" class="krc-main">
          <span
            v-for="(w, wi) in line.words"
            :key="wi"
            class="krc-word"
            :class="{
              'word-singing': idx === activeIndex && getWordProgress(w, idx) > 0 && getWordProgress(w, idx) < 1,
              'word-sung': idx === activeIndex && getWordProgress(w, idx) >= 1,
            }"
            :style="
              idx === activeIndex
                ? { '--wp': `${Math.round(getWordProgress(w, idx) * 100)}%` }
                : undefined
            "
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
  </div>
</template>

<style scoped>
.krc-scroller {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
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
  transition:
    transform 420ms var(--spring-ease),
    opacity 420ms ease,
    filter 420ms ease,
    color 320ms ease;
}

.krc-main {
  font-size: 27px;
  line-height: 1.28;
  font-weight: 700;
  letter-spacing: -0.02em;
  word-break: break-word;
}

.krc-trans {
  margin-top: 6px;
  font-size: 16px;
  line-height: 1.4;
  font-weight: 500;
  opacity: 0.78;
}

.krc-line.is-active {
  color: #ffffff;
  transform: scale(1.03);
  filter: blur(0px);
  opacity: 1;
}

.krc-line.is-near {
  opacity: 0.56;
  filter: blur(0.6px);
  transform: scale(0.985);
}

.krc-line.is-far {
  opacity: 0.34;
  filter: blur(1.4px);
  transform: scale(0.97);
}

.krc-line.is-scrolling {
  opacity: 0.65;
  filter: blur(0px);
  transform: scale(1);
}

/* Smooth Apple Music left-to-right syllable sweep */
.krc-line.is-active .krc-word {
  display: inline-block;
  white-space: pre-wrap;
  background: linear-gradient(
    90deg,
    #ffffff 0%,
    #ffffff var(--wp, 0%),
    rgba(255, 255, 255, 0.36) calc(var(--wp, 0%) + 6%),
    rgba(255, 255, 255, 0.36) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  transition: transform 220ms var(--spring-ease), text-shadow 220ms ease;
}

.krc-line.is-active .krc-word.word-singing {
  transform: translateY(-1.5px);
  filter: drop-shadow(0 0 12px rgba(255, 255, 255, 0.35));
}

.krc-line.is-active .krc-word.word-sung {
  color: #ffffff;
  background: none;
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
.krc-dots span:nth-child(2) { animation-delay: 0.2s; }
.krc-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes krc-pulse {
  0%, 100% { opacity: 0.28; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}
</style>
