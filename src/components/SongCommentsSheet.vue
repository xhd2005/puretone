<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconThumbUp from '@iconify/icons-tabler/thumb-up';
import iconMessageCircle from '@iconify/icons-tabler/message-circle';
import iconSend from '@iconify/icons-tabler/send';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconMusic from '@iconify/icons-tabler/music';
import iconDisc from '@iconify/icons-tabler/disc';
import iconUser from '@iconify/icons-tabler/user';
import iconPhoto from '@iconify/icons-tabler/photo';
import iconCopy from '@iconify/icons-tabler/copy';
import type { CommentClassifyTag, CommentHotwordTag, SongComment } from '@/types/music';
import { formatCompactCount, kugouApi } from '@/services/kugou/kugouEngine';
import {
  extractArtistRefsFromSong,
  navigateToArtistRef,
  openAlbumFromSong,
} from '@/services/playback/artistNavigation';
import { useAccountsStore } from '@/stores/accounts';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { useI18n } from '@/i18n';
import { useDraggableSheet } from '@/composables/useDraggableSheet';
import { echoSystem } from '@/native/echoSystem';

type CommentSubMode = 'all' | 'classify' | 'hotword';

interface FloorState {
  open: boolean;
  loading: boolean;
  replies: SongComment[];
  page: number;
  hasMore: boolean;
}

const router = useRouter();
const accounts = useAccountsStore();
const player = usePlayerStore();
const ui = useUiStore();
const { t, effectiveLocale } = useI18n();

const scrollRef = ref<HTMLElement | null>(null);
const subMode = ref<CommentSubMode>('all');
const loading = ref(false);
const loadingMore = ref(false);
const comments = ref<SongComment[]>([]);
const totalCount = ref(0);
const hasMore = ref(false);
const page = ref(1);
const specialId = ref('');

const classifies = ref<CommentClassifyTag[]>([]);
const selectedClassifyId = ref('');
const classifySort = ref<1 | 2>(1);

const hotwords = ref<CommentHotwordTag[]>([]);
const selectedHotword = ref('');

const floorStates = ref<Record<string, FloorState>>({});

// Composer state
const composerText = ref('');
const sending = ref(false);
const replyTarget = ref<SongComment | null>(null);

const song = computed(() => ui.commentsSheetSong);
const artistRefs = computed(() => (song.value ? extractArtistRefsFromSong(song.value) : []));

const dragSheet = useDraggableSheet({
  detents: [0.74, 0.94],
  initialDetentIndex: 1,
  scrollElRef: scrollRef,
  onDismiss: () => {
    ui.commentsSheetSong = null;
  },
});

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const qualityBadges = computed(() => {
  const s = song.value;
  if (!s) return [];
  const badges: string[] = [];
  if (s.hashFlac) badges.push('FLAC');
  if (s.hash320) badges.push('320K');
  if (s.hash) badges.push('128K');
  return badges;
});

async function resolveMixSongId(): Promise<number | null> {
  const s = song.value;
  if (!s) return null;
  if (s.mixSongId && s.mixSongId > 0) return s.mixSongId;
  // Fallback search by title+artist to resolve mixSongId for external/cached tracks
  const found = await kugouApi.searchSongs(`${s.title} ${s.artist}`, 1, 5).catch(() => ({ songs: [], total: 0 }));
  const matched =
    found.songs.find((item) => item.hash && s.hash && item.hash.toLowerCase() === s.hash.toLowerCase()) ||
    found.songs[0];
  return matched?.mixSongId ?? null;
}

let activeMixSongId = 0;

async function fetchComments(reset = true) {
  const s = song.value;
  if (!s) return;
  if (reset) {
    loading.value = true;
    page.value = 1;
    comments.value = [];
    floorStates.value = {};
  } else {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    page.value += 1;
  }

  try {
    if (!activeMixSongId) {
      const resolved = await resolveMixSongId();
      if (!resolved) {
        totalCount.value = 0;
        hasMore.value = false;
        return;
      }
      activeMixSongId = resolved;
    }

    let res;
    if (subMode.value === 'classify' && selectedClassifyId.value) {
      res = await kugouApi.getSongCommentsByClassify(
        activeMixSongId,
        selectedClassifyId.value,
        classifySort.value,
        page.value,
      );
    } else if (subMode.value === 'hotword' && selectedHotword.value) {
      res = await kugouApi.getSongCommentsByHotword(activeMixSongId, selectedHotword.value, page.value);
    } else {
      res = await kugouApi.getSongComments(activeMixSongId, page.value);
      if (reset) {
        classifies.value = res.classifies;
        hotwords.value = res.hotwords;
        if (!selectedClassifyId.value && res.classifies.length) {
          selectedClassifyId.value = res.classifies[0].id;
        }
        if (!selectedHotword.value && res.hotwords.length) {
          selectedHotword.value = res.hotwords[0].word;
        }
      }
    }

    if (res.specialId) specialId.value = res.specialId;
    if (res.total > 0 || reset) {
      if (subMode.value === 'all' || !totalCount.value) {
        totalCount.value = res.total;
      }
    }
    hasMore.value = res.hasMore;
    if (reset) {
      comments.value = res.comments;
    } else {
      const existing = new Set(comments.value.map((c) => c.id));
      comments.value = [...comments.value, ...res.comments.filter((c) => !existing.has(c.id))];
    }
  } catch {
    if (reset) comments.value = [];
    hasMore.value = false;
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

watch(
  () => ui.commentsSheetSong,
  (next) => {
    if (!next) return;
    dragSheet.reset();
    subMode.value = 'all';
    selectedClassifyId.value = '';
    selectedHotword.value = '';
    classifies.value = [];
    hotwords.value = [];
    replyTarget.value = null;
    composerText.value = '';
    specialId.value = '';
    activeMixSongId = next.mixSongId || 0;
    totalCount.value = 0;
    void fetchComments(true);
  },
);

function switchSubMode(next: CommentSubMode) {
  if (subMode.value === next) return;
  echoSystem.haptic('selection');
  subMode.value = next;
  if (next === 'classify' && !selectedClassifyId.value && classifies.value.length) {
    selectedClassifyId.value = classifies.value[0].id;
  }
  if (next === 'hotword' && !selectedHotword.value && hotwords.value.length) {
    selectedHotword.value = hotwords.value[0].word;
  }
  void fetchComments(true);
}

function selectClassify(id: string) {
  if (selectedClassifyId.value === id) return;
  echoSystem.haptic('selection');
  selectedClassifyId.value = id;
  void fetchComments(true);
}

function toggleClassifySort(sort: 1 | 2) {
  if (classifySort.value === sort) return;
  echoSystem.haptic('selection');
  classifySort.value = sort;
  void fetchComments(true);
}

function selectHotword(word: string) {
  if (selectedHotword.value === word) return;
  echoSystem.haptic('selection');
  selectedHotword.value = word;
  void fetchComments(true);
}

async function toggleFloorReplies(cmt: SongComment) {
  echoSystem.haptic('selection');
  const existing = floorStates.value[cmt.id];
  if (existing && existing.open) {
    floorStates.value = { ...floorStates.value, [cmt.id]: { ...existing, open: false } };
    return;
  }
  if (existing && existing.replies.length > 0) {
    floorStates.value = { ...floorStates.value, [cmt.id]: { ...existing, open: true } };
    return;
  }
  const spId = cmt.specialId || specialId.value;
  if (!spId) return;

  floorStates.value = {
    ...floorStates.value,
    [cmt.id]: { open: true, loading: true, replies: [], page: 1, hasMore: false },
  };
  try {
    const res = await kugouApi.getCommentFloorReplies({
      specialId: spId,
      tid: cmt.tid,
      mixSongId: activeMixSongId || undefined,
      page: 1,
      pagesize: 15,
    });
    floorStates.value = {
      ...floorStates.value,
      [cmt.id]: { open: true, loading: false, replies: res.replies, page: 1, hasMore: res.hasMore },
    };
  } catch {
    floorStates.value = {
      ...floorStates.value,
      [cmt.id]: { open: true, loading: false, replies: [], page: 1, hasMore: false },
    };
  }
}

async function loadMoreFloorReplies(cmt: SongComment) {
  const st = floorStates.value[cmt.id];
  const spId = cmt.specialId || specialId.value;
  if (!st || st.loading || !st.hasMore || !spId) return;
  floorStates.value = { ...floorStates.value, [cmt.id]: { ...st, loading: true } };
  try {
    const nextPage = st.page + 1;
    const res = await kugouApi.getCommentFloorReplies({
      specialId: spId,
      tid: cmt.tid,
      mixSongId: activeMixSongId || undefined,
      page: nextPage,
      pagesize: 15,
    });
    floorStates.value = {
      ...floorStates.value,
      [cmt.id]: {
        open: true,
        loading: false,
        replies: [...st.replies, ...res.replies],
        page: nextPage,
        hasMore: res.hasMore,
      },
    };
  } catch {
    floorStates.value = { ...floorStates.value, [cmt.id]: { ...st, loading: false } };
  }
}

function startReply(cmt: SongComment) {
  if (!accounts.isLoggedIn) {
    ui.loginModalOpen = true;
    return;
  }
  echoSystem.haptic('selection');
  replyTarget.value = cmt;
}

async function submitComment() {
  if (!accounts.isLoggedIn) {
    ui.loginModalOpen = true;
    return;
  }
  const text = composerText.value.trim();
  if (!text || sending.value || !song.value) return;
  sending.value = true;
  echoSystem.haptic('medium');
  try {
    const target = replyTarget.value;
    let res: { ok: boolean; message?: string };
    if (target) {
      const spId = target.specialId || specialId.value;
      if (!spId) {
        ui.showToast(t('comments.sendFailed'));
        return;
      }
      res = await kugouApi.sendFloorReply({
        specialId: spId,
        tid: target.tid,
        songName: song.value.title,
        content: text,
        replyUserName: target.userName,
        replyContent: target.content.slice(0, 40),
      });
    } else {
      res = await kugouApi.sendSongComment({
        mixSongId: activeMixSongId || song.value.mixSongId,
        specialId: specialId.value || undefined,
        songName: song.value.title,
        content: text,
      });
    }
    if (res.ok) {
      ui.showToast(t('comments.sentOk'));
      composerText.value = '';
      if (target) {
        const prev = floorStates.value[target.id];
        const optimistic: SongComment = {
          id: `local-${Date.now()}`,
          tid: target.tid,
          specialId: target.specialId || specialId.value,
          userName: accounts.activeAccount?.nickname || 'Me',
          userAvatar: accounts.activeAccount?.avatar || '',
          isVip: Boolean(accounts.activeAccount?.isVip),
          content: text,
          addTime: 'Just now',
          likeCount: 0,
          replyCount: 0,
        };
        floorStates.value = {
          ...floorStates.value,
          [target.id]: {
            open: true,
            loading: false,
            replies: [optimistic, ...(prev?.replies || [])],
            page: prev?.page || 1,
            hasMore: prev?.hasMore || false,
          },
        };
        replyTarget.value = null;
      } else {
        const optimistic: SongComment = {
          id: `local-${Date.now()}`,
          tid: `local-${Date.now()}`,
          specialId: specialId.value || undefined,
          userName: accounts.activeAccount?.nickname || 'Me',
          userAvatar: accounts.activeAccount?.avatar || '',
          isVip: Boolean(accounts.activeAccount?.isVip),
          content: text,
          addTime: 'Just now',
          likeCount: 0,
          replyCount: 0,
        };
        comments.value = [optimistic, ...comments.value];
        totalCount.value += 1;
      }
    } else {
      ui.showToast(res.message || t('comments.sendFailed'), 3000);
    }
  } catch (e: any) {
    ui.showToast(e?.message || t('comments.sendFailed'), 3000);
  } finally {
    sending.value = false;
  }
}

async function openArtist(idx = 0) {
  const refItem = artistRefs.value[idx];
  if (!refItem) return;
  echoSystem.haptic('light');
  await navigateToArtistRef(refItem, router, ui, {
    resolving: t('artist.resolving'),
    notFound: t('artist.notFound'),
  });
}

async function openAlbum() {
  if (!song.value) return;
  echoSystem.haptic('light');
  await openAlbumFromSong(song.value, router, ui, t('album.empty'));
}

async function copyMeta() {
  if (!song.value) return;
  echoSystem.haptic('light');
  await echoSystem.copyToClipboard(`${song.value.title} - ${song.value.artist}`);
  ui.showToast(t('song.copiedMeta'));
}

function openPoster() {
  if (!song.value) return;
  const s = song.value;
  ui.commentsSheetSong = null;
  ui.lyricPosterSong = s;
}
</script>

<template>
  <Transition name="lg-modal">
    <div
      v-if="song"
      class="fixed inset-0 z-[92] flex flex-col justify-end lg-scrim"
      @click="ui.commentsSheetSong = null"
    >
      <div class="lg-sheet-slide" @click.stop>
        <div
          class="lg-sheet-panel rounded-t-[28px] flex flex-col overflow-hidden"
          :style="dragSheet.sheetStyle.value"
        >
          <!-- Draggable Top Hero + Details/Comments Dual Tab -->
          <div
            class="shrink-0 touch-none select-none"
            @touchstart="dragSheet.onHandleTouchStart"
            @touchmove="dragSheet.onHandleTouchMove"
            @touchend="dragSheet.onHandleTouchEnd"
            @touchcancel="dragSheet.onHandleTouchEnd"
          >
            <div class="pt-2.5 pb-1 flex justify-center">
              <div class="w-11 h-1.5 rounded-full bg-[var(--text-tertiary)]/55" />
            </div>

            <!-- Song Header Card (EchoMusic-inspired, Liquid Glass refined) -->
            <div class="px-4 pt-1 pb-3 flex items-center gap-3">
              <div class="w-13 h-13 rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-md flex items-center justify-center">
                <img v-if="song.coverUrl" :src="song.coverUrl" class="w-full h-full object-cover" alt="" />
                <Icon v-else :icon="iconMusic" class="w-5 h-5 text-[var(--text-tertiary)]" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[16px] font-bold text-[var(--text-primary)] truncate">{{ song.title }}</div>
                <div class="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] truncate">
                  <button
                    type="button"
                    class="am-accent-text font-semibold bg-transparent border-0 p-0 truncate am-tap"
                    @click.stop="openArtist(0)"
                  >
                    {{ song.artist }}
                  </button>
                  <span v-if="totalCount > 0" class="shrink-0 opacity-70 tabular-nums">
                    · {{ formatCompactCount(totalCount, effectiveLocale) }} {{ t('comments.tabComments') }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="w-8 h-8 rounded-full bg-[var(--bg-subtle)] border-0 flex items-center justify-center text-[var(--text-secondary)] am-tap shrink-0"
                :aria-label="t('common.close')"
                @click="ui.commentsSheetSong = null"
              >
                <Icon :icon="iconX" class="w-4 h-4" />
              </button>
            </div>

            <!-- Main 2-Segment Tabs: Details | Comments (N) -->
            <div class="px-4 pb-2.5 am-hairline-b" @touchstart.stop>
              <div class="pt-seg-group grid-cols-2">
                <button
                  type="button"
                  class="pt-seg-btn"
                  :class="
                    ui.commentsSheetTab === 'details'
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent text-[var(--text-secondary)]'
                  "
                  @click="echoSystem.haptic('selection'); ui.commentsSheetTab = 'details'"
                >
                  {{ t('comments.tabDetails') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn tabular-nums"
                  :class="
                    ui.commentsSheetTab === 'comments'
                      ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                      : 'bg-transparent text-[var(--text-secondary)]'
                  "
                  @click="echoSystem.haptic('selection'); ui.commentsSheetTab = 'comments'"
                >
                  {{ t('comments.tabComments') }}<template v-if="totalCount > 0"> ({{ formatCompactCount(totalCount, effectiveLocale) }})</template>
                </button>
              </div>
            </div>
          </div>

          <!-- Scrollable Sheet Body -->
          <div
            ref="scrollRef"
            class="flex-1 am-scroll px-4 pt-3.5 pb-6 space-y-3"
            @touchstart.passive="dragSheet.onBodyTouchStart"
            @touchmove="dragSheet.onBodyTouchMove"
            @touchend.passive="dragSheet.onBodyTouchEnd"
            @touchcancel.passive="dragSheet.onBodyTouchEnd"
          >
            <!-- ==================== TAB A: TRACK DETAILS ==================== -->
            <template v-if="ui.commentsSheetTab === 'details'">
              <section class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
                <!-- Clickable Artist Row(s) -->
                <div class="px-4 py-3 space-y-2">
                  <div class="text-[11.5px] font-medium text-[var(--text-secondary)]">{{ t('comments.detailArtist') }}</div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="(art, idx) in artistRefs"
                      :key="`${art.id || art.name}-${idx}`"
                      type="button"
                      class="px-3 py-1.5 rounded-full bg-[var(--bg-subtle)] text-[13px] font-semibold am-accent-text border-0 inline-flex items-center gap-1 am-tap"
                      @click="openArtist(idx)"
                    >
                      <Icon :icon="iconUser" class="w-3.5 h-3.5" />
                      <span>{{ art.name }}</span>
                      <Icon :icon="iconChevronRight" class="w-3.5 h-3.5 opacity-60" />
                    </button>
                  </div>
                </div>

                <!-- Clickable Album Row -->
                <button
                  v-if="song.album"
                  type="button"
                  class="w-full px-4 py-3 bg-transparent border-0 flex items-center justify-between gap-2 text-left am-tap"
                  @click="openAlbum"
                >
                  <div class="min-w-0">
                    <div class="text-[11.5px] text-[var(--text-secondary)]">{{ t('comments.detailAlbum') }}</div>
                    <div class="text-[14.5px] font-semibold text-[var(--text-primary)] truncate mt-0.5 flex items-center gap-1.5">
                      <Icon :icon="iconDisc" class="w-4 h-4 am-accent-text shrink-0" />
                      <span class="truncate">{{ song.album }}</span>
                    </div>
                  </div>
                  <Icon :icon="iconChevronRight" class="w-4.5 h-4.5 text-[var(--text-tertiary)] shrink-0" />
                </button>

                <!-- Duration + Audio Quality + Comments Count -->
                <div class="px-4 py-3 grid grid-cols-3 gap-2 text-center">
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2 px-1">
                    <div class="text-[13.5px] font-bold text-[var(--text-primary)] tabular-nums">
                      {{ formatDuration(song.duration) }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailDuration') }}</div>
                  </div>
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2 px-1">
                    <div class="text-[13.5px] font-bold text-[var(--text-primary)] tabular-nums">
                      {{ totalCount > 0 ? formatCompactCount(totalCount, effectiveLocale) : '--' }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailComments') }}</div>
                  </div>
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2 px-1">
                    <div class="text-[12.5px] font-bold am-accent-text truncate">
                      {{ qualityBadges[0] || 'STD' }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailQuality') }}</div>
                  </div>
                </div>

                <!-- Source Status -->
                <div class="px-4 py-3 flex items-center justify-between gap-2">
                  <span class="text-[13px] text-[var(--text-secondary)]">{{ t('comments.detailSource') }}</span>
                  <span class="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {{ player.currentSong?.id === song.id && player.sourceTag ? player.sourceTag : t('comments.sourceNative') }}
                  </span>
                </div>
              </section>

              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  class="h-11 rounded-[16px] bg-[var(--bg-card)] text-[13.5px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center justify-center gap-1.5 shadow-xs am-tap"
                  @click="openPoster"
                >
                  <Icon :icon="iconPhoto" class="w-4 h-4 am-accent-text" />
                  <span class="truncate">{{ t('song.poster') }}</span>
                </button>
                <button
                  type="button"
                  class="h-11 rounded-[16px] bg-[var(--bg-card)] text-[13.5px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center justify-center gap-1.5 shadow-xs am-tap"
                  @click="copyMeta"
                >
                  <Icon :icon="iconCopy" class="w-4 h-4 am-accent-text" />
                  <span class="truncate">{{ t('song.copyMeta') }}</span>
                </button>
              </div>
            </template>

            <!-- ==================== TAB B: COMMENTS (ALL / CLASSIFY / HOTWORD) ==================== -->
            <template v-else>
              <!-- 3-Mode Bar matching EchoMusic -->
              <div class="pt-seg-group grid-cols-3">
                <button
                  type="button"
                  class="pt-seg-btn"
                  :class="subMode === 'all' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
                  @click="switchSubMode('all')"
                >
                  {{ t('comments.all') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn"
                  :class="subMode === 'classify' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
                  @click="switchSubMode('classify')"
                >
                  {{ t('comments.classify') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn"
                  :class="subMode === 'hotword' ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs' : 'bg-transparent text-[var(--text-secondary)]'"
                  @click="switchSubMode('hotword')"
                >
                  {{ t('comments.hotword') }}
                </button>
              </div>

              <!-- Classify Chips + Hot/New Toggle -->
              <div v-if="subMode === 'classify' && classifies.length" class="space-y-2">
                <div class="flex items-center gap-1.5 am-hscroll pb-0.5">
                  <button
                    v-for="cls in classifies"
                    :key="cls.id"
                    type="button"
                    class="px-3 h-7 rounded-full text-[12px] font-semibold border-0 shrink-0 transition-colors"
                    :class="
                      selectedClassifyId === cls.id
                        ? 'am-accent-bg text-white'
                        : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    "
                    @click="selectClassify(cls.id)"
                  >
                    {{ cls.name }}<template v-if="cls.count"> · {{ formatCompactCount(cls.count, effectiveLocale) }}</template>
                  </button>
                </div>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    class="px-2.5 h-6 rounded-full text-[11px] font-semibold border-0"
                    :class="classifySort === 1 ? 'bg-[var(--accent)]/16 am-accent-text' : 'bg-transparent text-[var(--text-tertiary)]'"
                    @click="toggleClassifySort(1)"
                  >
                    {{ t('comments.sortHot') }}
                  </button>
                  <button
                    type="button"
                    class="px-2.5 h-6 rounded-full text-[11px] font-semibold border-0"
                    :class="classifySort === 2 ? 'bg-[var(--accent)]/16 am-accent-text' : 'bg-transparent text-[var(--text-tertiary)]'"
                    @click="toggleClassifySort(2)"
                  >
                    {{ t('comments.sortNew') }}
                  </button>
                </div>
              </div>

              <!-- Hotword Chips -->
              <div v-if="subMode === 'hotword' && hotwords.length" class="flex items-center gap-1.5 am-hscroll pb-0.5">
                <button
                  v-for="hw in hotwords"
                  :key="hw.word"
                  type="button"
                  class="px-3 h-7 rounded-full text-[12px] font-semibold border-0 shrink-0 transition-colors"
                  :class="
                    selectedHotword === hw.word
                      ? 'am-accent-bg text-white'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                  "
                  @click="selectHotword(hw.word)"
                >
                  # {{ hw.word }}
                </button>
              </div>

              <!-- Loading Skeleton -->
              <div v-if="loading" class="py-12 text-center text-[13px] text-[var(--text-secondary)]">
                {{ t('comments.loading') }}
              </div>

              <!-- Empty State -->
              <div v-else-if="!comments.length" class="py-12 text-center text-[13px] text-[var(--text-secondary)]">
                {{ t('comments.empty') }}
              </div>

              <!-- Comment Cards -->
              <div v-else class="space-y-2.5">
                <article
                  v-for="cmt in comments"
                  :key="cmt.id"
                  class="rounded-[18px] bg-[var(--bg-card)] p-3.5 shadow-xs space-y-2"
                >
                  <div class="flex items-start justify-between gap-2.5">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <div class="w-8 h-8 rounded-full overflow-hidden bg-[var(--bg-subtle)] shrink-0 flex items-center justify-center text-[12px] font-bold text-[var(--text-secondary)]">
                        <img v-if="cmt.userAvatar" :src="cmt.userAvatar" class="w-full h-full object-cover" alt="" />
                        <span v-else>{{ cmt.userName.slice(0, 1) }}</span>
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class="text-[13px] font-bold text-[var(--text-primary)] truncate">{{ cmt.userName }}</span>
                          <span
                            v-if="cmt.isVip"
                            class="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-gradient-to-r from-[#f59e0b] to-[#d97706] text-white leading-none shrink-0"
                          >
                            VIP
                          </span>
                        </div>
                        <div class="text-[10.5px] text-[var(--text-tertiary)] truncate tabular-nums">
                          {{ cmt.addTime }}<template v-if="cmt.location"> · {{ cmt.location }}</template>
                        </div>
                      </div>
                    </div>

                    <div class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-subtle)]/75 text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums shrink-0">
                      <Icon :icon="iconThumbUp" class="w-3.5 h-3.5 am-accent-text" />
                      <span>{{ formatCompactCount(cmt.likeCount, effectiveLocale) }}</span>
                    </div>
                  </div>

                  <p class="text-[13.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words m-0 pl-[42px]">
                    {{ cmt.content }}
                  </p>

                  <!-- Floor Reply Toggle & Quick Reply -->
                  <div class="pl-[42px] flex items-center gap-4 pt-0.5">
                    <button
                      v-if="cmt.replyCount > 0"
                      type="button"
                      class="inline-flex items-center gap-1 bg-transparent border-0 p-0 text-[12px] font-semibold am-accent-text am-tap"
                      @click="toggleFloorReplies(cmt)"
                    >
                      <Icon :icon="iconMessageCircle" class="w-3.5 h-3.5" />
                      <span>
                        {{
                          floorStates[cmt.id]?.open
                            ? t('comments.hideReplies')
                            : t('comments.viewReplies', { count: cmt.replyCount })
                        }}
                      </span>
                    </button>

                    <button
                      type="button"
                      class="bg-transparent border-0 p-0 text-[12px] font-medium text-[var(--text-secondary)] am-tap"
                      @click="startReply(cmt)"
                    >
                      {{ t('comments.reply') }}
                    </button>
                  </div>

                  <!-- Expanded Inline Floor Replies -->
                  <div
                    v-if="floorStates[cmt.id]?.open"
                    class="ml-[42px] mt-1.5 rounded-2xl bg-[var(--bg-subtle)]/55 p-3 space-y-2.5"
                  >
                    <div
                      v-if="floorStates[cmt.id].loading && !floorStates[cmt.id].replies.length"
                      class="text-[12px] text-[var(--text-secondary)]"
                    >
                      {{ t('common.loading') }}
                    </div>
                    <div
                      v-for="rep in floorStates[cmt.id].replies"
                      :key="rep.id"
                      class="space-y-1 text-[12.5px]"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <span class="font-bold text-[var(--text-primary)] truncate">{{ rep.userName }}</span>
                        <span class="text-[10.5px] text-[var(--text-tertiary)] shrink-0 tabular-nums">{{ rep.addTime }}</span>
                      </div>
                      <p class="m-0 text-[var(--text-secondary)] leading-relaxed break-words">{{ rep.content }}</p>
                    </div>
                    <button
                      v-if="floorStates[cmt.id].hasMore"
                      type="button"
                      class="bg-transparent border-0 p-0 text-[11.5px] font-semibold am-accent-text"
                      :disabled="floorStates[cmt.id].loading"
                      @click="loadMoreFloorReplies(cmt)"
                    >
                      {{ floorStates[cmt.id].loading ? t('common.loading') : t('common.loadMore') }}
                    </button>
                  </div>
                </article>

                <button
                  v-if="hasMore"
                  type="button"
                  class="w-full h-10 rounded-2xl bg-[var(--bg-card)] text-[13px] font-semibold am-accent-text border-0 shadow-xs am-tap"
                  :disabled="loadingMore"
                  @click="fetchComments(false)"
                >
                  {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
                </button>
              </div>
            </template>
          </div>

          <!-- Bottom Sticky Comment Composer (Comments Tab Only, IME-aware!) -->
          <div
            v-if="ui.commentsSheetTab === 'comments'"
            class="shrink-0 px-4 pt-2.5 am-hairline-t bg-[var(--lg-sheet-bg)]"
            :style="{ paddingBottom: 'calc(max(var(--safe-bottom), var(--ime-height)) + 12px)' }"
          >
            <div v-if="replyTarget" class="mb-2 flex items-center justify-between px-3 py-1.5 rounded-xl bg-[var(--bg-subtle)] text-[12px]">
              <span class="text-[var(--text-secondary)] truncate">
                {{ t('comments.replyingTo', { user: replyTarget.userName }) }}
              </span>
              <button
                type="button"
                class="bg-transparent border-0 p-0.5 text-[var(--text-tertiary)] shrink-0"
                @click="replyTarget = null"
              >
                <Icon :icon="iconX" class="w-3.5 h-3.5" />
              </button>
            </div>

            <form class="flex items-center gap-2" @submit.prevent="submitComment">
              <input
                v-model="composerText"
                type="text"
                :placeholder="accounts.isLoggedIn ? t('comments.placeholder') : t('comments.loginPlaceholder')"
                :readonly="!accounts.isLoggedIn"
                class="flex-1 min-w-0 h-10 px-3.5 rounded-full bg-[var(--bg-card)] text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border border-[var(--hairline)] outline-none"
                @click="!accounts.isLoggedIn && (ui.loginModalOpen = true)"
              />
              <button
                type="submit"
                class="h-10 px-4 rounded-full am-accent-bg text-white text-[13px] font-semibold border-0 inline-flex items-center gap-1 am-tap shrink-0 disabled:opacity-45"
                :disabled="sending || (accounts.isLoggedIn && !composerText.trim())"
              >
                <Icon :icon="iconSend" class="w-3.5 h-3.5" />
                <span>{{ t('comments.send') }}</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
