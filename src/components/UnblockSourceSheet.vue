<script setup lang="ts">
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconRefresh from '@iconify/icons-tabler/refresh';
import iconPin from '@iconify/icons-tabler/pin';
import iconPlayerPlay from '@iconify/icons-tabler/player-play';
import iconX from '@iconify/icons-tabler/x';
import type { PinnedSource, UnblockCandidate } from '@/types/music';
import { useUiStore } from '@/stores/ui';
import { usePlayerStore } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';
import {
  getPinnedSource,
  scanAllUnblockCandidates,
  unpinSourceForSong,
} from '@/services/playback/unblockEngine';

const ui = useUiStore();
const player = usePlayerStore();
const settings = useSettingsStore();

const dragSheet = useDraggableSheet({
  onDismiss: () => {
    ui.unblockModalSong = null;
  },
});

const scanning = ref(false);
const applyingId = ref('');
const candidates = ref<UnblockCandidate[]>([]);
const pinned = ref<PinnedSource | null>(null);

async function runScan() {
  const song = ui.unblockModalSong;
  if (!song) return;
  scanning.value = true;
  candidates.value = [];
  pinned.value = await getPinnedSource(song);
  try {
    candidates.value = await scanAllUnblockCandidates(song, settings.quality);
  } finally {
    scanning.value = false;
  }
}

watch(
  () => ui.unblockModalSong,
  (s) => {
    if (s) void runScan();
  },
);

async function pick(cand: UnblockCandidate, pin: boolean) {
  const song = ui.unblockModalSong;
  if (!song || applyingId.value) return;
  echoSystem.haptic('light');
  applyingId.value = cand.id;
  try {
    const ok = await player.applyUnblockCandidate(song, cand, pin);
    if (ok) ui.unblockModalSong = null;
  } finally {
    applyingId.value = '';
  }
}

async function clearPin() {
  const song = ui.unblockModalSong;
  if (!song) return;
  echoSystem.haptic('selection');
  await unpinSourceForSong(song);
  pinned.value = null;
  ui.showToast('已解除锁定音源');
}

function platformBadge(cand: UnblockCandidate): string {
  if (cand.channel === 'kugou-alt') return '酷狗异版';
  if (cand.sourcePlatform === 'kuwo') return '酷我 320k';
  if (cand.sourcePlatform === 'joox') return 'JOOX';
  if (cand.sourcePlatform === 'bilibili') return 'B站音频';
  return (cand.sourcePlatform || 'EXT').toUpperCase();
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="ui.unblockModalSong"
      class="fixed inset-0 z-[85] flex flex-col justify-end lg-scrim"
      @click="ui.unblockModalSong = null"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] max-h-[82vh] flex flex-col pb-[calc(var(--safe-bottom)+14px)]"
          :style="dragSheet.sheetStyle.value"
        >
        <div
          class="touch-none pt-3 pb-2"
          @touchstart="dragSheet.onHandleTouchStart"
          @touchmove="dragSheet.onHandleTouchMove"
          @touchend="dragSheet.onHandleTouchEnd"
          @touchcancel="dragSheet.onHandleTouchEnd"
        >
          <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />
        </div>

        <div class="flex items-center justify-between px-5 pb-3 am-hairline-b">
          <div class="min-w-0 pr-3">
            <div class="flex items-center gap-1.5 text-[18px] font-bold text-[var(--text-primary)]">
              <Icon :icon="iconSparkles" class="w-5 h-5 am-accent-text" />
              <span>切换可用音源</span>
            </div>
            <p class="text-[13px] text-[var(--text-secondary)] truncate mt-0.5">
              {{ ui.unblockModalSong.title }} · {{ ui.unblockModalSong.artist }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
              :disabled="scanning"
              @click="runScan"
            >
              <Icon :icon="iconRefresh" class="w-4 h-4" :class="{ 'animate-spin': scanning }" />
            </button>
            <button
              type="button"
              class="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
              @click="ui.unblockModalSong = null"
            >
              <Icon :icon="iconX" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="flex-1 am-scroll px-5 py-3 space-y-2.5">
          <div
            v-if="pinned"
            class="rounded-2xl bg-[var(--bg-card)] px-4 py-3 flex items-center justify-between gap-2"
          >
            <div class="min-w-0">
              <div class="text-[12px] font-semibold am-accent-text">当前已锁定音源</div>
              <div class="text-[14px] text-[var(--text-primary)] truncate mt-0.5">
                {{ pinned.title }} · {{ pinned.channel === 'kugou-alt' ? '酷狗异版' : pinned.sourcePlatform?.toUpperCase() }}
              </div>
            </div>
            <button
              type="button"
              class="px-3 py-1.5 rounded-full bg-[var(--bg-subtle)] text-[12px] font-medium text-[var(--text-primary)] border-0 am-tap shrink-0"
              @click="clearPin"
            >
              解除锁定
            </button>
          </div>

          <div v-if="scanning" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
            正在并行检索酷我 320k、酷狗异版、JOOX 与 B站音频…
          </div>

          <div v-else-if="!candidates.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
            暂未找到高度匹配的候选音源，可点击右上角重试
          </div>

          <div
            v-for="cand in candidates"
            :key="cand.id"
            class="rounded-2xl bg-[var(--bg-card)] px-4 py-3 flex items-center justify-between gap-3"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-subtle)] am-accent-text shrink-0">
                  {{ platformBadge(cand) }}
                </span>
                <span class="text-[15px] font-semibold truncate text-[var(--text-primary)]">{{ cand.title }}</span>
              </div>
              <div class="text-[12px] text-[var(--text-secondary)] truncate mt-1">
                {{ cand.artist }}<template v-if="cand.album"> · {{ cand.album }}</template> · 匹配 {{ Math.round(cand.score * 100) }}%
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                class="h-9 px-3 rounded-full bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[12px] font-semibold border-0 flex items-center gap-1 am-tap"
                :disabled="Boolean(applyingId)"
                @click="pick(cand, false)"
              >
                <Icon :icon="iconPlayerPlay" class="w-3.5 h-3.5" />
                <span>试听</span>
              </button>
              <button
                type="button"
                class="h-9 px-3 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 flex items-center gap-1 am-tap"
                :disabled="Boolean(applyingId)"
                @click="pick(cand, true)"
              >
                <Icon :icon="iconPin" class="w-3.5 h-3.5" />
                <span>锁定</span>
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
