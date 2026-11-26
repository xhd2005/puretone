<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconClock from '@iconify/icons-tabler/clock';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconMusic from '@iconify/icons-tabler/music';
import type { PlaylistSummary } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import AvatarButton from '@/components/AvatarButton.vue';

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();

const playlists = ref<PlaylistSummary[]>([]);
const loading = ref(false);
const scrolled = ref(false);

const favoritePlaylist = computed(() => playlists.value.find((p) => p.isFavorite) || null);
const otherPlaylists = computed(() => playlists.value.filter((p) => !p.isFavorite));

function onScroll(e: Event) {
  scrolled.value = ((e.target as HTMLElement)?.scrollTop ?? 0) > 34;
}

async function fetchPlaylists() {
  if (!accounts.isLoggedIn) {
    playlists.value = [];
    return;
  }
  loading.value = true;
  try {
    playlists.value = await kugouApi.getUserPlaylists();
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
    <header class="sticky-bar" :class="{ 'is-scrolled am-glass am-hairline-b': scrolled }">
      <div class="flex items-center justify-between h-11 px-5">
        <span
          class="text-[17px] font-bold tracking-tight transition-opacity duration-200"
          :class="scrolled ? 'opacity-100' : 'opacity-0'"
        >
          资料库
        </span>
        <AvatarButton />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-44" @scroll.passive="onScroll">
      <div class="px-5 pt-[calc(var(--safe-top)+44px)] pb-3">
        <h1 class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]">
          资料库
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
            <span class="text-[18px] font-normal text-[var(--text-primary)]">我喜欢的音乐</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ favoritePlaylist.trackCount }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>

        <button
          type="button"
          class="lib-cat-row am-tap"
          @click="player.recentPlays.length && player.playQueue(player.recentPlays, 0)"
        >
          <div class="flex items-center gap-3.5">
            <Icon :icon="iconClock" class="w-6 h-6 am-accent-text" />
            <span class="text-[18px] font-normal text-[var(--text-primary)]">最近播放</span>
          </div>
          <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
            <span class="text-[14px] tabular-nums">{{ player.recentPlays.length }}</span>
            <Icon :icon="iconChevronRight" class="w-5 h-5" />
          </div>
        </button>
      </div>

      <!-- Logged-out state -->
      <div v-if="!accounts.isLoggedIn" class="px-5 py-12 text-center">
        <p class="text-[15px] text-[var(--text-secondary)]">登录酷狗账号以同步你的歌单和红心歌曲</p>
        <button
          type="button"
          class="mt-4 px-6 h-10 rounded-full am-accent-bg text-white text-[15px] font-semibold border-0 am-tap"
          @click="ui.loginModalOpen = true"
        >
          登录账号
        </button>
      </div>

      <!-- Playlists 2-Column Apple Music Grid -->
      <section v-else class="px-5 mt-6">
        <h2 class="text-[21px] font-bold tracking-tight text-[var(--text-primary)] mb-3.5">歌单</h2>

        <div v-if="loading && !playlists.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <div v-for="i in 4" :key="i">
            <div class="aspect-square rounded-[12px] bg-[var(--bg-subtle)] animate-pulse" />
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
            <div class="aspect-square rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shadow-sm">
              <img v-if="pl.coverUrl" :src="pl.coverUrl" loading="lazy" class="w-full h-full object-cover" alt="" />
              <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
                <Icon :icon="iconMusic" class="w-10 h-10" />
              </div>
            </div>
            <div class="text-[15px] font-medium text-[var(--text-primary)] truncate mt-2 leading-snug">
              {{ pl.name }}
            </div>
            <div class="text-[13px] text-[var(--text-secondary)] truncate">
              {{ pl.trackCount }} 首歌曲
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
