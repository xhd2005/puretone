<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconRadio from '@iconify/icons-tabler/radio';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconMusic from '@iconify/icons-tabler/music';
import type { PlaylistSummary, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import AvatarButton from '@/components/AvatarButton.vue';

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();

const dailySongs = ref<Song[]>([]);
const playlists = ref<PlaylistSummary[]>([]);
const loading = ref(false);
const scrolled = ref(false);

function onScroll(e: Event) {
  scrolled.value = ((e.target as HTMLElement)?.scrollTop ?? 0) > 34;
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

    // Quietly sync "我喜欢" hashes for instant heart state
    const fav = pls.find((p) => p.isFavorite);
    if (fav?.globalCollectionId && fav.listId) {
      kugouApi
        .getPlaylistTracks(fav.globalCollectionId, 1, 200)
        .then((tracks) => player.syncFavoritesFromPlaylist(fav.listId!, tracks))
        .catch(() => {});
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
    <!-- Collapsing iOS Sticky Header -->
    <header
      class="sticky-bar"
      :class="{ 'is-scrolled am-glass am-hairline-b': scrolled }"
    >
      <div class="flex items-center justify-between h-11 px-5">
        <span
          class="text-[17px] font-bold tracking-tight transition-opacity duration-200"
          :class="scrolled ? 'opacity-100' : 'opacity-0'"
        >
          主页
        </span>
        <AvatarButton />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-44" @scroll.passive="onScroll">
      <!-- iOS Large Title -->
      <div class="px-5 pt-[calc(var(--safe-top)+44px)] pb-3 flex items-end justify-between">
        <h1 class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]">
          主页
        </h1>
      </div>

      <!-- Logged-out minimal Apple Music welcome card -->
      <div v-if="!accounts.isLoggedIn" class="px-5 mt-2">
        <div class="rounded-[20px] p-5 bg-[var(--bg-grouped)]">
          <div class="text-[20px] font-bold tracking-tight text-[var(--text-primary)]">
            纯净听歌，每日畅听
          </div>
          <p class="text-[14px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
            登录酷狗概念版账号即可同步歌单、每日推荐、私人电台，并在启动时自动领取畅听 VIP。
          </p>
          <button
            type="button"
            class="mt-4 px-5 h-10 rounded-full am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
            @click="ui.loginModalOpen = true"
          >
            立即登录
          </button>
        </div>
      </div>

      <!-- 1. Apple Music Editorial Personal FM Banner -->
      <section class="px-5 mt-3">
        <div
          class="fm-card am-tap"
          role="button"
          tabindex="0"
          @click="player.playPersonalFm()"
        >
          <div class="relative z-10 flex items-center justify-between gap-4">
            <div class="min-w-0">
              <div class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/80">
                <Icon :icon="iconRadio" class="w-3.5 h-3.5" />
                <span>私人电台</span>
              </div>
              <div class="text-[22px] font-bold text-white tracking-tight mt-1">
                为你专属调频
              </div>
              <p class="text-[13px] text-white/75 mt-0.5 truncate">
                根据你的红心与听歌口味持续推送
              </p>
            </div>
            <div class="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg shrink-0">
              <Icon :icon="iconPlayerPlayFilled" class="w-5 h-5 translate-x-[1px]" />
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
            <span>每日推荐</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
          <button
            v-if="dailySongs.length"
            type="button"
            class="text-[14px] font-semibold am-accent-text bg-transparent border-0 p-0 am-tap"
            @click="player.playQueue(dailySongs, 0)"
          >
            播放全部
          </button>
        </div>

        <div v-if="loading && !dailySongs.length" class="px-5 flex gap-3.5 overflow-hidden">
          <div v-for="i in 3" :key="i" class="w-[152px] shrink-0">
            <div class="w-[152px] h-[152px] rounded-[12px] bg-[var(--bg-subtle)] animate-pulse" />
            <div class="h-3.5 w-28 rounded bg-[var(--bg-subtle)] mt-2 animate-pulse" />
          </div>
        </div>

        <div v-else class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="(song, idx) in dailySongs.slice(0, 12)"
            :key="song.id"
            class="w-[152px] shrink-0 cursor-pointer am-tap"
            @click="player.playQueue(dailySongs, idx)"
          >
            <div class="w-[152px] h-[152px] rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
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

      <!-- 3. Recently Played -->
      <section v-if="player.recentPlays.length" class="mt-7">
        <div class="px-5 mb-3">
          <h2 class="text-[21px] font-bold tracking-tight text-[var(--text-primary)]">最近播放</h2>
        </div>

        <div class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="(song, idx) in player.recentPlays.slice(0, 14)"
            :key="`${song.id}-${idx}`"
            class="w-[132px] shrink-0 cursor-pointer am-tap"
            @click="player.playSong(song)"
          >
            <div class="w-[132px] h-[132px] rounded-[10px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
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

      <!-- 4. Your Playlists -->
      <section v-if="playlists.length" class="mt-7">
        <div class="px-5 flex items-center justify-between mb-3">
          <button
            type="button"
            class="flex items-center gap-1 bg-transparent border-0 p-0 text-[21px] font-bold tracking-tight text-[var(--text-primary)] am-tap"
            @click="router.push('/library')"
          >
            <span>你的歌单</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5 text-[var(--text-tertiary)]" />
          </button>
        </div>

        <div class="am-hscroll flex gap-3.5 px-5">
          <div
            v-for="pl in playlists.slice(0, 10)"
            :key="pl.id"
            class="w-[144px] shrink-0 cursor-pointer am-tap"
            @click="router.push({ path: `/playlist/${encodeURIComponent(pl.globalCollectionId || pl.id)}`, query: { name: pl.name, cover: pl.coverUrl, count: String(pl.trackCount), listId: pl.listId || '' } })"
          >
            <div class="w-[144px] h-[144px] rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
              <img v-if="pl.coverUrl" :src="pl.coverUrl" loading="lazy" class="w-full h-full object-cover" alt="" />
              <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
                <Icon :icon="iconMusic" class="w-9 h-9" />
              </div>
            </div>
            <div class="text-[14px] font-medium text-[var(--text-primary)] truncate mt-2">{{ pl.name }}</div>
            <div class="text-[12px] text-[var(--text-secondary)]">{{ pl.trackCount }} 首</div>
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
  transition: background-color 220ms ease;
}

.fm-card {
  position: relative;
  border-radius: 18px;
  padding: 20px 20px;
  overflow: hidden;
  background: linear-gradient(135deg, var(--accent) 0%, #6d28d9 58%, #1d1b38 100%);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16);
  cursor: pointer;
}
</style>
