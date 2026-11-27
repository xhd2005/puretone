<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import iconArrowsSort from '@iconify/icons-tabler/arrows-sort';
import iconCurrentLocation from '@iconify/icons-tabler/current-location';
import type { PlaylistSortMode, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  extractDistinctCoversFromSongs,
  recordPlaylistCoversFromSongs,
} from '@/services/playback/playlistCoverResolver';
import {
  readPlaylistSnapshot,
  sortPlaylistSongs,
  writePlaylistSnapshot,
} from '@/services/playback/playlistSnapshotCache';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const id = computed(() => decodeURIComponent(String(route.params.id || '')));
const name = computed(() => String(route.query.name || t('playlist.defaultName')));
const cover = computed(() => String(route.query.cover || ''));
const listId = computed(() => String(route.query.listId || ''));
const expectedCount = computed(() => Math.max(0, Number(route.query.count || 0)));
const isFavorite = computed(() => route.query.favorite === '1');
const cacheKey = computed(() => id.value || listId.value);

const songs = ref<Song[]>([]);
const totalCount = ref(0);
const loading = ref(true);
const syncing = ref(false);
const syncProgressCount = ref(0);
const scrollTop = ref(0);
const scrollContainerRef = ref<HTMLElement | null>(null);

// Sort mode: "我喜欢" defaults to 'newest' (most recently liked at top!)
const sortMode = ref<PlaylistSortMode>(isFavorite.value ? 'newest' : 'default');

watch(isFavorite, (fav) => {
  sortMode.value = fav ? 'newest' : 'default';
});

const sortLabelMap = computed<Record<PlaylistSortMode, string>>(() => ({
  default: t('sort.default'),
  newest: t('sort.newest'),
  oldest: t('sort.oldest'),
  title: t('sort.title'),
  artist: t('sort.artist'),
}));

const availableSortModes = computed<PlaylistSortMode[]>(() =>
  isFavorite.value ? ['newest', 'oldest', 'title', 'artist'] : ['default', 'newest', 'title', 'artist'],
);

function cycleSortMode() {
  echoSystem.haptic('selection');
  const modes = availableSortModes.value;
  const idx = modes.indexOf(sortMode.value);
  const next = modes[(idx + 1) % modes.length];
  sortMode.value = next;
  ui.showToast(t('sort.toast', { label: sortLabelMap.value[next] }));
}

// Zero-overlap crossfade calibrated to the centered 216px hero header:
// Hero <h1> fades 1->0 over 185..220px; compact top title fades 0->1 over 235..265px (15px dead zone).
const heroTitleOpacity = computed(() => {
  const y = scrollTop.value;
  return Number(Math.max(0, Math.min(1, 1 - (y - 185) / 35)).toFixed(3));
});
const compactTitleOpacity = computed(() => {
  if (searchOpen.value) return 1;
  const y = scrollTop.value;
  return Number(Math.max(0, Math.min(1, (y - 235) / 30)).toFixed(3));
});
const headerGlassActive = computed(() => scrollTop.value > 195 || searchOpen.value);

// In-playlist instant search
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

// Locate currently playing song highlight
const highlightedSongKey = ref('');
let highlightTimer: ReturnType<typeof setTimeout> | null = null;

const abortSignal = { aborted: false };

function songKey(s: Song): string {
  return s.fileId ? `f:${s.fileId}` : s.hash ? `h:${s.hash.toLowerCase()}` : `id:${s.id}`;
}

const sortedSongs = computed(() => sortPlaylistSongs(songs.value, sortMode.value));

const filteredSongs = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase();
  if (!kw) return sortedSongs.value;
  return sortedSongs.value.filter(
    (s) =>
      s.title.toLowerCase().includes(kw) ||
      s.artist.toLowerCase().includes(kw) ||
      s.album.toLowerCase().includes(kw),
  );
});

const currentSongMatchKey = computed(() => {
  const cur = player.currentSong;
  if (!cur) return '';
  const match = filteredSongs.value.find(
    (s) => (cur.hash && s.hash === cur.hash) || (cur.id && s.id === cur.id),
  );
  return match ? songKey(match) : '';
});

const fallbackCovers = computed(() => extractDistinctCoversFromSongs(songs.value, 4));
const displayTotal = computed(() => Math.max(songs.value.length, totalCount.value, expectedCount.value));

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement)?.scrollTop ?? 0;
}

function toggleSearch() {
  echoSystem.haptic('selection');
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    void nextTick(() => searchInputRef.value?.focus());
  } else {
    searchQuery.value = '';
  }
}

function playSongFromList(song: Song) {
  const list = filteredSongs.value;
  const idx = list.findIndex((s) => s.id === song.id && s.hash === song.hash);
  void player.playQueue(list, idx >= 0 ? idx : 0);
}

function shufflePlay() {
  const list = filteredSongs.value;
  if (!list.length) return;
  const idx = Math.floor(Math.random() * list.length);
  void player.playQueue(list, idx, 'shuffle');
}

function locateCurrentSong() {
  const key = currentSongMatchKey.value;
  if (!key || !scrollContainerRef.value) return;
  echoSystem.haptic('light');
  const escaped = key.replace(/"/g, '\\"');
  const rowEl = scrollContainerRef.value.querySelector(`[data-song-key="${escaped}"]`) as HTMLElement | null;
  if (rowEl) {
    rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightedSongKey.value = key;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedSongKey.value = '';
    }, 1500);
  }
}

onMounted(async () => {
  const key = cacheKey.value;

  // 1. Instant local SQLite snapshot hydration (0ms startup for 1000+ song playlists!)
  const snap = await readPlaylistSnapshot(key);
  const hadSnapshot = Boolean(snap && snap.songs.length > 0);
  if (hadSnapshot && snap) {
    songs.value = snap.songs;
    totalCount.value = Math.max(snap.totalCount, expectedCount.value);
    loading.value = false;
    recordPlaylistCoversFromSongs(key, snap.songs);
    if (isFavorite.value && listId.value) {
      void player.syncFavoritesFromPlaylist(listId.value, snap.songs, id.value);
    }
  }

  // 2. Full progressive v3 pagination sync (commits cleanly to avoid mid-sync flicker)
  syncing.value = true;
  try {
    const result = await kugouApi.fetchAllPlaylistTracks({
      globalCollectionId: id.value,
      listId: listId.value || undefined,
      expectedCount: Math.max(expectedCount.value, totalCount.value),
      signal: abortSignal,
      onProgress(batch, total, done) {
        if (abortSignal.aborted) return;
        syncProgressCount.value = batch.length;
        if (total > totalCount.value) totalCount.value = total;

        // Stream live only on cold-start (no snapshot). If snapshot is already rendered,
        // wait until completion so the list never flickers or jumps under the user's finger!
        if (!hadSnapshot) {
          songs.value = batch;
          loading.value = false;
        }
        if (batch.length >= 4 || done) {
          recordPlaylistCoversFromSongs(key, batch);
        }
      },
    });

    if (!abortSignal.aborted && result.songs.length > 0) {
      songs.value = result.songs;
      totalCount.value = result.total;
      recordPlaylistCoversFromSongs(key, result.songs);
      void writePlaylistSnapshot(key, result.songs, result.total);
      if (isFavorite.value && listId.value) {
        void player.syncFavoritesFromPlaylist(listId.value, result.songs, id.value);
      }
    }
  } finally {
    loading.value = false;
    syncing.value = false;
  }
});

onUnmounted(() => {
  abortSignal.aborted = true;
  if (highlightTimer) clearTimeout(highlightTimer);
});
</script>

<template>
  <div class="h-full flex flex-col relative">
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive }">
      <div class="h-11 px-3 flex items-center justify-between gap-1.5">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[16px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap shrink-0"
          @click="router.back()"
        >
          <Icon :icon="iconChevronLeft" class="w-6 h-6" />
          <span>{{ t('common.back') }}</span>
        </button>

        <span
          class="text-[16px] font-semibold truncate flex-1 text-center text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: compactTitleOpacity }"
        >
          {{ name }}
        </span>

        <div class="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            :aria-label="sortLabelMap[sortMode]"
            @click="cycleSortMode"
          >
            <Icon :icon="iconArrowsSort" class="w-5 h-5" />
          </button>
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            :aria-label="t('search.title')"
            @click="toggleSearch"
          >
            <Icon :icon="searchOpen ? iconX : iconSearch" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Expandable In-Playlist Instant Search Bar -->
      <div v-if="searchOpen" class="px-4 pb-2.5">
        <div class="h-9 rounded-xl bg-[var(--bg-subtle)] px-3 flex items-center gap-2">
          <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            :placeholder="t('playlist.searchPlaceholder')"
            class="flex-1 bg-transparent border-0 outline-none text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="w-4.5 h-4.5 rounded-full bg-[var(--text-tertiary)] text-[var(--bg-canvas)] border-0 flex items-center justify-center shrink-0"
            @click="searchQuery = ''"
          >
            <Icon :icon="iconX" class="w-3 h-3" />
          </button>
        </div>
      </div>
    </header>

    <div ref="scrollContainerRef" class="flex-1 am-scroll pb-48" @scroll.passive="onScroll">
      <!-- Apple Music Centered Album/Playlist Hero -->
      <div class="px-6 pt-[calc(var(--safe-top)+56px)] pb-5 text-center">
        <div class="w-[212px] h-[212px] mx-auto rounded-[18px] overflow-hidden shadow-2xl">
          <PlaylistCover
            :playlist-key="cacheKey"
            :cover-url="cover"
            :fallback-covers="fallbackCovers"
            :alt="name"
          />
        </div>

        <h1
          class="text-[22px] font-bold tracking-tight mt-4 text-[var(--text-primary)] leading-snug"
          :style="{ opacity: heroTitleOpacity }"
        >
          {{ name }}
        </h1>

        <div class="flex items-center justify-center flex-wrap gap-2 mt-1.5 text-[13px] text-[var(--text-secondary)]">
          <span class="tabular-nums">{{ t('common.totalSongs', { count: displayTotal }) }}</span>
          <button
            type="button"
            class="px-2.5 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--text-secondary)] border-0 inline-flex items-center gap-1 am-tap"
            @click="cycleSortMode"
          >
            <Icon :icon="iconArrowsSort" class="w-3 h-3 am-accent-text" />
            <span>{{ sortLabelMap[sortMode] }}</span>
          </button>
          <span
            v-if="syncing"
            class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[11px] font-medium am-accent-text tabular-nums"
          >
            {{ syncProgressCount > 0 ? t('playlist.syncing', { done: syncProgressCount, total: displayTotal }) : t('playlist.syncLatest') }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-3 mt-5 max-w-sm mx-auto">
          <button
            type="button"
            class="h-11 rounded-[13px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap shadow-sm"
            :disabled="!filteredSongs.length"
            @click="player.playQueue(filteredSongs, 0)"
          >
            <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4" />
            <span>{{ t('common.play') }}</span>
          </button>
          <button
            type="button"
            class="h-11 rounded-[13px] bg-[var(--bg-subtle)] am-accent-text text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            :disabled="!filteredSongs.length"
            @click="shufflePlay"
          >
            <Icon :icon="iconArrowsShuffle" class="w-4 h-4" />
            <span>{{ t('common.shuffle') }}</span>
          </button>
        </div>
      </div>

      <div v-if="loading && !songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        {{ t('playlist.loading') }}
      </div>
      <div v-else-if="searchQuery.trim() && !filteredSongs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        {{ t('playlist.notFound', { query: searchQuery }) }}
      </div>
      <div v-else-if="!songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        {{ t('playlist.empty') }}
      </div>
      <div v-else>
        <div
          v-for="song in filteredSongs"
          :key="songKey(song)"
          :data-song-key="songKey(song)"
        >
          <SongRow
            :song="song"
            :highlighted="highlightedSongKey === songKey(song)"
            @play="playSongFromList(song)"
          />
        </div>
      </div>
    </div>

    <!-- Floating Liquid Glass "Locate Currently Playing" Button -->
    <Transition name="fade-pop">
      <button
        v-if="currentSongMatchKey"
        type="button"
        class="locate-fab lg-surface am-tap"
        aria-label="定位当前播放歌曲"
        @click="locateCurrentSong"
      >
        <Icon :icon="iconCurrentLocation" class="w-5 h-5 am-accent-text" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.sticky-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  padding-top: var(--safe-top);
  transition: background-color 180ms ease;
}

.locate-fab {
  position: fixed;
  right: 18px;
  bottom: calc(var(--safe-bottom) + var(--tabbar-h) + var(--miniplayer-h) + 22px);
  z-index: 25;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fade-pop-enter-active,
.fade-pop-leave-active {
  transition: opacity 220ms ease, transform 240ms var(--spring-ease);
}
.fade-pop-enter-from,
.fade-pop-leave-to {
  opacity: 0;
  transform: scale(0.84) translateY(8px);
}
</style>
