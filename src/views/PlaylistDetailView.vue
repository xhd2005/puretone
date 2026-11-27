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
import iconDots from '@iconify/icons-tabler/dots';
import iconEdit from '@iconify/icons-tabler/edit';
import iconTrash from '@iconify/icons-tabler/trash';
import iconPlaylistAdd from '@iconify/icons-tabler/playlist-add';
import iconChecklist from '@iconify/icons-tabler/checklist';
import iconBookmark from '@iconify/icons-tabler/bookmark';
import iconBookmarkFilled from '@iconify/icons-tabler/bookmark-filled';
import iconLock from '@iconify/icons-tabler/lock';
import iconRefresh from '@iconify/icons-tabler/refresh';
import type { PlaylistActionContext, PlaylistSortMode, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  extractDistinctCoversFromSongs,
  recordPlaylistCoversFromSongs,
} from '@/services/playback/playlistCoverResolver';
import {
  readPlaylistSnapshot,
  shouldSyncPlaylistSnapshot,
  sortPlaylistSongs,
  stampPlaylistSnapshotVersion,
  writePlaylistSnapshot,
} from '@/services/playback/playlistSnapshotCache';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { usePlaylistsStore } from '@/stores/playlists';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const route = useRoute();
const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const playlistsStore = usePlaylistsStore();
const ui = useUiStore();
const { t } = useI18n();

const id = computed(() => decodeURIComponent(String(route.params.id || '')));
const queryName = computed(() => String(route.query.name || t('playlist.defaultName')));
const cover = computed(() => String(route.query.cover || ''));
const queryListId = computed(() => String(route.query.listId || ''));
const expectedCount = computed(() => Math.max(0, Number(route.query.count || 0)));
const isFavorite = computed(() => route.query.favorite === '1');
const queryIntro = computed(() => String(route.query.intro || ''));
const createUserId = computed(() => String(route.query.createUserId || ''));
const createListId = computed(() => String(route.query.createListId || ''));

const storePlaylist = computed(
  () => playlistsStore.findById(id.value) || playlistsStore.findById(queryListId.value),
);

const localNameOverride = ref('');
const localIntroOverride = ref<string | null>(null);

const name = computed(() => localNameOverride.value || storePlaylist.value?.name || queryName.value);
const intro = computed(() =>
  localIntroOverride.value !== null
    ? localIntroOverride.value
    : storePlaylist.value?.description || queryIntro.value,
);
const listId = computed(() => storePlaylist.value?.listId || queryListId.value);
const isPrivate = computed(() => Boolean(storePlaylist.value?.isPrivate));
const isOwner = computed(() => {
  if (isFavorite.value) return true;
  if (storePlaylist.value) return storePlaylist.value.isOwner !== false;
  if (route.query.owner === '0') return false;
  if (route.query.owner === '1') return true;
  return Boolean(listId.value);
});
const collectedEntry = computed(() => playlistsStore.isCollected(id.value));
const canCollect = computed(() => !isOwner.value && Boolean(id.value));
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

// Zero-overlap crossfade calibrated to the centered hero header
const heroTitleOpacity = computed(() => {
  const y = scrollTop.value;
  return Number(Math.max(0, Math.min(1, 1 - (y - 185) / 35)).toFixed(3));
});
const compactTitleOpacity = computed(() => {
  if (searchOpen.value || batchMode.value) return 1;
  const y = scrollTop.value;
  return Number(Math.max(0, Math.min(1, (y - 235) / 30)).toFixed(3));
});
const headerGlassActive = computed(() => scrollTop.value > 195 || searchOpen.value || batchMode.value);

// In-playlist instant search
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

// Batch selection mode
const batchMode = ref(false);
const selectedKeys = ref<Set<string>>(new Set());
const batchBusy = ref(false);

// Collect toggle state
const collectBusy = ref(false);

// Manage sheet & edit modal state
const manageSheetOpen = ref(false);
const confirmingDelete = ref(false);
const deletingPlaylist = ref(false);
const editModalOpen = ref(false);
const editName = ref('');
const editIntro = ref('');
const editSaving = ref(false);

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

const selectedSongs = computed(() => filteredSongs.value.filter((s) => selectedKeys.value.has(songKey(s))));
const allSelected = computed(
  () => filteredSongs.value.length > 0 && selectedSongs.value.length === filteredSongs.value.length,
);

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

function removeSongsLocally(removed: Song[]) {
  if (!removed.length) return;
  const removedFileIds = new Set(removed.map((s) => s.fileId).filter((v): v is number => Boolean(v)));
  const removedKeys = new Set(removed.map((s) => songKey(s)));
  songs.value = songs.value.filter((s) => {
    if (s.fileId && removedFileIds.has(s.fileId)) return false;
    return !removedKeys.has(songKey(s));
  });
  totalCount.value = Math.max(0, songs.value.length);
  void writePlaylistSnapshot(cacheKey.value, songs.value, totalCount.value, storePlaylist.value?.totalVer);
  if (listId.value) {
    void playlistsStore.fetchPlaylists(true).then(() => {
      const fresh = storePlaylist.value;
      if (fresh?.totalVer) {
        void stampPlaylistSnapshotVersion(cacheKey.value, fresh.totalVer, fresh.trackCount);
      }
    });
  }
}

const playlistContext = computed<PlaylistActionContext | null>(() => {
  if (!isOwner.value || !listId.value) return null;
  return {
    listId: listId.value,
    globalCollectionId: id.value,
    name: name.value,
    isOwner: true,
    isFavorite: isFavorite.value,
    onTrackRemoved(removedSong) {
      removeSongsLocally([removedSong]);
    },
  };
});

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

function enterBatchMode() {
  echoSystem.haptic('selection');
  manageSheetOpen.value = false;
  searchOpen.value = false;
  batchMode.value = true;
  selectedKeys.value = new Set();
  ui.setBatchDock(true, exitBatchMode);
}

function exitBatchMode() {
  if (!batchMode.value) return;
  echoSystem.haptic('selection');
  batchMode.value = false;
  selectedKeys.value = new Set();
  ui.setBatchDock(false);
}

function toggleSelectSong(song: Song) {
  const key = songKey(song);
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
}

function toggleSelectAll() {
  echoSystem.haptic('selection');
  if (allSelected.value) {
    selectedKeys.value = new Set();
  } else {
    selectedKeys.value = new Set(filteredSongs.value.map((s) => songKey(s)));
  }
}

function handleBatchAdd() {
  if (!selectedSongs.value.length) return;
  ui.openAddToPlaylist([...selectedSongs.value]);
  exitBatchMode();
}

async function handleBatchRemove() {
  if (!isOwner.value || !listId.value || !selectedSongs.value.length || batchBusy.value) return;
  const targets = [...selectedSongs.value];
  echoSystem.haptic('medium');
  batchBusy.value = true;
  try {
    const removed = await playlistsStore.removeSongsFromPlaylist(
      { id: listId.value, listId: listId.value, globalCollectionId: id.value, isFavorite: isFavorite.value },
      targets,
    );
    if (removed > 0) {
      removeSongsLocally(targets);
      echoSystem.haptic('success');
      ui.showToast(t('playlist.removedToast', { count: removed }));
      exitBatchMode();
    } else {
      ui.showToast(t('playlist.actionFailed'));
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    batchBusy.value = false;
  }
}

async function toggleCollectPlaylist() {
  if (!accounts.isLoggedIn) {
    ui.loginModalOpen = true;
    return;
  }
  if (collectBusy.value || !id.value) return;
  echoSystem.haptic('medium');
  collectBusy.value = true;
  try {
    const existing = collectedEntry.value;
    if (existing) {
      await playlistsStore.deletePlaylist(existing);
      echoSystem.haptic('success');
      ui.showToast(t('playlist.uncollectedToast', { name: name.value }));
    } else {
      await playlistsStore.collectPlaylist({
        name: name.value,
        globalCollectionId: id.value,
        createUserId: createUserId.value || undefined,
        createListId: createListId.value || undefined,
      });
      echoSystem.haptic('success');
      ui.showToast(t('playlist.collectedToast', { name: name.value }));
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    collectBusy.value = false;
  }
}

function openEditModal() {
  echoSystem.haptic('light');
  manageSheetOpen.value = false;
  editName.value = name.value;
  editIntro.value = intro.value;
  editModalOpen.value = true;
}

async function savePlaylistEdits() {
  const cleanName = editName.value.trim();
  if (!cleanName || !listId.value || editSaving.value) return;
  echoSystem.haptic('medium');
  editSaving.value = true;
  try {
    await playlistsStore.updatePlaylist({
      listId: listId.value,
      name: cleanName,
      intro: editIntro.value.trim(),
      totalVer: storePlaylist.value?.totalVer,
    });
    localNameOverride.value = cleanName;
    localIntroOverride.value = editIntro.value.trim();
    echoSystem.haptic('success');
    ui.showToast(t('playlist.updatedToast'));
    editModalOpen.value = false;
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    editSaving.value = false;
  }
}

async function confirmDeleteCurrentPlaylist() {
  const targetListId = listId.value || collectedEntry.value?.listId || '';
  if (!targetListId || deletingPlaylist.value) return;
  echoSystem.haptic('medium');
  deletingPlaylist.value = true;
  try {
    await playlistsStore.deletePlaylist({
      id: storePlaylist.value?.id || targetListId,
      listId: targetListId,
      globalCollectionId: id.value,
    });
    echoSystem.haptic('success');
    const toastKey = isOwner.value ? 'playlist.deletedToast' : 'playlist.uncollectedToast';
    ui.showToast(t(toastKey, { name: name.value }));
    manageSheetOpen.value = false;
    router.back();
  } catch (e: any) {
    ui.showToast(e?.message || t('playlist.actionFailed'), 3000);
  } finally {
    deletingPlaylist.value = false;
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

async function syncFromCloud(manual = false) {
  if (syncing.value) return;
  const key = cacheKey.value;
  const hadLocal = songs.value.length > 0;
  syncing.value = true;
  syncProgressCount.value = 0;
  try {
    if (manual && accounts.isLoggedIn) {
      await playlistsStore.fetchPlaylists(true).catch(() => {});
    }
    const cloudCount = Math.max(storePlaylist.value?.trackCount || 0, expectedCount.value, totalCount.value);
    const result = await kugouApi.fetchAllPlaylistTracks({
      globalCollectionId: id.value,
      listId: listId.value || undefined,
      expectedCount: cloudCount,
      signal: abortSignal,
      onProgress(batch, total, done) {
        if (abortSignal.aborted) return;
        syncProgressCount.value = batch.length;
        if (total > totalCount.value) totalCount.value = total;

        if (!hadLocal) {
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
      void writePlaylistSnapshot(key, result.songs, result.total, storePlaylist.value?.totalVer);
      if (isFavorite.value && listId.value) {
        void player.syncFavoritesFromPlaylist(listId.value, result.songs, id.value);
      }
      if (manual) {
        echoSystem.haptic('success');
        ui.showToast(t('playlist.syncedToast', { count: result.songs.length }));
      }
    }
  } catch {
    if (manual) {
      ui.showToast(t('playlist.actionFailed'));
    }
  } finally {
    loading.value = false;
    syncing.value = false;
  }
}

function handleManualSync() {
  echoSystem.haptic('light');
  void syncFromCloud(true);
}

onMounted(async () => {
  if (accounts.isLoggedIn && !playlistsStore.playlists.length) {
    await playlistsStore.fetchPlaylists(false);
  }
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

  // 2. Smart version-checked sync: skip redundant full re-sync when cloud totalVer & count match!
  const cloudMeta = {
    totalVer: storePlaylist.value?.totalVer,
    trackCount: Math.max(storePlaylist.value?.trackCount || 0, expectedCount.value),
  };
  if (shouldSyncPlaylistSnapshot(snap, cloudMeta)) {
    await syncFromCloud(false);
  } else {
    loading.value = false;
  }
});

onUnmounted(() => {
  abortSignal.aborted = true;
  if (highlightTimer) clearTimeout(highlightTimer);
  if (batchMode.value) {
    ui.setBatchDock(false);
  }
});
</script>

<template>
  <div class="h-full flex flex-col relative">
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive }">
      <div class="h-11 px-3 flex items-center justify-between gap-1.5">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[16px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap shrink-0"
          @click="batchMode ? exitBatchMode() : router.back()"
        >
          <Icon v-if="!batchMode" :icon="iconChevronLeft" class="w-6 h-6" />
          <span>{{ batchMode ? t('common.cancel') : t('common.back') }}</span>
        </button>

        <span
          class="text-[16px] font-semibold truncate flex-1 text-center text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: compactTitleOpacity }"
        >
          {{ batchMode ? t('playlist.selectedCount', { count: selectedSongs.length }) : name }}
        </span>

        <div v-if="batchMode" class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="px-2.5 h-8 rounded-full bg-[var(--bg-subtle)] text-[12.5px] font-semibold am-accent-text border-0 am-tap"
            @click="toggleSelectAll"
          >
            {{ allSelected ? t('playlist.unselectAll') : t('playlist.selectAll') }}
          </button>
        </div>

        <div v-else class="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            :aria-label="t('library.syncNow')"
            :disabled="syncing"
            @click="handleManualSync"
          >
            <Icon :icon="iconRefresh" class="w-4.5 h-4.5" :class="{ 'animate-spin': syncing }" />
          </button>
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
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            :aria-label="t('playlist.batchManage')"
            @click="echoSystem.haptic('light'); confirmingDelete = false; manageSheetOpen = true"
          >
            <Icon :icon="iconDots" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Expandable In-Playlist Instant Search Bar -->
      <Transition name="am-expand">
        <div v-if="searchOpen && !batchMode" class="px-4 pb-2.5">
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
      </Transition>
    </header>

    <div ref="scrollContainerRef" class="flex-1 am-scroll pb-52" @scroll.passive="onScroll">
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

        <p
          v-if="intro"
          class="text-[12.5px] text-[var(--text-secondary)] mt-1.5 line-clamp-2 max-w-xs mx-auto leading-relaxed"
        >
          {{ intro }}
        </p>

        <div class="flex items-center justify-center flex-wrap gap-2 mt-1.5 text-[13px] text-[var(--text-secondary)]">
          <span class="tabular-nums">{{ t('common.totalSongs', { count: displayTotal }) }}</span>
          <span
            v-if="isPrivate"
            class="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--text-secondary)] inline-flex items-center gap-0.5"
          >
            <Icon :icon="iconLock" class="w-3 h-3" />
            <span>{{ t('playlist.privateBadge') }}</span>
          </span>
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

        <!-- Secondary Playlist Management Pill Bar -->
        <div class="flex items-center justify-center flex-wrap gap-2 mt-3">
          <button
            v-if="canCollect"
            type="button"
            class="h-8.5 px-3.5 rounded-full text-[12.5px] font-semibold border-0 inline-flex items-center gap-1.5 am-tap transition-colors"
            :class="
              collectedEntry
                ? 'am-accent-bg/14 am-accent-text'
                : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
            "
            :disabled="collectBusy"
            @click="toggleCollectPlaylist"
          >
            <Icon :icon="collectedEntry ? iconBookmarkFilled : iconBookmark" class="w-4 h-4" />
            <span>{{ collectedEntry ? t('playlist.collectedBtn') : t('playlist.collectBtn') }}</span>
          </button>

          <button
            v-if="filteredSongs.length"
            type="button"
            class="h-8.5 px-3.5 rounded-full text-[12.5px] font-semibold border-0 inline-flex items-center gap-1.5 am-tap transition-colors"
            :class="
              batchMode
                ? 'am-accent-bg text-white'
                : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
            "
            @click="batchMode ? exitBatchMode() : enterBatchMode()"
          >
            <Icon :icon="iconChecklist" class="w-4 h-4" />
            <span>{{ batchMode ? t('playlist.batchDone') : t('playlist.batchManage') }}</span>
          </button>

          <button
            v-if="isOwner && !isFavorite && listId"
            type="button"
            class="h-8.5 px-3.5 rounded-full bg-[var(--bg-subtle)] text-[12.5px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center gap-1.5 am-tap"
            @click="openEditModal"
          >
            <Icon :icon="iconEdit" class="w-3.5 h-3.5 am-accent-text" />
            <span>{{ t('playlist.editTitle') }}</span>
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
            :playlist-context="playlistContext"
            :selectable="batchMode"
            :selected="selectedKeys.has(songKey(song))"
            @play="playSongFromList(song)"
            @toggle-select="toggleSelectSong"
          />
        </div>
      </div>
    </div>

    <!-- Teleported Bottom Takeover Batch Dock (Immune to ancestor transform & always in prime thumb zone!) -->
    <Teleport to="body">
      <Transition name="am-dock-slide">
        <div
          v-if="batchMode"
          class="batch-dock-wrap"
        >
          <div class="batch-dock lg-capsule px-2.5 py-2 flex items-center gap-2">
            <button
              type="button"
              class="flex-1 h-11 rounded-full am-accent-bg text-white text-[14px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap disabled:opacity-45 shadow-xs"
              :disabled="!selectedSongs.length || batchBusy"
              @click="handleBatchAdd"
            >
              <Icon :icon="iconPlaylistAdd" class="w-4.5 h-4.5 shrink-0" />
              <span class="truncate">
                {{ t('playlist.batchAdd') }}<template v-if="selectedSongs.length"> ({{ selectedSongs.length }})</template>
              </span>
            </button>

            <button
              v-if="isOwner && listId"
              type="button"
              class="flex-1 h-11 rounded-full bg-[#ff3b30]/14 text-[#ff3b30] text-[14px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap disabled:opacity-45"
              :disabled="!selectedSongs.length || batchBusy"
              @click="handleBatchRemove"
            >
              <Icon :icon="iconTrash" class="w-4 h-4 shrink-0" />
              <span class="truncate">
                {{ batchBusy ? t('common.loading') : t('playlist.batchRemove') }}<template v-if="!batchBusy && selectedSongs.length"> ({{ selectedSongs.length }})</template>
              </span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Floating Liquid Glass "Locate Currently Playing" Button -->
    <Transition name="fade-pop">
      <button
        v-if="currentSongMatchKey && !batchMode"
        type="button"
        class="locate-fab lg-capsule am-tap"
        :class="{ 'has-mini': Boolean(player.currentSong) }"
        :aria-label="t('playlist.locateCurrent')"
        @click="locateCurrentSong"
      >
        <Icon :icon="iconCurrentLocation" class="w-5 h-5 am-accent-text" />
      </button>
    </Transition>

    <!-- Playlist Header Management Sheet -->
    <Transition name="lg-modal">
      <div
        v-if="manageSheetOpen"
        class="fixed inset-0 z-[94] flex flex-col justify-end lg-scrim"
        @click="!deletingPlaylist && (manageSheetOpen = false)"
      >
        <div class="lg-sheet-slide" @click.stop>
          <div class="lg-sheet-panel rounded-t-[28px] px-4 pt-3 pb-[calc(var(--safe-bottom)+18px)] space-y-3">
            <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55 mx-auto" />

            <div class="flex items-center justify-between px-1 pb-2 am-hairline-b">
              <div class="min-w-0">
                <div class="text-[16px] font-bold text-[var(--text-primary)] truncate">{{ name }}</div>
                <div class="text-[12px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                  {{ t('common.totalSongs', { count: displayTotal }) }}
                </div>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                @click="!deletingPlaylist && (manageSheetOpen = false)"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>

            <div v-if="!confirmingDelete" class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
              <button
                v-if="filteredSongs.length"
                type="button"
                class="manage-item am-tap"
                @click="enterBatchMode"
              >
                <span>{{ t('playlist.batchManage') }}</span>
                <Icon :icon="iconChecklist" class="w-5 h-5 am-accent-text" />
              </button>
              <button
                v-if="filteredSongs.length"
                type="button"
                class="manage-item am-tap"
                @click="manageSheetOpen = false; ui.openAddToPlaylist(filteredSongs)"
              >
                <span>{{ t('song.addToPlaylist') }}</span>
                <Icon :icon="iconPlaylistAdd" class="w-5 h-5 text-[var(--text-secondary)]" />
              </button>
              <button
                v-if="isOwner && !isFavorite && listId"
                type="button"
                class="manage-item am-tap"
                @click="openEditModal"
              >
                <span>{{ t('playlist.renameBtn') }}</span>
                <Icon :icon="iconEdit" class="w-5 h-5 text-[var(--text-secondary)]" />
              </button>
              <button
                v-if="(!isFavorite && isOwner && listId) || (!isOwner && collectedEntry)"
                type="button"
                class="manage-item am-tap text-[#ff3b30]"
                @click="echoSystem.haptic('selection'); confirmingDelete = true"
              >
                <span class="font-semibold text-[#ff3b30]">
                  {{ isOwner ? t('playlist.deleteBtn') : t('playlist.uncollectBtn') }}
                </span>
                <Icon :icon="iconTrash" class="w-5 h-5 text-[#ff3b30]" />
              </button>
            </div>

            <div v-else class="rounded-[20px] bg-[var(--bg-card)] p-4 space-y-3 shadow-xs">
              <p class="text-[13.5px] text-[var(--text-primary)] leading-relaxed m-0">
                {{
                  isOwner
                    ? t('playlist.deleteConfirm', { name })
                    : t('playlist.uncollectConfirm', { name })
                }}
              </p>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  class="h-10 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
                  :disabled="deletingPlaylist"
                  @click="confirmingDelete = false"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="h-10 rounded-xl bg-[#ff3b30] text-white text-[14px] font-semibold border-0 am-tap disabled:opacity-50"
                  :disabled="deletingPlaylist"
                  @click="confirmDeleteCurrentPlaylist"
                >
                  {{
                    deletingPlaylist
                      ? t('common.loading')
                      : isOwner
                        ? t('playlist.deleteBtn')
                        : t('playlist.uncollectBtn')
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Edit Playlist Info Modal -->
    <Transition name="lg-dialog">
      <div
        v-if="editModalOpen"
        class="fixed inset-0 z-[95] flex items-center justify-center p-5 lg-scrim"
        @click="!editSaving && (editModalOpen = false)"
      >
        <div
          class="w-full max-w-[360px] rounded-[26px] lg-sheet-panel lg-dialog-card p-5 space-y-4 shadow-2xl"
          @click.stop
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-[17px] font-bold text-[var(--text-primary)] m-0">{{ t('playlist.editTitle') }}</h3>
            <button
              type="button"
              class="w-7.5 h-7.5 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
              @click="!editSaving && (editModalOpen = false)"
            >
              <Icon :icon="iconX" class="w-4 h-4" />
            </button>
          </div>
          <form class="space-y-3" @submit.prevent="savePlaylistEdits">
            <input
              v-model="editName"
              type="text"
              maxlength="40"
              :placeholder="t('playlist.namePlaceholder')"
              class="w-full h-11 px-3.5 rounded-2xl bg-[var(--bg-subtle)] text-[14.5px] text-[var(--text-primary)] border-0 outline-none"
            />
            <textarea
              v-model="editIntro"
              rows="3"
              maxlength="200"
              :placeholder="t('playlist.introPlaceholder')"
              class="w-full p-3.5 rounded-2xl bg-[var(--bg-subtle)] text-[13.5px] text-[var(--text-primary)] border-0 outline-none resize-none"
            />
            <div class="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                class="h-10.5 rounded-2xl bg-[var(--bg-subtle)] text-[var(--text-primary)] text-[14px] font-semibold border-0 am-tap"
                :disabled="editSaving"
                @click="editModalOpen = false"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="submit"
                class="h-10.5 rounded-2xl am-accent-bg text-white text-[14px] font-semibold border-0 am-tap disabled:opacity-45"
                :disabled="editSaving || !editName.trim()"
              >
                {{ editSaving ? t('common.loading') : t('playlist.saveConfirm') }}
              </button>
            </div>
          </form>
        </div>
      </div>
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
  position: absolute;
  right: 18px;
  bottom: calc(var(--safe-bottom) + var(--tabbar-height) + 22px);
  z-index: 25;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: bottom 320ms var(--spring-ease);
}

.locate-fab.has-mini {
  bottom: calc(var(--safe-bottom) + var(--tabbar-height) + var(--miniplayer-height) + 32px);
}

@media (min-width: 768px) {
  .locate-fab {
    bottom: calc(var(--safe-bottom) + 24px);
  }
  .locate-fab.has-mini {
    bottom: calc(var(--safe-bottom) + var(--miniplayer-height) + 30px);
  }
}

.batch-dock-wrap {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(var(--safe-bottom) + 14px);
  z-index: 50;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.batch-dock {
  width: 100%;
  max-width: 480px;
  border-radius: 999px;
  pointer-events: auto;
}

.manage-item {
  width: 100%;
  height: 50px;
  padding: 0 16px;
  background: transparent;
  border: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}

.fade-pop-enter-active,
.fade-pop-leave-active {
  transition: opacity 220ms ease, transform 240ms var(--spring-ease);
}
.fade-pop-enter-from,
.fade-pop-leave-to {
  opacity: 0;
  transform: scale(0.92) translateY(10px);
}
</style>
