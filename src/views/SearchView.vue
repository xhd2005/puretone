<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import iconFlame from '@iconify/icons-tabler/flame';
import iconUser from '@iconify/icons-tabler/user';
import iconDisc from '@iconify/icons-tabler/disc';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import type { AlbumSummary, ArtistSummary, HotSearchTab, PlaylistSummary, Song } from '@/types/music';
import { formatCompactCount, kugouApi } from '@/services/kugou/kugouEngine';
import { getPlaylistCacheKey } from '@/services/playback/playlistCoverResolver';
import { echoSystem } from '@/native/echoSystem';
import { usePlayerStore } from '@/stores/player';
import { useI18n } from '@/i18n';
import { useCollapsingTitle } from '@/composables/useCollapsingTitle';
import AvatarButton from '@/components/AvatarButton.vue';
import SongRow from '@/components/SongRow.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

type SearchTab = 'song' | 'artist' | 'album' | 'playlist';

const router = useRouter();
const player = usePlayerStore();
const { t, effectiveLocale } = useI18n();
const { largeTitleOpacity, compactTitleOpacity, headerGlassActive, onScroll } = useCollapsingTitle();

const HISTORY_KEY = 'search.history.v1';

const query = ref('');
const submittedQuery = ref('');
const activeTab = ref<SearchTab>('song');
const hotTabs = ref<HotSearchTab[]>([]);
const activeHotTabIdx = ref(0);
const history = ref<string[]>([]);
const suggestions = ref<string[]>([]);

const songs = ref<Song[]>([]);
const artists = ref<ArtistSummary[]>([]);
const albums = ref<AlbumSummary[]>([]);
const playlists = ref<PlaylistSummary[]>([]);
const searching = ref(false);
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

const activeHotTab = computed(() => hotTabs.value[activeHotTabIdx.value] || hotTabs.value[0] || null);

onMounted(async () => {
  history.value = await echoSystem.kvGetJson<string[]>(HISTORY_KEY, []);
  hotTabs.value = await kugouApi.getHotSearchTabs().catch(() => []);
});

watch(query, (val) => {
  if (suggestTimer) clearTimeout(suggestTimer);
  const trimmed = val.trim();
  if (!trimmed) {
    suggestions.value = [];
    submittedQuery.value = '';
    return;
  }
  suggestTimer = setTimeout(async () => {
    if (trimmed === submittedQuery.value) return;
    suggestions.value = await kugouApi.getSearchSuggest(trimmed).catch(() => []);
  }, 280);
});

async function runSearch(keyword?: string) {
  const kw = (keyword ?? query.value).trim();
  if (!kw) return;
  echoSystem.haptic('light');
  query.value = kw;
  submittedQuery.value = kw;
  suggestions.value = [];
  searching.value = true;

  const nextHist = [kw, ...history.value.filter((h) => h !== kw)].slice(0, 12);
  history.value = nextHist;
  void echoSystem.kvSetJson(HISTORY_KEY, nextHist);

  try {
    const [songRes, artistRes, albumRes, plRes] = await Promise.all([
      kugouApi.searchSongs(kw, 1, 35).catch(() => ({ songs: [], total: 0 })),
      kugouApi.searchArtists(kw, 1, 18).catch(() => []),
      kugouApi.searchAlbums(kw, 1, 20).catch(() => []),
      kugouApi.searchPlaylists(kw, 1, 20).catch(() => []),
    ]);
    songs.value = songRes.songs;
    artists.value = artistRes;
    albums.value = albumRes;
    playlists.value = plRes;
  } finally {
    searching.value = false;
  }
}

function clearSearch() {
  query.value = '';
  submittedQuery.value = '';
  suggestions.value = [];
  songs.value = [];
  artists.value = [];
  albums.value = [];
  playlists.value = [];
}

function clearHistory() {
  echoSystem.haptic('selection');
  history.value = [];
  void echoSystem.kvSetJson(HISTORY_KEY, []);
}

function openArtist(art: ArtistSummary) {
  echoSystem.haptic('light');
  void router.push({
    path: `/artist/${encodeURIComponent(art.id)}`,
    query: { name: art.name, avatar: art.avatar },
  });
}

function openAlbum(al: AlbumSummary) {
  echoSystem.haptic('light');
  void router.push({
    path: `/album/${encodeURIComponent(al.id)}`,
    query: { name: al.name, cover: al.coverUrl, artist: al.artist, artistId: al.artistId || '' },
  });
}
</script>

<template>
  <div class="h-full flex flex-col relative">
    <!-- Zero-Overlap Collapsing Sticky Header -->
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive }">
      <div class="flex items-center justify-between h-11 px-5">
        <span
          class="text-[17px] font-bold tracking-tight text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: compactTitleOpacity }"
        >
          {{ t('search.title') }}
        </span>
        <AvatarButton />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-48" @scroll.passive="onScroll">
      <div class="px-5 pt-[calc(var(--safe-top)+48px)] pb-3">
        <h1
          class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]"
          :style="{ opacity: largeTitleOpacity }"
        >
          {{ t('search.title') }}
        </h1>
      </div>

      <!-- Sticky Search Input Bar cleanly sitting under header -->
      <div class="px-5 pb-3 sticky top-[calc(var(--safe-top)+44px)] z-15 bg-[var(--bg-canvas)]/95 backdrop-blur-md">
        <form class="search-box" @submit.prevent="runSearch()">
          <Icon :icon="iconSearch" class="w-4.5 h-4.5 text-[var(--text-secondary)] shrink-0" />
          <input
            v-model="query"
            type="search"
            enterkeyhint="search"
            :placeholder="t('search.placeholder')"
            class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15.5px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          <button
            v-if="query"
            type="button"
            class="w-5 h-5 rounded-full bg-[var(--text-tertiary)] text-[var(--bg-canvas)] border-0 flex items-center justify-center shrink-0"
            @click="clearSearch"
          >
            <Icon :icon="iconX" class="w-3 h-3" />
          </button>
        </form>
      </div>

      <!-- Live Suggestions -->
      <div v-if="suggestions.length && !submittedQuery" class="px-5 divide-y divide-[var(--hairline)]">
        <button
          v-for="s in suggestions"
          :key="s"
          type="button"
          class="w-full h-12 flex items-center gap-3 bg-transparent border-0 text-left text-[15px] text-[var(--text-primary)] am-tap"
          @click="runSearch(s)"
        >
          <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
          <span class="truncate">{{ s }}</span>
        </button>
      </div>

      <!-- ==================== SEARCH RESULTS (4-TAB: SONGS / ARTISTS / ALBUMS / PLAYLISTS) ==================== -->
      <div v-else-if="submittedQuery">
        <div class="px-5 mb-3">
          <div class="pt-seg-group grid-cols-4">
            <button
              type="button"
              class="pt-seg-btn"
              :class="activeTab === 'song' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'song'"
            >
              {{ t('search.songsTab') }}
            </button>
            <button
              type="button"
              class="pt-seg-btn"
              :class="activeTab === 'artist' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'artist'"
            >
              {{ t('search.artistsTab') }}
            </button>
            <button
              type="button"
              class="pt-seg-btn"
              :class="activeTab === 'album' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'album'"
            >
              {{ t('search.albumsTab') }}
            </button>
            <button
              type="button"
              class="pt-seg-btn"
              :class="activeTab === 'playlist' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'playlist'"
            >
              {{ t('search.playlistsTab') }}
            </button>
          </div>
        </div>

        <div v-if="searching" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">{{ t('search.searching') }}</div>

        <!-- Tab 1: Songs -->
        <div v-else-if="activeTab === 'song'">
          <div v-if="!songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">{{ t('search.noResults') }}</div>
          <SongRow
            v-for="(song, idx) in songs"
            :key="song.hash || `${song.id}-${idx}`"
            :song="song"
            @play="player.playQueue(songs, idx)"
          />
        </div>

        <!-- Tab 2: Artists -->
        <div v-else-if="activeTab === 'artist'" class="px-5 space-y-2">
          <div v-if="!artists.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">{{ t('search.noResults') }}</div>
          <button
            v-for="art in artists"
            :key="art.id"
            type="button"
            class="w-full p-2.5 rounded-[18px] bg-[var(--bg-card)] border-0 flex items-center gap-3 text-left shadow-xs am-tap"
            @click="openArtist(art)"
          >
            <div class="w-13 h-13 rounded-full overflow-hidden bg-[var(--bg-subtle)] shrink-0 flex items-center justify-center">
              <img v-if="art.avatar" :src="art.avatar" :alt="art.name" class="w-full h-full object-cover" loading="lazy" />
              <Icon v-else :icon="iconUser" class="w-6 h-6 text-[var(--text-tertiary)]" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[15px] font-bold text-[var(--text-primary)] truncate">{{ art.name }}</div>
              <div class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5 tabular-nums">
                <template v-if="art.songCount > 0">{{ t('artist.songsUnit', { count: formatCompactCount(art.songCount, effectiveLocale) }) }}</template>
                <template v-if="art.albumCount > 0"> · {{ t('artist.albumsUnit', { count: formatCompactCount(art.albumCount, effectiveLocale) }) }}</template>
                <template v-if="art.fansCount > 0"> · {{ t('artist.fansUnit', { count: formatCompactCount(art.fansCount, effectiveLocale) }) }}</template>
              </div>
            </div>
            <Icon :icon="iconChevronRight" class="w-4.5 h-4.5 text-[var(--text-tertiary)] shrink-0" />
          </button>
        </div>

        <!-- Tab 3: Albums -->
        <div v-else-if="activeTab === 'album'" class="px-5">
          <div v-if="!albums.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">{{ t('search.noResults') }}</div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div
              v-for="al in albums"
              :key="al.id"
              class="cursor-pointer am-tap min-w-0"
              @click="openAlbum(al)"
            >
              <div class="aspect-square rounded-[14px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm flex items-center justify-center">
                <img v-if="al.coverUrl" :src="al.coverUrl" :alt="al.name" class="w-full h-full object-cover" loading="lazy" />
                <Icon v-else :icon="iconDisc" class="w-10 h-10 text-[var(--text-tertiary)]" />
              </div>
              <div class="text-[14px] font-semibold truncate mt-2 text-[var(--text-primary)]">{{ al.name }}</div>
              <div class="text-[12px] text-[var(--text-secondary)] truncate mt-0.5">
                {{ al.artist }}<template v-if="al.publishDate"> · {{ al.publishDate.slice(0, 4) }}</template>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 4: Playlists -->
        <div v-else class="px-5">
          <div v-if="!playlists.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">{{ t('search.noResults') }}</div>
          <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div
              v-for="pl in playlists"
              :key="pl.id"
              class="cursor-pointer am-tap min-w-0"
              @click="router.push({ path: `/playlist/${encodeURIComponent(pl.globalCollectionId || pl.id)}`, query: { name: pl.name, cover: pl.coverUrl, count: String(pl.trackCount) } })"
            >
              <div class="aspect-square rounded-[14px] overflow-hidden shadow-sm">
                <PlaylistCover
                  :playlist-key="getPlaylistCacheKey(pl)"
                  :cover-url="pl.coverUrl"
                  :alt="pl.name"
                />
              </div>
              <div class="text-[14px] font-medium truncate mt-2 text-[var(--text-primary)]">{{ pl.name }}</div>
              <div class="text-[12px] text-[var(--text-secondary)] tabular-nums">{{ t('search.songUnitShort', { count: pl.trackCount }) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== EMPTY STATE: RECENT SEARCHES + MULTI-CHART HOT SEARCH BOARD ==================== -->
      <div v-else class="px-5 space-y-6 pt-2">
        <section v-if="history.length">
          <div class="flex items-center justify-between mb-2.5">
            <h2 class="text-[17px] font-bold text-[var(--text-primary)]">{{ t('search.recentTitle') }}</h2>
            <button
              type="button"
              class="text-[13px] font-medium am-accent-text bg-transparent border-0 p-0 am-tap"
              @click="clearHistory"
            >
              {{ t('search.clearHistory') }}
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="h in history"
              :key="h"
              type="button"
              class="px-3.5 py-1.5 rounded-full bg-[var(--bg-subtle)] text-[13.5px] text-[var(--text-primary)] border-0 am-tap max-w-full truncate"
              @click="runSearch(h)"
            >
              {{ h }}
            </button>
          </div>
        </section>

        <!-- Ranked Trending Hot Search Charts -->
        <section v-if="hotTabs.length" class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-[18px] font-bold text-[var(--text-primary)] flex items-center gap-1.5 m-0">
              <Icon :icon="iconFlame" class="w-5 h-5 am-accent-text" />
              <span>{{ t('search.hotTitle') }}</span>
            </h2>
          </div>

          <!-- Chart Category Pills (when multiple KuGou hot tabs exist) -->
          <div v-if="hotTabs.length > 1" class="flex items-center gap-1.5 am-hscroll pb-0.5">
            <button
              v-for="(tab, idx) in hotTabs"
              :key="`${tab.title}-${idx}`"
              type="button"
              class="px-3 h-7 rounded-full text-[12px] font-semibold border-0 shrink-0 transition-colors"
              :class="
                activeHotTabIdx === idx
                  ? 'am-accent-bg text-white shadow-xs'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
              "
              @click="echoSystem.haptic('selection'); activeHotTabIdx = idx"
            >
              {{ tab.title }}
            </button>
          </div>

          <!-- Ranked Top 20 Chart Card -->
          <div
            v-if="activeHotTab"
            class="rounded-[22px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs"
          >
            <button
              v-for="item in activeHotTab.items"
              :key="`${item.rank}-${item.keyword}`"
              type="button"
              class="w-full px-4 py-3 bg-transparent border-0 flex items-center gap-3 text-left active:bg-[var(--bg-subtle)] transition-colors"
              @click="runSearch(item.keyword)"
            >
              <span
                class="w-6 text-center text-[15px] font-extrabold tabular-nums shrink-0"
                :class="
                  item.rank === 1
                    ? 'text-[#f59e0b]'
                    : item.rank === 2
                      ? 'text-[#94a3b8]'
                      : item.rank === 3
                        ? 'text-[#d97706]'
                        : 'text-[var(--text-tertiary)] font-semibold text-[13.5px]'
                "
              >
                {{ item.rank }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span
                    class="text-[14.5px] truncate text-[var(--text-primary)]"
                    :class="item.rank <= 3 ? 'font-bold' : 'font-medium'"
                  >
                    {{ item.keyword }}
                  </span>
                  <span
                    v-if="item.tag"
                    class="px-1.5 py-0.5 rounded text-[9px] font-extrabold leading-none shrink-0"
                    :class="
                      item.tag === 'NEW'
                        ? 'bg-[#34c759]/16 text-[#2fb350]'
                        : 'bg-[#ff3b30]/14 text-[#ff3b30]'
                    "
                  >
                    {{ item.tag }}
                  </span>
                </div>
                <div v-if="item.reason" class="text-[11.5px] text-[var(--text-secondary)] truncate mt-0.5">
                  {{ item.reason }}
                </div>
              </div>
              <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-tertiary)] shrink-0 opacity-65" />
            </button>
          </div>
        </section>
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
  transition: background-color 180ms ease;
}

.search-box {
  height: 42px;
  border-radius: 13px;
  background: var(--bg-subtle);
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
