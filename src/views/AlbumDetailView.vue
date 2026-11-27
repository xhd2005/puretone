<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconArrowsShuffle from '@iconify/icons-tabler/arrows-shuffle';
import iconDisc from '@iconify/icons-tabler/disc';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconPlaylistAdd from '@iconify/icons-tabler/playlist-add';
import type { AlbumDetail, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { navigateToArtistRef } from '@/services/playback/artistNavigation';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const ui = useUiStore();
const { t } = useI18n();

const albumId = computed(() => decodeURIComponent(String(route.params.id || '')));
const fallbackName = computed(() => String(route.query.name || ''));
const fallbackCover = computed(() => String(route.query.cover || ''));
const fallbackArtist = computed(() => String(route.query.artist || ''));
const fallbackArtistId = computed(() => String(route.query.artistId || ''));

const album = ref<AlbumDetail | null>(null);
const loading = ref(true);
const introExpanded = ref(false);
const scrollTop = ref(0);

const displayTitle = computed(() => album.value?.name || fallbackName.value || 'Album');
const displayCover = computed(() => album.value?.coverUrl || fallbackCover.value || '');
const displayArtist = computed(() => album.value?.artist || fallbackArtist.value || '');
const displayArtistId = computed(() => album.value?.artistId || fallbackArtistId.value || '');
const songs = computed(() => album.value?.songs || []);

const compactTitleOpacity = computed(() => Number(Math.max(0, Math.min(1, (scrollTop.value - 200) / 40)).toFixed(3)));
const headerGlassActive = computed(() => scrollTop.value > 180);

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement)?.scrollTop ?? 0;
}

async function loadAlbum() {
  loading.value = true;
  introExpanded.value = false;
  try {
    album.value = await kugouApi.getAlbumDetail(albumId.value);
  } catch {
    album.value = null;
  } finally {
    loading.value = false;
  }
}

function playAll() {
  if (!songs.value.length) return;
  echoSystem.haptic('medium');
  void player.playQueue(songs.value, 0);
}

function shufflePlay() {
  if (!songs.value.length) return;
  echoSystem.haptic('medium');
  const idx = Math.floor(Math.random() * songs.value.length);
  void player.playQueue(songs.value, idx, 'shuffle');
}

function playSong(song: Song) {
  const idx = songs.value.findIndex((s) => s.id === song.id && s.hash === song.hash);
  void player.playQueue(songs.value, idx >= 0 ? idx : 0);
}

async function openArtist() {
  if (!displayArtist.value) return;
  echoSystem.haptic('light');
  await navigateToArtistRef(
    { id: displayArtistId.value, name: displayArtist.value },
    router,
    ui,
    { resolving: t('artist.resolving'), notFound: t('artist.notFound') },
  );
}

onMounted(() => void loadAlbum());
watch(albumId, () => void loadAlbum());
</script>

<template>
  <div class="h-full flex flex-col relative bg-[var(--bg-canvas)]">
    <header class="sticky-bar" :class="{ 'sticky-glass': headerGlassActive }">
      <div class="h-11 px-3 flex items-center justify-between gap-2">
        <button
          type="button"
          class="flex items-center gap-0.5 text-[15.5px] font-medium am-accent-text bg-transparent border-0 p-1 am-tap shrink-0"
          @click="router.back()"
        >
          <Icon :icon="iconChevronLeft" class="w-6 h-6" />
          <span>{{ t('common.back') }}</span>
        </button>
        <span
          class="text-[16px] font-bold truncate flex-1 text-center text-[var(--text-primary)] pointer-events-none"
          :style="{ opacity: compactTitleOpacity }"
        >
          {{ displayTitle }}
        </span>
        <div class="w-14 flex items-center justify-end shrink-0">
          <button
            v-if="songs.length"
            type="button"
            class="w-9 h-9 rounded-full bg-transparent border-0 flex items-center justify-center am-accent-text am-tap"
            :aria-label="t('song.addToPlaylist')"
            @click="ui.openAddToPlaylist(songs)"
          >
            <Icon :icon="iconPlaylistAdd" class="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>

    <div class="flex-1 am-scroll pb-48 relative" @scroll.passive="onScroll">
      <!-- Centered Apple Music Album Hero -->
      <section class="px-5 pt-[calc(var(--safe-top)+56px)] pb-5 flex flex-col items-center text-center space-y-3">
        <div class="w-[200px] h-[200px] rounded-[20px] overflow-hidden bg-[var(--bg-subtle)] shadow-2xl flex items-center justify-center">
          <img v-if="displayCover" :src="displayCover" :alt="displayTitle" class="w-full h-full object-cover" />
          <Icon v-else :icon="iconDisc" class="w-14 h-14 text-[var(--text-tertiary)]" />
        </div>

        <div class="space-y-1 max-w-full px-2">
          <span class="inline-block px-2 py-0.5 rounded-md bg-[var(--bg-subtle)] text-[10px] font-extrabold am-accent-text tracking-wider">
            {{ t('album.badge') }}
          </span>
          <h1 class="text-[22px] font-bold tracking-tight text-[var(--text-primary)] leading-snug m-0">
            {{ displayTitle }}
          </h1>
          <button
            v-if="displayArtist"
            type="button"
            class="inline-flex items-center gap-0.5 bg-transparent border-0 p-0 text-[15px] font-semibold am-accent-text am-tap"
            @click="openArtist"
          >
            <span>{{ displayArtist }}</span>
            <Icon :icon="iconChevronRight" class="w-4 h-4 opacity-70" />
          </button>
          <div class="text-[12px] text-[var(--text-secondary)] tabular-nums">
            <template v-if="album?.publishDate">{{ album.publishDate }}</template>
            <template v-if="album?.language"> · {{ album.language }}</template>
            <template v-if="songs.length"> · {{ t('common.songsCount', { count: songs.length }) }}</template>
          </div>
        </div>

        <!-- Play / Shuffle Buttons -->
        <div class="w-full max-w-sm grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            class="h-11 rounded-[14px] am-accent-bg text-white text-[14.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 shadow-xs am-tap"
            :disabled="!songs.length"
            @click="playAll"
          >
            <Icon :icon="iconPlayerPlayFilled" class="w-4.5 h-4.5" />
            <span>{{ t('common.play') }}</span>
          </button>
          <button
            type="button"
            class="h-11 rounded-[14px] bg-[var(--bg-subtle)] am-accent-text text-[14.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap"
            :disabled="!songs.length"
            @click="shufflePlay"
          >
            <Icon :icon="iconArrowsShuffle" class="w-4.5 h-4.5" />
            <span>{{ t('common.shuffle') }}</span>
          </button>
        </div>

        <!-- Expandable Album Intro -->
        <div
          v-if="album?.intro"
          class="w-full text-left rounded-[18px] bg-[var(--bg-card)] px-4 py-3 shadow-xs space-y-1 cursor-pointer"
          @click="introExpanded = !introExpanded"
        >
          <div class="text-[12px] font-bold text-[var(--text-primary)]">{{ t('album.introTitle') }}</div>
          <p
            class="text-[12.5px] leading-relaxed text-[var(--text-secondary)] m-0"
            :class="{ 'line-clamp-2': !introExpanded }"
          >
            {{ album.intro }}
          </p>
          <div class="text-right text-[11.5px] font-semibold am-accent-text">
            {{ introExpanded ? t('album.collapseIntro') : t('album.expandIntro') }}
          </div>
        </div>
      </section>

      <!-- Tracklist -->
      <section>
        <div v-if="loading" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="!songs.length" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('album.empty') }}
        </div>
        <div v-else>
          <SongRow
            v-for="(song, idx) in songs"
            :key="`${song.hash || song.id}-${idx}`"
            :song="song"
            :index="idx"
            show-index
            @play="playSong(song)"
          />
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
  z-index: 25;
  padding-top: var(--safe-top);
  transition: background-color 180ms ease;
}
</style>
