<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconDownload from '@iconify/icons-tabler/download';
import iconShare from '@iconify/icons-tabler/share';
import iconCheck from '@iconify/icons-tabler/check';
import iconLanguage from '@iconify/icons-tabler/language';
import iconCalendar from '@iconify/icons-tabler/calendar';
import type { LyricLine } from '@/types/music';
import {
  renderLyricPosterToDataUrl,
  type PosterLyricItem,
  type PosterThemeId,
} from '@/services/share/lyricPosterRenderer';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { fetchLyricsForSong } from '@/services/playback/krcParser';
import { echoSystem } from '@/native/echoSystem';

const player = usePlayerStore();
const ui = useUiStore();
const { t, effectiveLocale } = useI18n();

const scrollRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const saving = ref(false);
const sharing = ref(false);
const lines = ref<LyricLine[]>([]);
const selectedIndices = ref<number[]>([]);
const theme = ref<PosterThemeId>('glass');
const includeTranslation = ref(true);
const showDateStamp = ref(true);
const previewDataUrl = ref('');

const song = computed(() => ui.lyricPosterSong);
const hasAnyTranslation = computed(() => lines.value.some((l) => Boolean(l.translation?.trim())));

const dragSheet = useDraggableSheet({
  detents: [0.76, 0.94],
  initialDetentIndex: 1,
  scrollElRef: scrollRef,
  onDismiss: () => {
    ui.lyricPosterSong = null;
  },
});

const themes = computed<Array<{ id: PosterThemeId; label: string }>>(() => [
  { id: 'glass', label: t('poster.themeGlass') },
  { id: 'vinyl', label: t('poster.themeVinyl') },
  { id: 'polaroid', label: t('poster.themePolaroid') },
  { id: 'cinema', label: t('poster.themeCinema') },
  { id: 'melune', label: t('poster.themeMelune') },
]);

const selectedItems = computed<PosterLyricItem[]>(() =>
  selectedIndices.value
    .slice()
    .sort((a, b) => a - b)
    .map((idx) => {
      const item = lines.value[idx];
      return {
        text: item?.text?.trim() || '',
        translation: item?.translation?.trim() || undefined,
      };
    })
    .filter((i) => Boolean(i.text)),
);

function pickDefaultLines(all: LyricLine[]) {
  if (!all.length) {
    selectedIndices.value = [];
    return;
  }
  const isCurrent =
    song.value && player.currentSong && song.value.hash === player.currentSong.hash;
  let anchor = 0;
  if (isCurrent && player.currentTimeMs > 0) {
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].startMs <= player.currentTimeMs + 200) anchor = i;
      else break;
    }
  }
  const picks: number[] = [];
  for (let i = anchor; i < all.length && picks.length < 3; i += 1) {
    if (all[i].text.trim()) picks.push(i);
  }
  if (!picks.length) picks.push(0);
  selectedIndices.value = picks;
}

let previewSeq = 0;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

function buildRenderConfig(scale: number) {
  const s = song.value!;
  return {
    title: s.title,
    artist: s.artist,
    album: s.album,
    coverUrl: s.coverUrl,
    lines: selectedItems.value,
    theme: theme.value,
    fluidColors: player.palette.fluidColors,
    showTranslation: includeTranslation.value && hasAnyTranslation.value,
    showDateStamp: showDateStamp.value,
    locale: effectiveLocale.value,
    brandName: t('app.fullName'),
    brandSlogan: t('app.slogan'),
    scale,
  };
}

function schedulePreviewRender() {
  if (previewTimer) clearTimeout(previewTimer);
  if (!song.value) return;
  previewTimer = setTimeout(async () => {
    if (!song.value) return;
    const seq = ++previewSeq;
    try {
      const url = await renderLyricPosterToDataUrl(buildRenderConfig(0.46));
      if (seq === previewSeq) {
        previewDataUrl.value = url;
      }
    } catch {
      // ignore preview error
    }
  }, 60);
}

watch(
  () => ui.lyricPosterSong,
  async (s) => {
    if (!s) return;
    dragSheet.reset();
    echoSystem.haptic('light');
    previewDataUrl.value = '';
    const isCurrent = Boolean(
      player.currentSong &&
        s.hash === player.currentSong.hash &&
        player.lyrics.lines.length > 0,
    );
    if (isCurrent) {
      lines.value = player.lyrics.lines.filter((l) => l.text.trim().length > 0);
      pickDefaultLines(lines.value);
      schedulePreviewRender();
      return;
    }
    loading.value = true;
    lines.value = [];
    selectedIndices.value = [];
    schedulePreviewRender();
    try {
      const parsed = await fetchLyricsForSong(s);
      lines.value = parsed.lines.filter((l) => l.text.trim().length > 0);
      pickDefaultLines(lines.value);
    } catch {
      lines.value = [];
    } finally {
      loading.value = false;
      schedulePreviewRender();
    }
  },
);

watch(
  () => [theme.value, selectedItems.value, includeTranslation.value, showDateStamp.value, effectiveLocale.value],
  () => {
    if (song.value) schedulePreviewRender();
  },
  { deep: true },
);

function toggleLine(idx: number) {
  echoSystem.haptic('selection');
  const pos = selectedIndices.value.indexOf(idx);
  if (pos >= 0) {
    if (selectedIndices.value.length <= 1) return;
    selectedIndices.value = selectedIndices.value.filter((i) => i !== idx);
  } else if (selectedIndices.value.length >= 4) {
    selectedIndices.value = [...selectedIndices.value.slice(1), idx];
  } else {
    selectedIndices.value = [...selectedIndices.value, idx];
  }
}

async function handleSavePoster() {
  if (saving.value || !song.value) return;
  saving.value = true;
  echoSystem.haptic('medium');
  try {
    const dataUrl = await renderLyricPosterToDataUrl(buildRenderConfig(1));
    const ok = await echoSystem.saveImageToGallery(dataUrl, `MELUNE_${Date.now()}.png`);
    ui.showToast(ok ? t('poster.savedToast') : t('poster.saveFailed'));
  } catch {
    ui.showToast(t('poster.saveFailed'));
  } finally {
    saving.value = false;
  }
}

async function handleSharePoster() {
  if (sharing.value || !song.value) return;
  sharing.value = true;
  echoSystem.haptic('light');
  try {
    const dataUrl = await renderLyricPosterToDataUrl(buildRenderConfig(1));
    const res = await echoSystem.shareImage(dataUrl, `${song.value.title} · MELUNE`);
    if (!res.launched && res.message) {
      ui.showToast(res.message);
    }
  } catch {
    ui.showToast(t('poster.saveFailed'));
  } finally {
    sharing.value = false;
  }
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="song"
      class="fixed inset-0 z-[95] flex flex-col justify-end lg-scrim"
      @click="ui.lyricPosterSong = null"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- Draggable Header -->
          <div
            class="shrink-0 touch-none select-none"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="pt-2.5 pb-1 flex justify-center">
              <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55" />
            </div>
            <div class="flex items-center justify-between px-5 pt-1 pb-3 am-hairline-b">
              <div class="min-w-0 pr-2">
                <h2 class="text-[18px] font-bold tracking-tight text-[var(--text-primary)] truncate">{{ t('poster.title') }}</h2>
                <p class="text-[11px] text-[var(--text-secondary)] truncate">{{ t('poster.sub') }}</p>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap shrink-0"
                @click="ui.lyricPosterSong = null"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Content -->
          <div
            ref="scrollRef"
            class="flex-1 am-scroll px-5 pt-3.5 pb-4 space-y-3.5"
            @touchstart.passive="dragSheet.onBodyTouchStart"
            @touchmove="dragSheet.onBodyTouchMove"
            @touchend.passive="dragSheet.onBodyTouchEnd"
            @touchcancel.passive="dragSheet.onBodyTouchEnd"
          >
            <!-- 5 Curated Editorial Templates (zero-overflow equal 5-column segmented selector!) -->
            <div class="pt-seg-group grid-cols-5">
              <button
                v-for="item in themes"
                :key="item.id"
                type="button"
                class="pt-seg-btn"
                :class="
                  theme === item.id
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                    : 'bg-transparent text-[var(--text-secondary)]'
                "
                @click="echoSystem.haptic('selection'); theme = item.id"
              >
                {{ item.label }}
              </button>
            </div>

            <!-- 100% WYSIWYG Canvas Live Preview -->
            <div class="mx-auto w-full max-w-[266px] aspect-[1080/1520] rounded-[22px] overflow-hidden shadow-2xl bg-[#0b1336] flex items-center justify-center">
              <img
                v-if="previewDataUrl"
                :src="previewDataUrl"
                alt="Lyric Poster Preview"
                class="w-full h-full object-cover block"
              />
              <div v-else class="text-[12px] text-white/60">{{ t('common.loading') }}</div>
            </div>

            <!-- Studio Quick Toggles: Bilingual Translation & Date Stamp -->
            <div class="flex items-center justify-center gap-2">
              <button
                v-if="hasAnyTranslation"
                type="button"
                class="px-3 h-8 rounded-full text-[12px] font-semibold border-0 inline-flex items-center gap-1.5 transition-colors am-tap"
                :class="
                  includeTranslation
                    ? 'bg-[var(--accent)]/16 am-accent-text'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                "
                @click="echoSystem.haptic('selection'); includeTranslation = !includeTranslation"
              >
                <Icon :icon="iconLanguage" class="w-3.5 h-3.5" />
                <span>{{ t('poster.optTranslation') }}</span>
              </button>

              <button
                type="button"
                class="px-3 h-8 rounded-full text-[12px] font-semibold border-0 inline-flex items-center gap-1.5 transition-colors am-tap"
                :class="
                  showDateStamp
                    ? 'bg-[var(--accent)]/16 am-accent-text'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                "
                @click="echoSystem.haptic('selection'); showDateStamp = !showDateStamp"
              >
                <Icon :icon="iconCalendar" class="w-3.5 h-3.5" />
                <span>{{ t('poster.optDate') }}</span>
              </button>
            </div>

            <!-- Lyric Line Picker -->
            <div class="space-y-2">
              <div class="flex items-center justify-between text-[12px] text-[var(--text-secondary)] px-0.5">
                <span>{{ t('poster.pickedCount', { count: selectedIndices.length }) }}</span>
              </div>

              <div v-if="loading" class="py-6 text-center text-[13px] text-[var(--text-secondary)]">
                {{ t('poster.loading') }}
              </div>
              <div v-else-if="!lines.length" class="py-4 text-center text-[12px] text-[var(--text-secondary)]">
                {{ t('poster.noLyrics') }}
              </div>
              <div v-else class="space-y-1.5 max-h-[175px] am-scroll pr-1">
                <button
                  v-for="(line, idx) in lines"
                  :key="`${line.startMs}-${idx}`"
                  type="button"
                  class="w-full px-3 py-2 rounded-xl text-left text-[13px] border-0 flex items-center justify-between gap-2 transition-colors"
                  :class="
                    selectedIndices.includes(idx)
                      ? 'bg-[var(--accent)]/14 text-[var(--text-primary)] font-semibold'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                  "
                  @click="toggleLine(idx)"
                >
                  <span class="truncate">{{ line.text }}</span>
                  <Icon
                    v-if="selectedIndices.includes(idx)"
                    :icon="iconCheck"
                    class="w-4 h-4 am-accent-text shrink-0"
                  />
                </button>
              </div>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="shrink-0 px-5 pt-2.5 pb-[calc(var(--safe-bottom)+16px)] am-hairline-t grid grid-cols-2 gap-2.5">
            <button
              type="button"
              class="h-11 rounded-[14px] am-accent-bg text-white text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
              :disabled="saving"
              @click="handleSavePoster"
            >
              <Icon :icon="iconDownload" class="w-4.5 h-4.5 shrink-0" />
              <span class="truncate">{{ saving ? t('poster.saving') : t('poster.save') }}</span>
            </button>
            <button
              type="button"
              class="h-11 rounded-[14px] bg-[var(--bg-card)] text-[var(--text-primary)] text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap shadow-xs"
              :disabled="sharing"
              @click="handleSharePoster"
            >
              <Icon :icon="iconShare" class="w-4.5 h-4.5 am-accent-text shrink-0" />
              <span class="truncate">{{ sharing ? t('poster.sharing') : t('poster.share') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
