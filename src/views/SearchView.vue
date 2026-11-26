<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import type { PlaylistSummary, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { getPlaylistCacheKey } from '@/services/playback/playlistCoverResolver';
import { echoSystem } from '@/native/echoSystem';
import { usePlayerStore } from '@/stores/player';
import AvatarButton from '@/components/AvatarButton.vue';
import SongRow from '@/components/SongRow.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const router = useRouter();
const player = usePlayerStore();

const HISTORY_KEY = 'search.history.v1';

const query = ref('');
const submittedQuery = ref('');
const activeTab = ref<'song' | 'playlist'>('song');
const hotKeywords = ref<string[]>([]);
const history = ref<string[]>([]);
const suggestions = ref<string[]>([]);
const songs = ref<Song[]>([]);
const playlists = ref<PlaylistSummary[]>([]);
const searching = ref(false);
let suggestTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(async () => {
  history.value = await echoSystem.kvGetJson<string[]>(HISTORY_KEY, []);
  hotKeywords.value = await kugouApi.getHotSearch().catch(() => []);
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
    const [songRes, plRes] = await Promise.all([
      kugouApi.searchSongs(kw, 1, 35).catch(() => ({ songs: [], total: 0 })),
      kugouApi.searchPlaylists(kw, 1, 20).catch(() => []),
    ]);
    songs.value = songRes.songs;
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
  playlists.value = [];
}

function clearHistory() {
  history.value = [];
  void echoSystem.kvSetJson(HISTORY_KEY, []);
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Top Header + Sticky iOS Search Bar -->
    <div class="pt-[calc(var(--safe-top)+12px)] px-5 pb-3 bg-[var(--bg-canvas)] shrink-0">
      <div class="flex items-center justify-between mb-3">
        <h1 class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]">搜索</h1>
        <AvatarButton />
      </div>

      <form class="search-box" @submit.prevent="runSearch()">
        <Icon :icon="iconSearch" class="w-4.5 h-4.5 text-[var(--text-secondary)] shrink-0" />
        <input
          v-model="query"
          type="search"
          enterkeyhint="search"
          placeholder="艺人、歌曲、歌词与歌单"
          class="flex-1 bg-transparent border-0 outline-none text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
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

    <div class="flex-1 am-scroll pb-48">
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

      <!-- Search Results -->
      <div v-else-if="submittedQuery">
        <div class="px-5 mb-3">
          <div class="grid grid-cols-2 p-1 rounded-xl bg-[var(--bg-subtle)] max-w-xs">
            <button
              type="button"
              class="h-8 rounded-[9px] text-[13px] font-semibold border-0 transition-all"
              :class="activeTab === 'song' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'song'"
            >
              单曲 ({{ songs.length }})
            </button>
            <button
              type="button"
              class="h-8 rounded-[9px] text-[13px] font-semibold border-0 transition-all"
              :class="activeTab === 'playlist' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="echoSystem.haptic('selection'); activeTab = 'playlist'"
            >
              歌单 ({{ playlists.length }})
            </button>
          </div>
        </div>

        <div v-if="searching" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">正在搜索…</div>

        <div v-else-if="activeTab === 'song'">
          <div v-if="!songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">未找到相关歌曲</div>
          <SongRow
            v-for="(song, idx) in songs"
            :key="`${song.id}-${idx}`"
            :song="song"
            @play="player.playQueue(songs, idx)"
          />
        </div>

        <div v-else class="px-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div
            v-for="pl in playlists"
            :key="pl.id"
            class="cursor-pointer am-tap"
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
            <div class="text-[12px] text-[var(--text-secondary)]">{{ pl.trackCount }} 首</div>
          </div>
        </div>
      </div>

      <!-- Empty state: History & Hot Keywords -->
      <div v-else class="px-5 space-y-6 pt-2">
        <section v-if="history.length">
          <div class="flex items-center justify-between mb-2.5">
            <h2 class="text-[17px] font-bold text-[var(--text-primary)]">最近搜索</h2>
            <button
              type="button"
              class="text-[13px] font-medium am-accent-text bg-transparent border-0 p-0 am-tap"
              @click="clearHistory"
            >
              清除
            </button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="h in history"
              :key="h"
              type="button"
              class="px-3.5 py-1.5 rounded-full bg-[var(--bg-subtle)] text-[14px] text-[var(--text-primary)] border-0 am-tap"
              @click="runSearch(h)"
            >
              {{ h }}
            </button>
          </div>
        </section>

        <section v-if="hotKeywords.length">
          <h2 class="text-[17px] font-bold text-[var(--text-primary)] mb-2.5">大家在听</h2>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="kw in hotKeywords"
              :key="kw"
              type="button"
              class="px-3.5 py-1.5 rounded-full bg-[var(--bg-subtle)] text-[14px] text-[var(--text-primary)] border-0 am-tap"
              @click="runSearch(kw)"
            >
              {{ kw }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-box {
  height: 40px;
  border-radius: 14px;
  background-color: var(--bg-subtle);
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
