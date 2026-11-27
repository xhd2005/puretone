<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconClock from '@iconify/icons-tabler/clock';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import type { PlaylistSummary } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  backfillMissingPlaylistCovers,
  getPlaylistCacheKey,
} from '@/services/playback/playlistCoverResolver';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useCollapsingTitle } from '@/composables/useCollapsingTitle';
import AvatarButton from '@/components/AvatarButton.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();
const { largeTitleOpacity, compactTitleOpacity, headerGlassActive, onScroll } = useCollapsingTitle();

const playlists = ref<PlaylistSummary[]>([]);
const loading = ref(false);

const favoritePlaylist = computed(() => playlists.value.find((p) => p.isFavorite) || null);
const otherPlaylists = computed(() => playlists.value.filter((p) => !p.isFavorite));

async function fetchPlaylists() {
  if (!accounts.isLoggedIn) {
    playlists.value = [];
    return;
  }
  loading.value = true;
  try {
    playlists.value = await kugouApi.getUserPlaylists();
    void backfillMissingPlaylistCovers(playlists.value);
  } finally {
    loading.value = false;
  }
}

function openPlaylist(pl: PlaylistSummary) {
  void router.push({
    path: `/playlist/${encodeURIComponent(pl.globalCollectionId || pl.id)}`,
    query: {
      name: pl.name,
      cover: pl.coverUrl,
      count: String(pl.trackCount),
      listId: pl.listId || '',
      favorite: pl.isFavorite ? '1' : '0',
    },
  });
}

onMounted(() => void fetchPlaylists());
watch(() => accounts.activeAccount?.userid, () => void fetchPlaylists());
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
          {{ t('library.title') }}
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
          {{ t('library.title') }}
        </h1>
      </div>

      <!-- Apple Music Category List -->
      <div class="px-5 mt-1 divide-y divide-[var(--hairline)] am-hairline-t am-hairline-b">
        <button
          v-if="favoritePlaylist"
          type="button"
          class="lib-cat-row am-tap"
          @click="openPlaylist(favoritePlaylist)"
        >
          <div class="flex items-center gap-3.5">
            <Icon :icon="iconHeartFilled" class="w-6 h-6 am-accent-text" />
            <span class="text-[18px] font-normal text-[var(--text-primary)]">{{ t('library.favorites') }}</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ favoritePlaylist.trackCount }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>

        <!-- Navigates to /recent full list instead of auto-playing! -->
        <button
          type="button"
          class="lib-cat-row am-tap"
          @click="router.push('/recent')"
        >
          <div class="flex items-center gap-3.5">
            <Icon :icon="iconClock" class="w-6 h-6 am-accent-text" />
            <span class="text-[18px] font-normal text-[var(--text-primary)]">{{ t('library.recent') }}</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ player.recentPlays.length }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>
      </div>

      <div v-if="!accounts.isLoggedIn" class="px-5 py-12 text-center">
        <p class="text-[15px] text-[var(--text-secondary)]">{{ t('library.loginPrompt') }}</p>
        <button
          type="button"
          class="mt-4 px-6 h-10 rounded-full am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
          @click="ui.loginModalOpen = true"
        >
          {{ t('home.loginNow') }}
        </button>
      </div>

      <!-- Playlists 2-Column Apple Music Grid with 2x2 Cover Collage -->
      <section v-else class="px-5 mt-6">
        <h2 class="text-[21px] font-bold tracking-tight text-[var(--text-primary)] mb-3.5">{{ t('library.playlists') }}</h2>

        <div v-if="loading && !playlists.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <div v-for="i in 4" :key="i">
            <div class="aspect-square rounded-[14px] bg-[var(--bg-subtle)] animate-pulse" />
            <div class="h-3.5 w-24 rounded bg-[var(--bg-subtle)] mt-2 animate-pulse" />
          </div>
        </div>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-5">
          <div
            v-for="pl in otherPlaylists"
            :key="pl.id"
            class="cursor-pointer am-tap"
            @click="openPlaylist(pl)"
          >
            <div class="aspect-square rounded-[14px] overflow-hidden shadow-sm">
              <PlaylistCover
                :playlist-key="getPlaylistCacheKey(pl)"
                :cover-url="pl.coverUrl"
                :alt="pl.name"
              />
            </div>
            <div class="text-[15px] font-medium text-[var(--text-primary)] truncate mt-2 leading-snug">
              {{ pl.name }}
            </div>
            <div class="text-[13px] text-[var(--text-secondary)] truncate">
              {{ t('common.songsCount', { count: pl.trackCount }) }}
            </div>
          </div>
        </div>
      </section>
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
  transition: background-color 200ms ease;
}

.lib-cat-row {
  width: 100%;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
}
</style>
