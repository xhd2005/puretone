<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconChevronLeft from '@iconify/icons-tabler/chevron-left';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconCopy from '@iconify/icons-tabler/copy';
import iconSearch from '@iconify/icons-tabler/search';
import iconX from '@iconify/icons-tabler/x';
import iconUser from '@iconify/icons-tabler/user';
import iconDisc from '@iconify/icons-tabler/disc';
import iconCake from '@iconify/icons-tabler/cake';
import type { AlbumSummary, ArtistDetail, Song } from '@/types/music';
import { formatCompactCount, kugouApi } from '@/services/kugou/kugouEngine';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { echoSystem } from '@/native/echoSystem';
import SongRow from '@/components/SongRow.vue';

const route = useRoute();
const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t, effectiveLocale } = useI18n();

const artistId = computed(() => decodeURIComponent(String(route.params.id || '')));
const fallbackName = computed(() => String(route.query.name || ''));
const fallbackAvatar = computed(() => String(route.query.avatar || ''));

const detail = ref<ArtistDetail | null>(null);
const loadingMeta = ref(true);
const activeTab = ref<'songs' | 'albums'>('songs');

const songSort = ref<'hot' | 'new'>('hot');
const songs = ref<Song[]>([]);
const songsPage = ref(1);
const songsHasMore = ref(false);
const loadingSongs = ref(false);
const filterQuery = ref('');

const albums = ref<AlbumSummary[]>([]);
const albumsPage = ref(1);
const albumsHasMore = ref(false);
const loadingAlbums = ref(false);
const albumsLoaded = ref(false);

const isFollowed = ref(false);
const togglingFollow = ref(false);
const bioModalOpen = ref(false);
const activeBioSectionIdx = ref(0);
const bioScrollRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);

const bioSections = computed(() => {
  const secs = detail.value?.bioSections;
  if (Array.isArray(secs) && secs.length > 0) return secs;
  const fallback = detail.value?.longIntro || detail.value?.intro || '';
  return fallback ? [{ title: t('artist.bioModalTitle'), content: fallback }] : [];
});

function jumpToBioSection(idx: number) {
  echoSystem.haptic('selection');
  activeBioSectionIdx.value = idx;
  const container = bioScrollRef.value;
  if (!container) return;
  const target = container.querySelector<HTMLElement>(`[data-bio-sec="${idx}"]`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const displayName = computed(() => detail.value?.name || fallbackName.value || 'Artist');
const displayAvatar = computed(() => detail.value?.avatar || fallbackAvatar.value || '');
const compactTitleOpacity = computed(() => Number(Math.max(0, Math.min(1, (scrollTop.value - 130) / 40)).toFixed(3)));
const headerGlassActive = computed(() => scrollTop.value > 110);

const filteredSongs = computed(() => {
  const kw = filterQuery.value.trim().toLowerCase();
  if (!kw) return songs.value;
  return songs.value.filter(
    (s) => s.title.toLowerCase().includes(kw) || s.album.toLowerCase().includes(kw),
  );
});

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement)?.scrollTop ?? 0;
}

async function loadArtistMeta() {
  loadingMeta.value = true;
  try {
    const d = await kugouApi.getArtistDetail(artistId.value);
    detail.value = d;
    isFollowed.value = Boolean(d?.isFollow);
  } catch {
    detail.value = null;
  } finally {
    loadingMeta.value = false;
  }
}

async function loadSongs(reset = true) {
  if (loadingSongs.value) return;
  if (!reset && !songsHasMore.value) return;
  loadingSongs.value = true;
  const targetPage = reset ? 1 : songsPage.value + 1;
  try {
    const res = await kugouApi.getArtistSongs(artistId.value, songSort.value, targetPage, 30);
    songsPage.value = targetPage;
    songsHasMore.value = res.hasMore;
    if (reset) {
      songs.value = res.songs;
    } else {
      const seen = new Set(songs.value.map((s) => s.hash || s.id));
      songs.value = [...songs.value, ...res.songs.filter((s) => !seen.has(s.hash || s.id))];
    }
  } finally {
    loadingSongs.value = false;
  }
}

async function loadAlbums(reset = true) {
  if (loadingAlbums.value) return;
  if (!reset && !albumsHasMore.value) return;
  loadingAlbums.value = true;
  const targetPage = reset ? 1 : albumsPage.value + 1;
  try {
    const res = await kugouApi.getArtistAlbums(artistId.value, targetPage, 24);
    albumsPage.value = targetPage;
    albumsHasMore.value = res.hasMore;
    albumsLoaded.value = true;
    if (reset) {
      albums.value = res.albums;
    } else {
      const seen = new Set(albums.value.map((a) => a.id));
      albums.value = [...albums.value, ...res.albums.filter((a) => !seen.has(a.id))];
    }
  } finally {
    loadingAlbums.value = false;
  }
}

function switchTab(next: 'songs' | 'albums') {
  if (activeTab.value === next) return;
  echoSystem.haptic('selection');
  activeTab.value = next;
  if (next === 'albums' && !albumsLoaded.value) {
    void loadAlbums(true);
  }
}

function switchSort(next: 'hot' | 'new') {
  if (songSort.value === next) return;
  echoSystem.haptic('selection');
  songSort.value = next;
  void loadSongs(true);
}

async function toggleFollow() {
  if (!accounts.isLoggedIn) {
    ui.showToast(t('artist.followNeedLogin'));
    ui.loginModalOpen = true;
    return;
  }
  if (togglingFollow.value) return;
  togglingFollow.value = true;
  echoSystem.haptic('medium');
  const next = !isFollowed.value;
  isFollowed.value = next;
  try {
    const ok = await kugouApi.setArtistFollow(artistId.value, next);
    if (ok) {
      ui.showToast(next ? t('artist.followSuccess') : t('artist.unfollowSuccess'));
    } else {
      isFollowed.value = !next;
    }
  } catch {
    isFollowed.value = !next;
  } finally {
    togglingFollow.value = false;
  }
}

async function copyBio() {
  const txt = detail.value?.longIntro || detail.value?.intro || displayName.value;
  echoSystem.haptic('light');
  await echoSystem.copyToClipboard(`${displayName.value}\n${txt}`);
  ui.showToast(t('common.copied'));
}

function playAllHot() {
  const list = filteredSongs.value;
  if (!list.length) return;
  echoSystem.haptic('medium');
  void player.playQueue(list, 0);
}

function playSong(song: Song) {
  const list = filteredSongs.value;
  const idx = list.findIndex((s) => s.id === song.id && s.hash === song.hash);
  void player.playQueue(list, idx >= 0 ? idx : 0);
}

function openAlbum(al: AlbumSummary) {
  echoSystem.haptic('light');
  void router.push({
    path: `/album/${encodeURIComponent(al.id)}`,
    query: {
      name: al.name,
      cover: al.coverUrl,
      artist: al.artist || displayName.value,
      artistId: artistId.value,
    },
  });
}

async function bootstrap() {
  detail.value = null;
  songs.value = [];
  albums.value = [];
  albumsLoaded.value = false;
  activeTab.value = 'songs';
  songSort.value = 'hot';
  filterQuery.value = '';
  await Promise.all([loadArtistMeta(), loadSongs(true)]);
}

onMounted(() => void bootstrap());
watch(artistId, () => void bootstrap());
</script>

<template>
  <div class="h-full flex flex-col relative bg-[var(--bg-canvas)]">
    <!-- Collapsing Top Navigation Header -->
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
          {{ displayName }}
        </span>
        <div class="w-14 shrink-0" />
      </div>
    </header>

    <div class="flex-1 am-scroll pb-48 relative" @scroll.passive="onScroll">
      <!-- Ambient Blurred Artist Halo -->
      <div v-if="displayAvatar" class="artist-ambient pointer-events-none">
        <img :src="displayAvatar" alt="" class="w-full h-full object-cover scale-125 blur-3xl opacity-22" />
        <div class="artist-ambient-fade" />
      </div>

      <!-- Hero Artist Profile Card (EchoMusic-inspired, iOS 26 Liquid Glass!) -->
      <section class="relative z-10 px-5 pt-[calc(var(--safe-top)+56px)] pb-4 space-y-4">
        <div class="flex items-start gap-4">
          <div class="w-[104px] h-[104px] rounded-[22px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-xl flex items-center justify-center ring-1 ring-white/15">
            <img v-if="displayAvatar" :src="displayAvatar" :alt="displayName" class="w-full h-full object-cover" />
            <Icon v-else :icon="iconUser" class="w-10 h-10 text-[var(--text-tertiary)]" />
          </div>

          <div class="min-w-0 flex-1 pt-0.5 space-y-1.5">
            <div class="flex items-center gap-2 min-w-0">
              <h1 class="text-[24px] font-bold tracking-tight text-[var(--text-primary)] truncate leading-tight m-0">
                {{ displayName }}
              </h1>
              <span class="px-1.5 py-0.5 rounded-md border border-[var(--accent)]/40 text-[9.5px] font-extrabold am-accent-text tracking-wider shrink-0">
                {{ t('artist.badge') }}
              </span>
            </div>

            <!-- Stats Row: Songs · Albums · Fans -->
            <div v-if="detail" class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] font-semibold am-accent-text tabular-nums">
              <span v-if="detail.songCount > 0">{{ t('artist.songsUnit', { count: formatCompactCount(detail.songCount, effectiveLocale) }) }}</span>
              <span v-if="detail.albumCount > 0">· {{ t('artist.albumsUnit', { count: formatCompactCount(detail.albumCount, effectiveLocale) }) }}</span>
              <span v-if="detail.fansCount > 0">· {{ t('artist.fansUnit', { count: formatCompactCount(detail.fansCount, effectiveLocale) }) }}</span>
            </div>

            <!-- Birthday Chip -->
            <div
              v-if="detail?.birthday"
              class="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)] tabular-nums"
            >
              <Icon :icon="iconCake" class="w-3.5 h-3.5 opacity-75 shrink-0" />
              <span>{{ detail.birthday }}</span>
            </div>
          </div>
        </div>

        <!-- Collapsible Artist Biography + "View Full Bio" -->
        <div
          v-if="detail?.intro || detail?.longIntro"
          class="rounded-[18px] bg-[var(--bg-card)]/90 px-3.5 py-3 shadow-xs space-y-1.5 cursor-pointer am-tap"
          @click="bioModalOpen = true"
        >
          <p class="text-[12.5px] leading-relaxed text-[var(--text-secondary)] line-clamp-2 m-0">
            {{ detail.intro || detail.longIntro }}
          </p>
          <div class="text-right">
            <span class="text-[11.5px] font-semibold am-accent-text">{{ t('artist.viewBio') }} ›</span>
          </div>
        </div>

        <!-- Primary Action Row: Play Top / Follow / Copy Bio -->
        <div class="flex items-center gap-2.5">
          <button
            type="button"
            class="flex-1 h-10 px-4 rounded-full am-accent-bg text-white text-[14px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 shadow-sm am-tap min-w-0"
            :disabled="!songs.length"
            @click="playAllHot"
          >
            <Icon :icon="iconPlayerPlayFilled" class="w-4 h-4 shrink-0" />
            <span class="truncate">{{ t('artist.playHot') }}</span>
          </button>

          <button
            type="button"
            class="h-10 px-4 rounded-full text-[13.5px] font-semibold border-0 inline-flex items-center justify-center gap-1.5 am-tap shrink-0 transition-colors"
            :class="
              isFollowed
                ? 'bg-[var(--accent)]/15 am-accent-text'
                : 'bg-[var(--bg-subtle)] text-[var(--text-primary)]'
            "
            :disabled="togglingFollow"
            @click="toggleFollow"
          >
            <Icon :icon="isFollowed ? iconHeartFilled : iconHeart" class="w-4 h-4 shrink-0" />
            <span>{{ isFollowed ? t('artist.followed') : t('artist.follow') }}</span>
          </button>

          <button
            type="button"
            class="w-10 h-10 rounded-full bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-0 inline-flex items-center justify-center am-tap shrink-0"
            :aria-label="t('artist.copyBio')"
            @click="copyBio"
          >
            <Icon :icon="iconCopy" class="w-4.5 h-4.5" />
          </button>
        </div>

        <!-- Songs / Albums Segmented Tabs -->
        <div class="pt-seg-group grid-cols-2">
          <button
            type="button"
            class="pt-seg-btn tabular-nums"
            :class="activeTab === 'songs' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
            @click="switchTab('songs')"
          >
            {{ t('artist.tabSongs') }}<template v-if="detail?.songCount"> ({{ formatCompactCount(detail.songCount, effectiveLocale) }})</template>
          </button>
          <button
            type="button"
            class="pt-seg-btn tabular-nums"
            :class="activeTab === 'albums' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
            @click="switchTab('albums')"
          >
            {{ t('artist.tabAlbums') }}<template v-if="detail?.albumCount"> ({{ formatCompactCount(detail.albumCount, effectiveLocale) }})</template>
          </button>
        </div>
      </section>

      <Transition name="am-panel-switch" mode="out-in">
        <!-- ==================== TAB 1: ARTIST SONGS ==================== -->
        <section v-if="activeTab === 'songs'" key="artist-songs" class="relative z-10">
        <!-- Quick Filter & Hot/New Sort Bar -->
        <div class="px-5 pb-2.5 flex items-center gap-2">
          <div class="flex-1 h-9 px-3 rounded-xl bg-[var(--bg-subtle)] flex items-center gap-2 min-w-0">
            <Icon :icon="iconSearch" class="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
            <input
              v-model="filterQuery"
              type="text"
              :placeholder="t('artist.searchPlaceholder')"
              class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            />
            <button
              v-if="filterQuery"
              type="button"
              class="bg-transparent border-0 p-0 text-[var(--text-tertiary)] shrink-0"
              @click="filterQuery = ''"
            >
              <Icon :icon="iconX" class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex p-0.5 rounded-xl bg-[var(--bg-subtle)] shrink-0">
            <button
              type="button"
              class="px-2.5 h-8 rounded-[9px] text-[12px] font-semibold border-0 transition-all"
              :class="songSort === 'hot' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="switchSort('hot')"
            >
              {{ t('artist.sortHot') }}
            </button>
            <button
              type="button"
              class="px-2.5 h-8 rounded-[9px] text-[12px] font-semibold border-0 transition-all"
              :class="songSort === 'new' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
              @click="switchSort('new')"
            >
              {{ t('artist.sortNew') }}
            </button>
          </div>
        </div>

        <div v-if="(loadingSongs || loadingMeta) && !songs.length" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="!filteredSongs.length" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('search.noResults') }}
        </div>
        <div v-else>
          <SongRow
            v-for="(song, idx) in filteredSongs"
            :key="`${song.hash || song.id}-${idx}`"
            :song="song"
            :index="idx"
            show-index
            @play="playSong(song)"
          />
          <div v-if="songsHasMore && !filterQuery" class="px-5 pt-4">
            <button
              type="button"
              class="w-full h-10 rounded-2xl bg-[var(--bg-subtle)] text-[13px] font-semibold am-accent-text border-0 am-tap"
              :disabled="loadingSongs"
              @click="loadSongs(false)"
            >
              {{ loadingSongs ? t('common.loading') : t('common.loadMore') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ==================== TAB 2: ARTIST ALBUMS ==================== -->
      <section v-else key="artist-albums" class="relative z-10 px-5 pt-1">
        <div v-if="loadingAlbums && !albums.length" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="!albums.length" class="py-12 text-center text-[13.5px] text-[var(--text-secondary)]">
          {{ t('album.empty') }}
        </div>
        <div v-else class="space-y-4">
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
              <div class="text-[13.5px] font-semibold text-[var(--text-primary)] truncate mt-2">{{ al.name }}</div>
              <div class="text-[11.5px] text-[var(--text-secondary)] tabular-nums truncate mt-0.5">
                {{ al.publishDate || displayName }}
              </div>
            </div>
          </div>

          <button
            v-if="albumsHasMore"
            type="button"
            class="w-full h-10 rounded-2xl bg-[var(--bg-subtle)] text-[13px] font-semibold am-accent-text border-0 am-tap"
            :disabled="loadingAlbums"
            @click="loadAlbums(false)"
          >
            {{ loadingAlbums ? t('common.loading') : t('common.loadMore') }}
          </button>
        </div>
      </section>
      </Transition>
    </div>

    <!-- Full Artist Biography Modal (Structured Multi-Section Reader) -->
    <Transition name="lg-modal">
      <div
        v-if="bioModalOpen"
        class="fixed inset-0 z-[95] flex flex-col justify-end lg-scrim"
        @click="bioModalOpen = false"
      >
        <div class="lg-sheet-slide" @click.stop>
          <div class="lg-sheet-panel rounded-t-[28px] max-h-[84vh] flex flex-col overflow-hidden">
            <div class="pt-2.5 pb-1 flex justify-center shrink-0">
              <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55" />
            </div>
            <div class="px-5 py-2.5 flex items-center justify-between gap-2 am-hairline-b shrink-0">
              <div class="min-w-0">
                <div class="text-[17px] font-bold text-[var(--text-primary)] truncate">{{ displayName }}</div>
                <div class="text-[11.5px] text-[var(--text-secondary)]">
                  {{ t('artist.bioModalTitle') }}<template v-if="detail?.birthday"> · {{ detail.birthday }}</template>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  class="px-2.5 h-8 rounded-full bg-[var(--bg-subtle)] border-0 inline-flex items-center gap-1 text-[12px] font-semibold am-accent-text am-tap"
                  @click="copyBio"
                >
                  <Icon :icon="iconCopy" class="w-3.5 h-3.5" />
                  <span>{{ t('artist.copyBio') }}</span>
                </button>
                <button
                  type="button"
                  class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                  @click="bioModalOpen = false"
                >
                  <Icon :icon="iconX" class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Section Quick-Jump Pills (简介 / 基本资料 / 演艺经历 / 主要作品 / 荣誉记录) -->
            <div
              v-if="bioSections.length > 1"
              class="px-5 py-2.5 flex items-center gap-1.5 am-hscroll am-hairline-b shrink-0"
            >
              <button
                v-for="(sec, idx) in bioSections"
                :key="`${sec.title}-${idx}`"
                type="button"
                class="px-3 h-7 rounded-full text-[12px] font-semibold border-0 shrink-0 transition-colors am-tap"
                :class="
                  activeBioSectionIdx === idx
                    ? 'am-accent-bg text-white shadow-xs'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                "
                @click="jumpToBioSection(idx)"
              >
                {{ sec.title }}
              </button>
            </div>

            <div
              ref="bioScrollRef"
              class="flex-1 am-scroll px-5 py-4 pb-[calc(var(--safe-bottom)+28px)] space-y-4"
            >
              <template v-if="bioSections.length">
                <section
                  v-for="(sec, idx) in bioSections"
                  :key="`body-${sec.title}-${idx}`"
                  :data-bio-sec="idx"
                  class="rounded-[18px] bg-[var(--bg-card)] p-4 space-y-2 shadow-xs"
                >
                  <div v-if="bioSections.length > 1" class="flex items-center gap-2">
                    <span class="w-1 h-4 rounded-full am-accent-bg shrink-0" />
                    <h3 class="text-[14.5px] font-bold text-[var(--text-primary)] m-0">{{ sec.title }}</h3>
                  </div>
                  <p class="text-[13.5px] leading-[1.7] text-[var(--text-primary)] whitespace-pre-wrap break-words m-0">
                    {{ sec.content }}
                  </p>
                </section>
              </template>
              <p v-else class="text-[14px] text-center py-10 text-[var(--text-secondary)] m-0">
                {{ t('artist.noBio') }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
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

.artist-ambient {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 290px;
  overflow: hidden;
  z-index: 0;
}

.artist-ambient-fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 0%, var(--bg-canvas) 95%);
}
</style>
