<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconMusic from '@iconify/icons-tabler/music';
import type { Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { usePlayerStore } from '@/stores/player';
import SongRow from '@/components/SongRow.vue';

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();

const id = computed(() => decodeURIComponent(String(route.params.id || '')));
const name = computed(() => String(route.query.name || '歌单'));
const cover = computed(() => String(route.query.cover || ''));
const listId = computed(() => String(route.query.listId || ''));
const isFavorite = computed(() => route.query.favorite === '1');

const songs = ref<Song[]>([]);
const loading = ref(true);
const scrolled = ref(false);

function onScroll(e: Event) {
  scrolled.value = ((e.target as HTMLElement)?.scrollTop ?? 0) > 220;
}

onMounted(async () => {
  try {
    songs.value = await kugouApi.getPlaylistTracks(id.value, 1, 200);
    if (isFavorite.value && listId.value) {
      void player.syncFavoritesFromPlaylist(listId.value, songs.value);
    }
  } finally {
    loading.value = false;
  }
});

function shufflePlay() {
  if (!songs.value.length) return;
  const idx = Math.floor(Math.random() * songs.value.length);
  void player.playQueue(songs.value, idx, 'shuffle');
}
</script>

<template>
  <div class="h-full flex flex-col relative">
    <header class="sticky-bar" :class="{ 'am-glass am-hairline-b': scrolled }">
      <div class="h-11 px-3 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[16px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap"
          @click="router.back()"
        >
          <Icon :icon="iconChevronLeft" class="w-6 h-6" />
          <span>资料库</span>
        </button>
        <span
          class="text-[16px] font-semibold truncate max-w-[55%] transition-opacity duration-200 text-[var(--text-primary)]"
          :class="scrolled ? 'opacity-100' : 'opacity-0'"
        >
          {{ name }}
        </span>
        <span class="w-12" />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-44" @scroll.passive="onScroll">
      <!-- Apple Music Centered Album/Playlist Hero -->
      <div class="px-6 pt-[calc(var(--safe-top)+56px)] pb-5 text-center">
        <div class="w-[216px] h-[216px] mx-auto rounded-[14px] overflow-hidden bg-[var(--bg-subtle)] shadow-2xl">
          <img
            v-if="cover || songs[0]?.coverUrl"
            :src="cover || songs[0]?.coverUrl"
            :alt="name"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-tertiary)]">
            <Icon :icon="iconMusic" class="w-14 h-14" />
          </div>
        </div>

        <h1 class="text-[22px] font-bold tracking-tight mt-4 text-[var(--text-primary)] leading-snug">
          {{ name }}
        </h1>
        <p class="text-[13px] text-[var(--text-secondary)] mt-1">
          共 {{ songs.length || Number(route.query.count || 0) }} 首歌曲
        </p>

        <div class="grid grid-cols-2 gap-3 mt-5 max-w-sm mx-auto">
          <button
            type="button"
            class="h-11 rounded-[12px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            :disabled="!songs.length"
            @click="player.playQueue(songs, 0)"
          >
            <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4" />
            <span>播放</span>
          </button>
          <button
            type="button"
            class="h-11 rounded-[12px] bg-[var(--bg-subtle)] am-accent-text text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            :disabled="!songs.length"
            @click="shufflePlay"
          >
            <Icon :icon="iconArrowsShuffle" class="w-4 h-4" />
            <span>随机播放</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">正在加载歌曲列表…</div>
      <div v-else-if="!songs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">歌单暂时为空</div>
      <div v-else>
        <SongRow
          v-for="(song, idx) in songs"
          :key="`${song.id}-${idx}`"
          :song="song"
          @play="player.playQueue(songs, idx)"
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
