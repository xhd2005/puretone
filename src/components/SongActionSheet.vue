<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconPlayerTrackNext from '@iconify/icons-tabler/player-track-next';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconCopy from '@iconify/icons-tabler/copy';
import iconPlayerPlay from '@iconify/icons-tabler/player-play';
import iconMoon from '@iconify/icons-tabler/moon';
import iconPhoto from '@iconify/icons-tabler/photo';
import iconGauge from '@iconify/icons-tabler/gauge';
import iconX from '@iconify/icons-tabler/x';
import iconMusic from '@iconify/icons-tabler/music';
import iconUser from '@iconify/icons-tabler/user';
import iconDisc from '@iconify/icons-tabler/disc';
import iconMessageCircle from '@iconify/icons-tabler/message-circle';
import type { SleepTimerMode } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { openAlbumFromSong, openArtistProfileFromSong } from '@/services/playback/artistNavigation';
import { echoSystem } from '@/native/echoSystem';

const router = useRouter();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const song = computed(() => ui.actionSheetSong);
const isFav = computed(() => Boolean(song.value?.hash && player.favoriteHashes.has(song.value.hash.toLowerCase())));

const dragSheet = useDraggableSheet({
  onDismiss: () => {
    ui.actionSheetSong = null;
  },
});

watch(song, (next) => {
  if (next) dragSheet.reset();
});

const speedOptions = [0.75, 1, 1.25, 1.5];

const sleepOptions = computed<Array<{ id: SleepTimerMode; label: string }>>(() => [
  { id: 'off', label: t('song.sleepOff') },
  { id: '15', label: t('song.sleep15') },
  { id: '30', label: t('song.sleep30') },
  { id: '60', label: t('song.sleep60') },
  { id: 'track', label: t('song.sleepTrack') },
]);

function close() {
  ui.actionSheetSong = null;
}

function playNow() {
  if (!song.value) return;
  const s = song.value;
  close();
  void player.playSong(s);
}

function playNext() {
  if (!song.value) return;
  player.addToQueueNext(song.value);
  close();
}

function toggleFav() {
  if (!song.value) return;
  const s = song.value;
  close();
  void player.toggleFavorite(s);
}

function openPoster() {
  if (!song.value) return;
  const s = song.value;
  close();
  ui.lyricPosterSong = s;
}

function openUnblock() {
  if (!song.value) return;
  const s = song.value;
  close();
  ui.unblockModalSong = s;
}

function openComments() {
  if (!song.value) return;
  const s = song.value;
  close();
  ui.openSongComments(s, 'comments');
}

async function openArtist() {
  if (!song.value) return;
  const s = song.value;
  close();
  await openArtistProfileFromSong(s, router, ui, {
    resolving: t('artist.resolving'),
    notFound: t('artist.notFound'),
  });
}

async function openAlbum() {
  if (!song.value) return;
  const s = song.value;
  close();
  await openAlbumFromSong(s, router, ui, t('album.empty'));
}

async function copyTitle() {
  if (!song.value) return;
  echoSystem.haptic('light');
  await echoSystem.copyToClipboard(`${song.value.title} - ${song.value.artist}`);
  close();
  ui.showToast(t('song.copiedMeta'));
}
</script>

<template>
  <Transition name="lg-modal">
    <div v-if="song" class="fixed inset-0 z-[80] flex flex-col justify-end lg-scrim" @click="close">
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] px-4 pt-2 pb-[calc(var(--safe-bottom)+18px)] space-y-3 max-h-[88vh] flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- Drag Handle -->
          <div
            class="pt-1 pb-1.5 touch-none shrink-0"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />
          </div>

          <div class="flex-1 am-scroll space-y-3 pb-1">
            <!-- Refined Track Hero Header -->
            <div class="flex items-center gap-3 px-1 pb-2.5 am-hairline-b">
              <div class="w-14 h-14 rounded-[13px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-md flex items-center justify-center">
                <img v-if="song.coverUrl" :src="song.coverUrl" class="w-full h-full object-cover" alt="" />
                <Icon v-else :icon="iconMusic" class="w-6 h-6 text-[var(--text-tertiary)]" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-[16px] font-bold truncate text-[var(--text-primary)]">{{ song.title }}</span>
                  <span
                    v-if="song.hashFlac"
                    class="px-1.5 py-0.5 rounded-[5px] bg-[var(--bg-subtle)] text-[9px] font-bold text-[var(--text-secondary)] shrink-0"
                  >
                    {{ t('song.lossless') }}
                  </span>
                </div>
                <div class="text-[13px] truncate text-[var(--text-secondary)] mt-0.5">
                  {{ song.artist }}<template v-if="song.album"> · {{ song.album }}</template>
                </div>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                :aria-label="t('common.close')"
                @click="close"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>

            <!-- 4-Tile Quick Action Grid (zero-overflow single-line labels!) -->
            <div class="grid grid-cols-4 gap-2">
              <button type="button" class="quick-tile am-tap" @click="playNext">
                <span class="quick-tile-icon bg-[#5856d6]/12 text-[#5856d6]">
                  <Icon :icon="iconPlayerTrackNext" class="w-5 h-5" />
                </span>
                <span class="quick-tile-label">{{ t('song.playNext') }}</span>
              </button>

              <button type="button" class="quick-tile am-tap" @click="toggleFav">
                <span
                  class="quick-tile-icon"
                  :class="isFav ? 'am-accent-bg text-white' : 'bg-[#ff375f]/12 text-[#ff375f]'"
                >
                  <Icon :icon="isFav ? iconHeartFilled : iconHeart" class="w-5 h-5" />
                </span>
                <span class="quick-tile-label">{{ isFav ? t('song.favorited') : t('song.favorite') }}</span>
              </button>

              <button type="button" class="quick-tile am-tap" @click="openPoster">
                <span class="quick-tile-icon bg-[#ff9500]/14 text-[#e08200]">
                  <Icon :icon="iconPhoto" class="w-5 h-5" />
                </span>
                <span class="quick-tile-label">{{ t('song.poster') }}</span>
              </button>

              <button type="button" class="quick-tile am-tap" @click="openUnblock">
                <span class="quick-tile-icon bg-[#34c759]/14 text-[#2fb350]">
                  <Icon :icon="iconSparkles" class="w-5 h-5" />
                </span>
                <span class="quick-tile-label">{{ t('song.unblock') }}</span>
              </button>
            </div>

            <!-- Playback Speed + Sleep Timer Dual Controls Card -->
            <div class="rounded-[20px] bg-[var(--bg-card)] px-4 py-3.5 shadow-xs space-y-3.5">
              <!-- Speed Row (Clean 0.75x / 1.0x / 1.25x / 1.5x — ZERO overflow!) -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                    <Icon :icon="iconGauge" class="w-4 h-4 am-accent-text" />
                    <span>{{ t('song.speed') }}</span>
                  </div>
                  <span class="text-[12px] font-semibold am-accent-text tabular-nums">{{ player.playbackSpeed }}x</span>
                </div>
                <div class="grid grid-cols-4 gap-1.5">
                  <button
                    v-for="spd in speedOptions"
                    :key="spd"
                    type="button"
                    class="h-8 px-1 rounded-xl text-[12px] font-semibold border-0 am-tap transition-colors tabular-nums truncate"
                    :class="
                      player.playbackSpeed === spd
                        ? 'am-accent-bg text-white shadow-xs'
                        : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                    "
                    @click="player.setPlaybackSpeed(spd)"
                  >
                    {{ spd === 1 ? t('song.speedNormal') : `${spd}x` }}
                  </button>
                </div>
              </div>

              <div class="am-hairline-t pt-3">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)]">
                    <Icon :icon="iconMoon" class="w-4 h-4 am-accent-text" />
                    <span>{{ t('song.sleepTimer') }}</span>
                  </div>
                  <span v-if="player.sleepTimerBadge" class="text-[12px] font-semibold am-accent-text tabular-nums">
                    {{ player.sleepTimerBadge }}
                  </span>
                </div>
                <div class="grid grid-cols-5 gap-1.5">
                  <button
                    v-for="opt in sleepOptions"
                    :key="opt.id"
                    type="button"
                    class="h-8 px-1 rounded-xl text-[11px] font-semibold border-0 am-tap transition-colors truncate"
                    :class="
                      player.sleepTimerMode === opt.id
                        ? 'am-accent-bg text-white shadow-xs'
                        : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                    "
                    @click="player.setSleepTimer(opt.id)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Discover & Secondary Actions -->
            <div class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
              <button type="button" class="sheet-item am-tap" @click="openComments">
                <span class="truncate">{{ t('song.viewComments') }}</span>
                <Icon :icon="iconMessageCircle" class="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
              </button>
              <button type="button" class="sheet-item am-tap" @click="openArtist">
                <span class="truncate">{{ t('song.viewArtist') }}</span>
                <Icon :icon="iconUser" class="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
              </button>
              <button v-if="song.album || song.albumId" type="button" class="sheet-item am-tap" @click="openAlbum">
                <span class="truncate">{{ t('song.viewAlbum') }}</span>
                <Icon :icon="iconDisc" class="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
              </button>
              <button type="button" class="sheet-item am-tap" @click="playNow">
                <span class="truncate">{{ t('song.playNow') }}</span>
                <Icon :icon="iconPlayerPlay" class="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
              </button>
              <button type="button" class="sheet-item am-tap" @click="copyTitle">
                <span class="truncate">{{ t('song.copyMeta') }}</span>
                <Icon :icon="iconCopy" class="w-5 h-5 text-[var(--text-secondary)] shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.quick-tile {
  border: 0;
  border-radius: 18px;
  background: var(--bg-card);
  padding: 11px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  min-width: 0;
}

.quick-tile-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.quick-tile-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-primary);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sheet-item {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  background: transparent;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14.5px;
  font-weight: 500;
  color: var(--text-primary);
}
</style>
