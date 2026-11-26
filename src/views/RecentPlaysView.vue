<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import iconTrash from '@iconify/icons-tabler/trash';
import iconClock from '@iconify/icons-tabler/clock';
import type { Song } from '@/types/music';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useCollapsingTitle } from '@/composables/useCollapsingTitle';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';

const router = useRouter();
const player = usePlayerStore();
const ui = useUiStore();
const { largeTitleOpacity, compactTitleOpacity, headerGlassActive, onScroll } = useCollapsingTitle();

const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

const filteredSongs = computed<Song[]>(() => {
  const kw = searchQuery.value.trim().toLowerCase();
  if (!kw) return player.recentPlays;
  return player.recentPlays.filter(
    (s) =>
      s.title.toLowerCase().includes(kw) ||
      s.artist.toLowerCase().includes(kw) ||
      s.album.toLowerCase().includes(kw),
  );
});

function toggleSearch() {
  echoSystem.haptic('selection');
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    void nextTick(() => searchInputRef.value?.focus());
  } else {
    searchQuery.value = '';
  }
}

function playTrack(song: Song) {
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

function handleClearAll() {
  if (!player.recentPlays.length) return;
  echoSystem.haptic('medium');
  player.clearRecentPlays();
  ui.showToast('已清空最近播放记录');
}
</script>

<template>
  <div class="h-full flex flex-col relative">
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive || searchOpen }">
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
          class="text-[16px] font-semibold truncate flex-1 text-center text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: searchOpen ? 1 : compactTitleOpacity }"
        >
          最近播放
        </span>

        <div class="flex items-center gap-0.5 shrink-0">
          <button
            v-if="player.recentPlays.length"
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap"
            aria-label="清空记录"
            @click="handleClearAll"
          >
            <Icon :icon="iconTrash" class="w-4.5 h-4.5" />
          </button>
          <button
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            aria-label="搜索最近播放"
            @click="toggleSearch"
          >
            <Icon :icon="searchOpen ? iconX : iconSearch" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <div v-if="searchOpen" class="px-4 pb-2.5">
        <div class="h-9 rounded-xl bg-[var(--bg-subtle)] px-3 flex items-center gap-2">
          <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            placeholder="搜索最近听过的歌曲或歌手…"
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
      <div class="px-5 pt-[calc(var(--safe-top)+52px)] pb-4">
        <h1
          class="text-[34px] font-bold tracking-[-0.025em] leading-none text-[var(--text-primary)]"
          :style="{ opacity: largeTitleOpacity }"
        >
          最近播放
        </h1>
        <p class="text-[13px] text-[var(--text-secondary)] mt-2 tabular-nums">
          共 {{ player.recentPlays.length }} 首近期聆听记录
        </p>

        <div v-if="filteredSongs.length" class="grid grid-cols-2 gap-3 mt-4 max-w-sm">
          <button
            type="button"
            class="h-11 rounded-[13px] am-accent-bg text-white text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap shadow-sm"
            @click="player.playQueue(filteredSongs, 0)"
          >
            <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4" />
            <span>播放全部</span>
          </button>
          <button
            type="button"
            class="h-11 rounded-[13px] bg-[var(--bg-subtle)] am-accent-text text-[15px] font-semibold border-0 flex items-center justify-center gap-1.5 am-tap"
            @click="shufflePlay"
          >
            <Icon :icon="iconArrowsShuffle" class="w-4 h-4" />
            <span>随机播放</span>
          </button>
        </div>
      </div>

      <div v-if="!player.recentPlays.length" class="py-20 text-center px-6">
        <div class="w-14 h-14 rounded-2xl bg-[var(--bg-subtle)] mx-auto flex items-center justify-center text-[var(--text-tertiary)] mb-3">
          <Icon :icon="iconClock" class="w-7 h-7" />
        </div>
        <div class="text-[16px] font-semibold text-[var(--text-primary)]">暂无播放记录</div>
        <p class="text-[13px] text-[var(--text-secondary)] mt-1">播放任意歌曲后，这里会自动为你留存聆听足迹</p>
      </div>

      <div v-else-if="searchQuery.trim() && !filteredSongs.length" class="py-12 text-center text-[14px] text-[var(--text-secondary)]">
        未找到“{{ searchQuery }}”
      </div>

      <div v-else>
        <SongRow
          v-for="song in filteredSongs"
          :key="song.hash || song.id"
          :song="song"
          @play="playTrack(song)"
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
  transition: background-color 200ms ease;
}
</style>
