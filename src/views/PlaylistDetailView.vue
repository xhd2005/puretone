<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import type { Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  extractDistinctCoversFromSongs,
  recordPlaylistCoversFromSongs,
} from '@/services/playback/playlistCoverResolver';
import { readPlaylistSnapshot, writePlaylistSnapshot } from '@/services/playback/playlistSnapshotCache';
import { usePlayerStore } from '@/stores/player';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();

const id = computed(() => decodeURIComponent(String(route.params.id || '')));
const name = computed(() => String(route.query.name || '歌单'));
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
const scrolled = ref(false);

// In-playlist instant search
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

const abortSignal = { aborted: false };

const filteredSongs = computed(() => {
  const kw = searchQuery.value.trim().toLowerCase();
  if (!kw) return songs.value;
  return songs.value.filter(
    (s) =>
      s.title.toLowerCase().includes(kw) ||
      s.artist.toLowerCase().includes(kw) ||
      s.album.toLowerCase().includes(kw),
  );
});

const fallbackCovers = computed(() => extractDistinctCoversFromSongs(songs.value, 4));

const displayTotal = computed(() => Math.max(songs.value.length, totalCount.value, expectedCount.value));

function onScroll(e: Event) {
  scrolled.value = ((e.target as HTMLElement)?.scrollTop ?? 0) > 210;
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
  const list = searchQuery.value.trim() ? filteredSongs.value : songs.value;
  const idx = list.findIndex((s) => s.id === song.id && s.hash === song.hash);
  void player.playQueue(list, idx >= 0 ? idx : 0);
}

function shufflePlay() {
  const list = filteredSongs.value.length ? filteredSongs.value : songs.value;
  if (!list.length) return;
  const idx = Math.floor(Math.random() * list.length);
  void player.playQueue(list, idx, 'shuffle');
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

  // 2. Full progressive v3 pagination sync (fetches ALL 1000+ tracks smoothly)
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

        // If no snapshot existed, stream batches live to UI right away!
        // If snapshot existed, update smoothly once we have >= snapshot length or on completion.
        if (!hadSnapshot || done || batch.length >= songs.value.length) {
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
});
</script>

<template>
  <div class="h-full flex flex-col relative">
    <header class="sticky-bar" :class="{ 'am-glass am-hairline-b': scrolled || searchOpen }">
      <div class="h-11 px-3 flex items-center justify-between gap-2">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[16px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap shrink-0"
          @click="router.back()"
        >
          <Icon :icon="iconChevronLeft" class="w-6 h-6" />
          <span>返回</span>
        </button>

        <span
          class="text-[16px] font-semibold truncate flex-1 text-center transition-opacity duration-200 text-[var(--text-primary)]"
          :class="scrolled || searchOpen ? 'opacity-100' : 'opacity-0'"
        >
          {{ name }}
        </span>

        <button
          type="button"
          class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap shrink-0"
          aria-label="歌单内搜索"
          @click="toggleSearch"
        >
          <Icon :icon="searchOpen ? iconX : iconSearch" class="w-5 h-5" />
        </button>
      </div>

      <!-- Expandable In-Playlist Instant Search Bar -->
      <div v-if="searchOpen" class="px-4 pb-2.5">
        <div class="h-9 rounded-xl bg-[var(--bg-subtle)] px-3 flex items-center gap-2">
          <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            placeholder="在当前歌单中搜索歌名、歌手或专辑…"
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

    <div class="flex-1 am-scroll pb-48" @scroll.passive="onScroll">
      <!-- Apple Music Centered Album/Playlist Hero -->
      <div class="px-6 pt-[calc(var(--safe-top)+56px)] pb-5 text-center">
        <div class="w-[216px] h-[216px] mx-auto rounded-[18px] overflow-hidden shadow-2xl">
          <PlaylistCover
            :playlist-key="cacheKey"
            :cover-url="cover"
            :fallback-covers="fallbackCovers"
            :alt="name"
          />
        </div>

        <h1 class="text-[22px] font-bold tracking-tight mt-4 text-[var(--text-primary)] leading-snug">
          {{ name }}
        </h1>

        <div class="flex items-center justify-center gap-2 mt-1 text-[13px] text-[var(--text-secondary)]">
          <span class="tabular-nums">共 {{ displayTotal }} 首歌曲</span>
          <span
            v-if="syncing"
            class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[11px] font-medium am-accent-text tabular-nums"
          >
            {{ syncProgressCount > 0 ? `正在同步 ${syncProgressCount}/${displayTotal}…` : '同步最新歌单…' }}
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
            <span>播放</span>
          </button>
          <button
            type="button"
            class="h-11 rounded-[13px] bg-[var(--bg-subtle)] am-accent-text text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            :disabled="!filteredSongs.length"
            @click="shufflePlay"
          >
            <Icon :icon="iconArrowsShuffle" class="w-4 h-4" />
            <span>随机播放</span>
          </button>
        </div>
      </div>

      <div v-if="loading && !songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        正在加载歌曲列表…
      </div>
      <div v-else-if="searchQuery.trim() && !filteredSongs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        歌单内未找到“{{ searchQuery }}”
      </div>
      <div v-else-if="!songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        歌单暂时为空
      </div>
      <div v-else>
        <SongRow
          v-for="(song, idx) in filteredSongs"
          :key="`${song.fileId || song.hash || song.id}-${idx}`"
          :song="song"
          @play="playSongFromList(song)"
        />
      </div>
    </div>
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
  transition: background-color 220ms ease;
}
</style>
