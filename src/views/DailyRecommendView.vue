<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import type { Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { usePlayerStore } from '@/stores/player';
import SongRow from '@/components/SongRow.vue';

const router = useRouter();
const player = usePlayerStore();
const songs = ref<Song[]>([]);
const loading = ref(true);

const todayLabel = `${new Date().getMonth() + 1}月${new Date().getDate()}日`;

onMounted(async () => {
  try {
    songs.value = await kugouApi.getEverydayRecommend();
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
    <header class="am-glass am-hairline-b sticky top-0 z-20 pt-[var(--safe-top)]">
      <div class="h-11 px-3 flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[16px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap"
          @click="router.back()"
        >
          <Icon :icon="iconChevronLeft" class="w-6 h-6" />
          <span>主页</span>
        </button>
        <span class="text-[16px] font-semibold text-[var(--text-primary)]">每日推荐</span>
        <span class="w-12" />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-44">
      <div class="px-5 pt-6 pb-5 text-center">
        <div class="w-44 h-44 mx-auto rounded-[18px] am-accent-bg shadow-xl flex flex-col items-center justify-center text-white">
          <span class="text-[13px] font-semibold uppercase tracking-widest opacity-85">Daily Mix</span>
          <span class="text-[36px] font-bold tracking-tight mt-1">{{ todayLabel }}</span>
        </div>
        <h1 class="text-[24px] font-bold tracking-tight mt-4 text-[var(--text-primary)]">每日精选推荐</h1>
        <p class="text-[13px] text-[var(--text-secondary)] mt-1">每天根据你的品味刷新 · 共 {{ songs.length }} 首</p>

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

      <div v-if="loading" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">正在加载每日推荐…</div>
      <div v-else>
        <SongRow
          v-for="(song, idx) in songs"
          :key="song.id"
          :song="song"
          @play="player.playQueue(songs, idx)"
        />
      </div>
    </div>
  </div>
</template>
