<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconDownload from '@iconify/icons-tabler/download';
import iconShare from '@iconify/icons-tabler/share';
import iconCheck from '@iconify/icons-tabler/check';
import iconMusic from '@iconify/icons-tabler/music';
import type { LyricLine } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { fetchLyricsForSong } from '@/services/playback/krcParser';
import { echoSystem } from '@/native/echoSystem';

type PosterTheme = 'fluid' | 'paper' | 'vinyl';

const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const scrollRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const saving = ref(false);
const sharing = ref(false);
const lines = ref<LyricLine[]>([]);
const selectedIndices = ref<number[]>([]);
const theme = ref<PosterTheme>('fluid');

const song = computed(() => ui.lyricPosterSong);

const dragSheet = useDraggableSheet({
  scrollElRef: scrollRef,
  onDismiss: () => {
    ui.lyricPosterSong = null;
  },
});

const themes = computed<Array<{ id: PosterTheme; label: string }>>(() => [
  { id: 'fluid', label: t('poster.themeFluid') },
  { id: 'paper', label: t('poster.themePaper') },
  { id: 'vinyl', label: t('poster.themeVinyl') },
]);

const selectedLines = computed(() =>
  selectedIndices.value
    .slice()
    .sort((a, b) => a - b)
    .map((idx) => lines.value[idx]?.text?.trim() || '')
    .filter(Boolean),
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

watch(
  () => ui.lyricPosterSong,
  async (s) => {
    if (!s) return;
    dragSheet.reset();
    echoSystem.haptic('light');
    const isCurrent = Boolean(
      player.currentSong &&
        s.hash === player.currentSong.hash &&
        player.lyrics.lines.length > 0,
    );
    if (isCurrent) {
      lines.value = player.lyrics.lines.filter((l) => l.text.trim().length > 0);
      pickDefaultLines(lines.value);
      return;
    }
    loading.value = true;
    lines.value = [];
    selectedIndices.value = [];
    try {
      const parsed = await fetchLyricsForSong(s);
      lines.value = parsed.lines.filter((l) => l.text.trim().length > 0);
      pickDefaultLines(lines.value);
    } catch {
      lines.value = [];
    } finally {
      loading.value = false;
    }
  },
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

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 3500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url.replace('/240/', '/480/');
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      result.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) result.push(line);
  return result;
}

async function renderPosterDataUrl(): Promise<string> {
  const s = song.value;
  if (!s) throw new Error('No song');

  const W = 1080;
  const H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  const isLight = theme.value === 'paper';
  const fluid = player.palette.fluidColors;

  // 1. Background fill
  if (theme.value === 'fluid') {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, fluid[0] || '#5a1428');
    grad.addColorStop(0.5, fluid[1] || '#2a1038');
    grad.addColorStop(1, fluid[2] || '#12182e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const orb = ctx.createRadialGradient(W * 0.8, H * 0.16, 40, W * 0.8, H * 0.16, 620);
    orb.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    orb.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, W, H);
  } else if (theme.value === 'paper') {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#fcfcfd');
    grad.addColorStop(1, '#f1f3f8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#16161b');
    grad.addColorStop(1, '#070709');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, 360, 40, W * 0.5, 360, 520);
    glow.addColorStop(0, 'rgba(250, 35, 59, 0.24)');
    glow.addColorStop(1, 'rgba(250, 35, 59, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  // 2. Centered Album Artwork Card
  const artSize = 460;
  const artX = (W - artSize) / 2;
  const artY = 128;

  ctx.save();
  ctx.shadowColor = isLight ? 'rgba(15, 23, 42, 0.18)' : 'rgba(0, 0, 0, 0.52)';
  ctx.shadowBlur = 64;
  ctx.shadowOffsetY = 24;
  drawRoundedRect(ctx, artX, artY, artSize, artSize, 42);
  ctx.fillStyle = isLight ? '#e8eaf0' : '#222228';
  ctx.fill();
  ctx.restore();

  const coverImg = await loadCorsImage(s.coverUrl);
  ctx.save();
  drawRoundedRect(ctx, artX, artY, artSize, artSize, 42);
  ctx.clip();
  if (coverImg) {
    ctx.drawImage(coverImg, artX, artY, artSize, artSize);
  } else {
    const fallGrad = ctx.createLinearGradient(artX, artY, artX, artY + artSize);
    fallGrad.addColorStop(0, '#ff526e');
    fallGrad.addColorStop(1, '#dc122e');
    ctx.fillStyle = fallGrad;
    ctx.fillRect(artX, artY, artSize, artSize);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 180px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♪', W / 2, artY + artSize / 2 + 12);
  }
  ctx.restore();

  // 3. Selected Lyrics Block
  const quoteLines = selectedLines.value.length ? selectedLines.value : [s.title];
  ctx.fillStyle = isLight ? '#111116' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '700 50px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif';

  const padX = 104;
  const maxTextW = W - padX * 2;
  let cursorY = 678;

  // Decorative quotation mark
  ctx.save();
  ctx.fillStyle = isLight ? 'rgba(250, 35, 59, 0.35)' : 'rgba(255, 255, 255, 0.25)';
  ctx.font = '700 96px Georgia, serif';
  ctx.fillText('“', padX - 8, cursorY - 56);
  ctx.restore();

  ctx.fillStyle = isLight ? '#111116' : 'rgba(255, 255, 255, 0.96)';
  ctx.font = '700 46px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif';

  for (const rawLine of quoteLines) {
    const wrapped = wrapTextLines(ctx, rawLine, maxTextW);
    for (const wLine of wrapped) {
      if (cursorY > 1160) break;
      ctx.fillText(wLine, padX, cursorY);
      cursorY += 68;
    }
    cursorY += 16;
  }

  // 4. Footer Divider, Track Meta & PureTone Watermark
  const footerY = 1236;
  ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.10)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, footerY);
  ctx.lineTo(W - padX, footerY);
  ctx.stroke();

  ctx.fillStyle = isLight ? '#111116' : '#ffffff';
  ctx.font = '700 36px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText(s.title.slice(0, 22), padX, footerY + 34);

  ctx.fillStyle = isLight ? '#63636a' : 'rgba(255, 255, 255, 0.68)';
  ctx.font = '500 28px -apple-system, "PingFang SC", "Noto Sans SC", sans-serif';
  ctx.fillText(s.artist.slice(0, 26), padX, footerY + 86);

  // Right watermark badge
  const badgeX = W - padX - 66;
  const badgeY = footerY + 42;
  ctx.save();
  drawRoundedRect(ctx, badgeX, badgeY, 66, 66, 16);
  const bg = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + 66);
  bg.addColorStop(0, '#ff526e');
  bg.addColorStop(1, '#dc122e');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 38px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('♪', badgeX + 33, badgeY + 35);
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.fillStyle = isLight ? '#63636a' : 'rgba(255, 255, 255, 0.72)';
  ctx.font = '600 24px -apple-system, "PingFang SC", sans-serif';
  ctx.fillText('纯音 · PureTone', badgeX - 18, badgeY + 18);

  return canvas.toDataURL('image/png');
}

async function handleSavePoster() {
  if (saving.value || !song.value) return;
  saving.value = true;
  echoSystem.haptic('medium');
  try {
    const dataUrl = await renderPosterDataUrl();
    const ok = await echoSystem.saveImageToGallery(dataUrl, `PureTone_${Date.now()}.png`);
    ui.showToast(ok ? '歌词海报已保存至系统相册 Pictures/PureTone' : '保存海报失败，请检查权限');
  } catch {
    ui.showToast('生成海报失败，请重试');
  } finally {
    saving.value = false;
  }
}

async function handleSharePoster() {
  if (sharing.value || !song.value) return;
  sharing.value = true;
  echoSystem.haptic('light');
  try {
    const dataUrl = await renderPosterDataUrl();
    const res = await echoSystem.shareImage(dataUrl, `${song.value.title} - 歌词海报`);
    if (!res.launched && res.message) {
      ui.showToast(res.message);
    }
  } catch {
    ui.showToast('调起系统分享失败');
  } finally {
    sharing.value = false;
  }
}

const previewCardStyle = computed(() => {
  if (theme.value === 'paper') {
    return {
      background: 'linear-gradient(180deg, #fcfcfd 0%, #f1f3f8 100%)',
      color: '#111116',
    };
  }
  if (theme.value === 'vinyl') {
    return {
      background: 'radial-gradient(circle at 50% 25%, rgba(250,35,59,0.22), transparent 58%), linear-gradient(145deg, #16161b 0%, #070709 100%)',
      color: '#ffffff',
    };
  }
  const f = player.palette.fluidColors;
  return {
    background: `linear-gradient(145deg, ${f[0] || '#5a1428'} 0%, ${f[1] || '#2a1038'} 55%, ${f[2] || '#12182e'} 100%)`,
    color: '#ffffff',
  };
});
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
          class="lg-sheet-panel rounded-t-[28px] max-h-[90vh] flex flex-col overflow-hidden"
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
              <div>
                <h2 class="text-[18px] font-bold tracking-tight text-[var(--text-primary)]">{{ t('poster.title') }}</h2>
                <p class="text-[11px] text-[var(--text-secondary)]">{{ t('poster.sub') }}</p>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-primary)] am-tap"
                @click="ui.lyricPosterSong = null"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Content -->
          <div
            ref="scrollRef"
            class="flex-1 am-scroll px-5 pt-4 pb-4 space-y-4"
            @touchstart.passive="dragSheet.onBodyTouchStart"
            @touchmove="dragSheet.onBodyTouchMove"
            @touchend.passive="dragSheet.onBodyTouchEnd"
            @touchcancel.passive="dragSheet.onBodyTouchEnd"
          >
            <!-- Theme Selector -->
            <div class="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[var(--bg-subtle)]">
              <button
                v-for="t in themes"
                :key="t.id"
                type="button"
                class="h-8 rounded-xl text-[12px] font-semibold border-0 transition-all"
                :class="
                  theme === t.id
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                    : 'bg-transparent text-[var(--text-secondary)]'
                "
                @click="echoSystem.haptic('selection'); theme = t.id"
              >
                {{ t.label }}
              </button>
            </div>

            <!-- Live Poster Preview -->
            <div
              class="mx-auto w-full max-w-[260px] rounded-[22px] p-5 shadow-xl flex flex-col justify-between min-h-[330px]"
              :style="previewCardStyle"
            >
              <div class="w-28 h-28 mx-auto rounded-[14px] overflow-hidden shadow-lg bg-white/10">
                <img v-if="song.coverUrl" :src="song.coverUrl" class="w-full h-full object-cover" alt="" />
                <div v-else class="w-full h-full flex items-center justify-center opacity-50">
                  <Icon :icon="iconMusic" class="w-10 h-10" />
                </div>
              </div>

              <div class="my-4 space-y-1.5 text-left">
                <p
                  v-for="(txt, idx) in selectedLines.length ? selectedLines : [song.title]"
                  :key="idx"
                  class="text-[14px] font-bold leading-snug m-0"
                >
                  {{ txt }}
                </p>
              </div>

              <div
                class="pt-3 flex items-center justify-between gap-2 text-[11px]"
                :style="{ borderTop: theme === 'paper' ? '0.5px solid rgba(15,23,42,0.12)' : '0.5px solid rgba(255,255,255,0.18)' }"
              >
                <div class="min-w-0">
                  <div class="font-bold truncate">{{ song.title }}</div>
                  <div class="opacity-65 truncate">{{ song.artist }}</div>
                </div>
                <span class="text-[10px] font-semibold opacity-70 shrink-0">纯音 · PureTone</span>
              </div>
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
              <div v-else class="space-y-1.5 max-h-[180px] am-scroll pr-1">
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
              <Icon :icon="iconDownload" class="w-4.5 h-4.5" />
              <span>{{ saving ? t('poster.saving') : t('poster.save') }}</span>
            </button>
            <button
              type="button"
              class="h-11 rounded-[14px] bg-[var(--bg-card)] text-[var(--text-primary)] text-[14px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap shadow-xs"
              :disabled="sharing"
              @click="handleSharePoster"
            >
              <Icon :icon="iconShare" class="w-4.5 h-4.5 am-accent-text" />
              <span>{{ sharing ? t('poster.sharing') : t('poster.share') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
