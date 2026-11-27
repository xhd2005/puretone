<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconRadio from '@iconify/icons-tabler/radio';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconMusic from '@iconify/icons-tabler/music';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import type { PlaylistSummary, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  backfillMissingPlaylistCovers,
  getPlaylistCacheKey,
} from '@/services/playback/playlistCoverResolver';
import { readPlaylistSnapshot } from '@/services/playback/playlistSnapshotCache';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useCollapsingTitle } from '@/composables/useCollapsingTitle';
import AvatarButton from '@/components/AvatarButton.vue';
import PlaylistCover from '@/components/PlaylistCover.vue';
import PureToneMark from '@/components/PureToneMark.vue';

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();
const { largeTitleOpacity, compactTitleOpacity, headerGlassActive, onScroll } = useCollapsingTitle();

const dailySongs = ref<Song[]>([]);
const playlists = ref<PlaylistSummary[]>([]);
const loading = ref(false);

const todayLabel = `${new Date().getMonth() + 1}月${new Date().getDate()}日`;

const dailyHeroCover = computed(() => dailySongs.value[0]?.coverUrl || '');
const fmHeroCover = computed(
  () => dailySongs.value[1]?.coverUrl || player.recentPlays[0]?.coverUrl || dailySongs.value[2]?.coverUrl || '',
);

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

async function loadHomeData() {
  if (!accounts.isLoggedIn) {
    dailySongs.value = [];
    playlists.value = [];
    return;
  }
  loading.value = true;
  try {
    const [daily, pls] = await Promise.all([
      kugouApi.getEverydayRecommend().catch(() => []),
      kugouApi.getUserPlaylists().catch(() => []),
    ]);
    dailySongs.value = daily;
    playlists.value = pls;

    void backfillMissingPlaylistCovers(pls);

    const fav = pls.find((p) => p.isFavorite);
    if (fav && fav.listId) {
      const favKey = getPlaylistCacheKey(fav);
      const snap = await readPlaylistSnapshot(favKey);
      if (snap?.songs.length) {
        void player.syncFavoritesFromPlaylist(fav.listId, snap.songs, fav.globalCollectionId);
      } else {
        kugouApi
          .getPlaylistTracksPaged({
            globalCollectionId: fav.globalCollectionId,
            listId: fav.listId,
            page: 1,
            pagesize: 300,
          })
          .then((res) => player.syncFavoritesFromPlaylist(fav.listId!, res.songs, fav.globalCollectionId))
          .catch(() => {});
      }
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadHomeData());
watch(() => accounts.activeAccount?.userid, () => void loadHomeData());
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
          {{ t('home.title') }}
        </span>
        <AvatarButton />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-48" @scroll.passive="onScroll">
      <!-- iOS Large Title (fades out cleanly before compact header appears!) -->
      <div class="px-5 pt-[calc(var(--safe-top)+48px)] pb-3 flex items-end justify-between">
        <h1
          class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]"
          :style="{ opacity: largeTitleOpacity }"
        >
          {{ t('home.title') }}
        </h1>
      </div>

      <!-- Logged-out welcome card -->
      <div v-if="!accounts.isLoggedIn" class="px-5 mt-2">
        <div class="rounded-[22px] p-5 bg-[var(--bg-grouped)]">
          <div class="flex items-center gap-3 mb-2.5">
            <PureToneMark :size="40" />
            <div>
              <div class="text-[19px] font-bold tracking-tight text-[var(--text-primary)]">
                {{ t('app.fullName') }}
              </div>
              <div class="text-[12px] text-[var(--text-secondary)]">{{ t('home.loginCardTitle') }}</div>
            </div>
          </div>
          <p class="text-[14px] text-[var(--text-secondary)] leading-relaxed">
            {{ t('home.loginCardDesc') }}
          </p>
          <button
            type="button"
            class="mt-4 px-5 h-10 rounded-full am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
            @click="ui.loginModalOpen = true"
          >
            {{ t('home.loginNow') }}
          </button>
        </div>
      </div>

      <!-- 1. Apple Music 2-Column Editorial Poster Duo -->
      <section class="px-5 mt-3">
        <div class="grid grid-cols-2 gap-3.5">
          <!-- Poster A: Daily Mix -->
          <div
            class="editorial-poster poster-daily am-tap"
            role="button"
            tabindex="0"
            @click="router.push('/daily')"
          >
            <img v-if="dailyHeroCover" :src="dailyHeroCover" alt="" class="poster-bg-img" />
            <div class="poster-scrim scrim-daily" />
            <div class="poster-body">
              <div class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/85">
                <Icon :icon="iconSparkles" class="w-3 h-3" />
                <span>{{ todayLabel }}</span>
              </div>
              <div class="mt-auto">
                <div class="text-[19px] font-bold text-white tracking-tight leading-tight">{{ t('home.dailyCurated') }}</div>
                <div class="flex items-center justify-between gap-2 mt-1.5">
                  <span class="text-[12px] text-white/75 truncate">
                    {{ dailySongs.length ? t('common.songsCount', { count: dailySongs.length }) : t('home.dailySubtitle') }}
                  </span>
                  <button
                    type="button"
                    class="poster-play-btn lg-fluid-btn am-tap shrink-0"
                    :aria-label="t('common.play')"
                    @click.stop="dailySongs.length ? player.playQueue(dailySongs, 0) : router.push('/daily')"
                  >
                    <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4 translate-x-[1px] text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Poster B: Personal FM Station -->
          <div
            class="editorial-poster poster-fm am-tap"
            role="button"
            tabindex="0"
            @click="player.playPersonalFm()"
          >
            <img v-if="fmHeroCover" :src="fmHeroCover" alt="" class="poster-bg-img" />
            <div class="poster-scrim scrim-fm" />
            <div class="poster-body">
              <div class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/85">
                <Icon :icon="iconRadio" class="w-3 h-3" />
                <span>{{ t('home.fmLabel') }}</span>
              </div>
              <div class="mt-auto">
                <div class="text-[19px] font-bold text-white tracking-tight leading-tight">{{ t('home.fmTitle') }}</div>
                <div class="flex items-center justify-between gap-2 mt-1.5">
                  <span class="text-[12px] text-white/75 truncate">{{ t('home.fmSubtitle') }}</span>
                  <div class="poster-play-btn lg-fluid-btn shrink-0">
                    <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4 translate-x-[1px] text-white" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. Daily Picks Horizontal Carousel -->
      <section v-if="dailySongs.length || loading" class="mt-7">
        <div class="px-5 flex items-center justify-between mb-3">
          <button
            type="button"
            class="flex items-center gap-1 bg-transparent border-0 p-0 text-[21px] font-bold tracking-tight text-[var(--text-primary)] am-tap"
            @click="router.push('/daily')"
          >
            <span>{{ t('home.dailyTitle') }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
          <button
            v-if="dailySongs.length"
            type="button"
            class="text-[14px] font-semibold am-accent-text bg-transparent border-0 p-0 am-tap"
            @click="player.playQueue(dailySongs, 0)"
          >
            {{ t('common.playAll') }}
          </button>
        </div>

        <div v-if="loading && !dailySongs.length" class="px-5 flex gap-3.5 overflow-hidden">
          <div v-for="i in 3" :key="i" class="w-[148px] shrink-0">
            <div class="w-[148px] h-[148px] rounded-[14px] bg-[var(--bg-subtle)] animate-pulse" />
            <div class="h-3.5 w-28 rounded bg-[var(--bg-subtle)] mt-2 animate-pulse" />
          </div>
        </div>

        <div v-else class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="(song, idx) in dailySongs.slice(0, 12)"
            :key="song.id"
            class="w-[148px] shrink-0 cursor-pointer am-tap"
            @click="player.playQueue(dailySongs, idx)"
          >
            <div class="w-[148px] h-[148px] rounded-[14px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
              <img
                v-if="song.coverUrl"
                :src="song.coverUrl"
                :alt="song.title"
                loading="lazy"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
                <Icon :icon="iconMusic" class="w-9 h-9" />
              </div>
            </div>
            <div class="text-[14px] font-medium text-[var(--text-primary)] truncate mt-2 leading-snug">
              {{ song.title }}
            </div>
            <div class="text-[13px] text-[var(--text-secondary)] truncate leading-snug">
              {{ song.artist }}
            </div>
          </div>
        </div>
      </section>

      <!-- 3. Recently Played (Title navigates to /recent full list!) -->
      <section v-if="player.recentPlays.length" class="mt-7">
        <div class="px-5 flex items-center justify-between mb-3">
          <button
            type="button"
            class="flex items-center gap-1 bg-transparent border-0 p-0 text-[21px] font-bold tracking-tight text-[var(--text-primary)] am-tap"
            @click="router.push('/recent')"
          >
            <span>{{ t('home.recentPlays') }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
        </div>

        <div class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="(song, idx) in player.recentPlays.slice(0, 14)"
            :key="`${song.id}-${idx}`"
            class="w-[130px] shrink-0 cursor-pointer am-tap"
            @click="player.playSong(song)"
          >
            <div class="w-[130px] h-[130px] rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
              <img v-if="song.coverUrl" :src="song.coverUrl" loading="lazy" class="w-full h-full object-cover" alt="" />
              <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
                <Icon :icon="iconMusic" class="w-8 h-8" />
              </div>
            </div>
            <div class="text-[14px] font-medium text-[var(--text-primary)] truncate mt-1.5">{{ song.title }}</div>
            <div class="text-[12px] text-[var(--text-secondary)] truncate">{{ song.artist }}</div>
          </div>
        </div>
      </section>

      <!-- 4. Your Playlists (with 2x2 Apple Music Collage Cover Backfill!) -->
      <section v-if="playlists.length" class="mt-7">
        <div class="px-5 flex items-center justify-between mb-3">
          <button
            type="button"
            class="flex items-center gap-1 bg-transparent border-0 p-0 text-[21px] font-bold tracking-tight text-[var(--text-primary)] am-tap"
            @click="router.push('/library')"
          >
            <span>{{ t('home.yourPlaylists') }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
        </div>

        <div class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="pl in playlists.slice(0, 12)"
            :key="pl.id"
            class="w-[144px] shrink-0 cursor-pointer am-tap"
            @click="openPlaylist(pl)"
          >
            <div class="w-[144px] h-[144px] rounded-[14px] overflow-hidden shadow-sm">
              <PlaylistCover
                :playlist-key="getPlaylistCacheKey(pl)"
                :cover-url="pl.coverUrl"
                :alt="pl.name"
              />
            </div>
            <div class="text-[14px] font-medium text-[var(--text-primary)] truncate mt-2">{{ pl.name }}</div>
            <div class="text-[12px] text-[var(--text-secondary)]">{{ t('common.songsCount', { count: pl.trackCount }) }}</div>
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

.editorial-poster {
  position: relative;
  aspect-ratio: 1 / 1.06;
  border-radius: 22px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.dark .editorial-poster {
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

.poster-daily {
  background: linear-gradient(150deg, #ff4b6a 0%, #c81d48 58%, #3a0f24 100%);
}

.poster-fm {
  background: linear-gradient(150deg, #27375c 0%, #172038 56%, #0c101c 100%);
}

.poster-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.08);
  filter: blur(1px) saturate(1.18);
}

.poster-scrim {
  position: absolute;
  inset: 0;
}

.scrim-daily {
  background: linear-gradient(
    180deg,
    rgba(250, 35, 59, 0.30) 0%,
    rgba(16, 12, 20, 0.25) 45%,
    rgba(14, 10, 18, 0.84) 100%
  );
}

.scrim-fm {
  background: linear-gradient(
    180deg,
    rgba(30, 58, 110, 0.34) 0%,
    rgba(12, 16, 28, 0.30) 45%,
    rgba(10, 13, 22, 0.86) 100%
  );
}

.poster-body {
  position: relative;
  z-index: 1;
  height: 100%;
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.poster-play-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
