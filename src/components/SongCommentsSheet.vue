<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import iconX from '@iconify/icons-tabler/x';
import iconThumbUp from '@iconify/icons-tabler/thumb-up';
import iconThumbUpFilled from '@iconify/icons-tabler/thumb-up-filled';
import iconMessageCircle from '@iconify/icons-tabler/message-circle';
import iconSend from '@iconify/icons-tabler/send';
import iconChevronRight from '@iconify/icons-tabler/chevron-right';
import iconMusic from '@iconify/icons-tabler/music';
import iconDisc from '@iconify/icons-tabler/disc';
import iconUser from '@iconify/icons-tabler/user';
import iconPhoto from '@iconify/icons-tabler/photo';
import iconCopy from '@iconify/icons-tabler/copy';
import iconHeart from '@iconify/icons-tabler/heart';
import iconHeartFilled from '@iconify/icons-tabler/heart-filled';
import iconPlaylistAdd from '@iconify/icons-tabler/playlist-add';
import iconSparkles from '@iconify/icons-tabler/sparkles';
import iconPlayerPlayFilled from '@iconify/icons-tabler/player-play-filled';
import iconWaveSine from '@iconify/icons-tabler/wave-sine';
import type {
  AlbumDetail,
  CommentHotwordTag,
  Song,
  SongClimaxRange,
  SongComment,
  SongEnrichedMeta,
} from '@/types/music';
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

type CommentSubMode = 'all' | 'hot' | 'newest' | 'hotword';

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

const detailsScrollRef = ref<HTMLElement | null>(null);
const commentsScrollRef = ref<HTMLElement | null>(null);
const activeScrollRef = computed(() =>
  ui.commentsSheetTab === 'details' ? detailsScrollRef.value : commentsScrollRef.value,
);
const subMode = ref<CommentSubMode>('all');
const mainTabIndex = computed(() => (ui.commentsSheetTab === 'comments' ? 1 : 0));
const subModeIndex = computed(() => {
  const order: CommentSubMode[] = ['all', 'hot', 'newest', 'hotword'];
  const idx = order.indexOf(subMode.value);
  return idx >= 0 ? idx : 0;
});

function switchMainTab(next: 'details' | 'comments') {
  if (ui.commentsSheetTab === next) return;
  echoSystem.haptic('selection');
  ui.commentsSheetTab = next;
}
const loading = ref(false);
const switchingSubMode = ref(false);
const loadingMore = ref(false);
const comments = ref<SongComment[]>([]);
const totalCount = ref(0);
const hasMore = ref(false);
const page = ref(1);
const specialId = ref('');

interface CommentBucketSnapshot {
  comments: SongComment[];
  page: number;
  hasMore: boolean;
}
const commentBuckets = new Map<string, CommentBucketSnapshot>();

function currentBucketKey(mode: CommentSubMode = subMode.value, hotword: string = selectedHotword.value): string {
  return mode === 'hotword' ? `hotword:${hotword}` : mode;
}

function saveCurrentBucket(mode: CommentSubMode = subMode.value, hotword: string = selectedHotword.value) {
  commentBuckets.set(currentBucketKey(mode, hotword), {
    comments: comments.value,
    page: page.value,
    hasMore: hasMore.value,
  });
}

const hotwords = ref<CommentHotwordTag[]>([]);
const selectedHotword = ref('');
const floorStates = ref<Record<string, FloorState>>({});

// Enriched track details state
const enrichedMeta = ref<SongEnrichedMeta | null>(null);
const albumDetail = ref<AlbumDetail | null>(null);
const climaxRange = ref<SongClimaxRange | null>(null);

// Composer state
const composerText = ref('');
const sending = ref(false);
const replyTarget = ref<SongComment | null>(null);

const song = computed(() => ui.commentsSheetSong);
const isCurrentPlayingSong = computed(() => {
  const s = song.value;
  const cur = player.currentSong;
  if (!s || !cur) return false;
  return s.id === cur.id || (Boolean(s.hash && cur.hash) && s.hash.toLowerCase() === cur.hash.toLowerCase());
});
const isFavoriteSong = computed(() => {
  const h = song.value?.hash?.toLowerCase();
  return Boolean(h && player.favoriteHashes.has(h));
});
const artistRefs = computed(() => (song.value ? extractArtistRefsFromSong(song.value) : []));

const resolvedDurationSec = computed(() => {
  const s = song.value;
  if (!s) return 0;
  if (enrichedMeta.value?.durationSec && enrichedMeta.value.durationSec > 0) return enrichedMeta.value.durationSec;
  if (s.duration && s.duration > 0) return s.duration;
  if (isCurrentPlayingSong.value && player.durationMs > 0) return Math.round(player.durationMs / 1000);
  return 0;
});

const resolvedAlbumName = computed(
  () => albumDetail.value?.name || enrichedMeta.value?.albumName || song.value?.album || '',
);
const resolvedAlbumId = computed(() => {
  const cand = albumDetail.value?.id || enrichedMeta.value?.albumId || song.value?.albumId || '';
  return cand && cand !== '0' ? cand : '';
});
const resolvedAlbumCover = computed(
  () => albumDetail.value?.coverUrl || enrichedMeta.value?.coverUrl || song.value?.coverUrl || '',
);

const peakQualityLabel = computed(() => {
  const specs = enrichedMeta.value?.qualities || [];
  if (specs.length) {
    const order = ['viper_atmos', 'high', 'flac', '320', '128'];
    for (const q of order) {
      const hit = specs.find((item) => item.quality === q);
      if (hit) {
        if (q === 'high') return 'Hi-Res';
        if (q === 'flac') return 'FLAC';
        if (q === 'viper_atmos') return 'Atmos';
        if (q === '320') return '320K';
        return '128K';
      }
    }
  }
  const s = song.value;
  if (isCurrentPlayingSong.value && /flac|无损|hi-res/i.test(player.sourceTag)) return 'FLAC';
  if (s?.hashFlac) return 'FLAC';
  if (s?.hash320) return '320K';
  return '128K';
});

const albumPreviewTracks = computed<Song[]>(() => {
  const list = albumDetail.value?.songs || [];
  if (!list.length) return [];
  const curHash = song.value?.hash?.toLowerCase();
  const others = list.filter((item) => !curHash || item.hash.toLowerCase() !== curHash);
  return (others.length ? others : list).slice(0, 5);
});

const dragSheet = useDraggableSheet({
  detents: [0.74, 0.94],
  initialDetentIndex: 1,
  scrollElRef: activeScrollRef,
  onDismiss: () => {
    ui.commentsSheetSong = null;
  },
});

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s <= 0) return '--:--';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatMsShort(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

async function resolveMixSongId(): Promise<number | null> {
  const s = song.value;
  if (!s) return null;
  if (s.mixSongId && s.mixSongId > 0) return s.mixSongId;
  const found = await kugouApi.searchSongs(`${s.title} ${s.artist}`, 1, 5).catch(() => ({ songs: [], total: 0 }));
  const matched =
    found.songs.find((item) => item.hash && s.hash && item.hash.toLowerCase() === s.hash.toLowerCase()) ||
    found.songs[0];
  return matched?.mixSongId ?? null;
}

let activeMixSongId = 0;
let sheetSessionSeq = 0;

async function loadEnrichedTrackDetails(s: Song, seq: number) {
  enrichedMeta.value = null;
  albumDetail.value = null;
  climaxRange.value = null;

  const [meta, climax] = await Promise.all([
    kugouApi.getSongEnrichedMeta(s).catch(() => null),
    s.hash ? kugouApi.getSongClimax(s.hash, (s.duration || 0) * 1000).catch(() => null) : Promise.resolve(null),
  ]);
  if (seq !== sheetSessionSeq) return;
  enrichedMeta.value = meta;
  climaxRange.value = climax;

  const alId =
    (meta?.albumId && meta.albumId !== '0' ? meta.albumId : '') ||
    (s.albumId && s.albumId !== '0' ? s.albumId : '');
  if (alId) {
    const al = await kugouApi.getAlbumDetail(alId).catch(() => null);
    if (seq === sheetSessionSeq && al) {
      albumDetail.value = al;
    }
  }
}

async function fetchComments(reset = true, forceRefresh = false) {
  const s = song.value;
  if (!s) return;
  const reqSeq = sheetSessionSeq;
  const targetMode = subMode.value;
  const targetHotword = selectedHotword.value;
  const bucketKey = currentBucketKey(targetMode, targetHotword);

  if (reset) {
    if (!forceRefresh) {
      const cached = commentBuckets.get(bucketKey);
      if (cached) {
        comments.value = cached.comments;
        page.value = cached.page;
        hasMore.value = cached.hasMore;
        loading.value = false;
        switchingSubMode.value = false;
        return;
      }
    }
    page.value = 1;
    if (comments.value.length > 0) {
      switchingSubMode.value = true;
      loading.value = false;
    } else {
      loading.value = true;
      switchingSubMode.value = false;
    }
  } else {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    page.value += 1;
  }

  try {
    if (!activeMixSongId) {
      const resolved = await resolveMixSongId();
      if (reqSeq !== sheetSessionSeq || currentBucketKey() !== bucketKey) return;
      if (!resolved) {
        totalCount.value = 0;
        hasMore.value = false;
        if (reset) comments.value = [];
        return;
      }
      activeMixSongId = resolved;
    }

    let res;
    if (targetMode === 'hot') {
      res = await kugouApi.getSongCommentsRanked(activeMixSongId, 'hot', page.value);
    } else if (targetMode === 'newest') {
      res = await kugouApi.getSongCommentsRanked(activeMixSongId, 'newest', page.value);
    } else if (targetMode === 'hotword') {
      if (!targetHotword) {
        comments.value = [];
        hasMore.value = false;
        return;
      }
      res = await kugouApi.getSongCommentsByHotword(activeMixSongId, targetHotword, page.value);
    } else {
      res = await kugouApi.getSongComments(activeMixSongId, page.value);
      if (reset) {
        hotwords.value = res.hotwords;
        if (!selectedHotword.value && res.hotwords.length) {
          selectedHotword.value = res.hotwords[0].word;
        }
      }
    }

    if (reqSeq !== sheetSessionSeq || currentBucketKey() !== bucketKey) return;
    if (res.specialId) specialId.value = res.specialId;
    if (res.total > 0 && (targetMode === 'all' || !totalCount.value)) {
      totalCount.value = res.total;
    }
    hasMore.value = res.hasMore;
    if (reset) {
      comments.value = res.comments;
    } else {
      const existing = new Set(comments.value.map((c) => c.id));
      comments.value = [...comments.value, ...res.comments.filter((c) => !existing.has(c.id))];
    }
    saveCurrentBucket(targetMode, targetHotword);
  } catch {
    if (reqSeq === sheetSessionSeq && currentBucketKey() === bucketKey && reset && !comments.value.length) {
      comments.value = [];
    }
    hasMore.value = false;
  } finally {
    if (reqSeq === sheetSessionSeq && currentBucketKey() === bucketKey) {
      loading.value = false;
      switchingSubMode.value = false;
      loadingMore.value = false;
    }
  }
}

watch(
  () => ui.commentsSheetSong,
  (next) => {
    if (!next) return;
    const seq = ++sheetSessionSeq;
    dragSheet.reset();
    commentBuckets.clear();
    comments.value = [];
    floorStates.value = {};
    switchingSubMode.value = false;
    subMode.value = 'all';
    selectedHotword.value = '';
    hotwords.value = [];
    replyTarget.value = null;
    composerText.value = '';
    specialId.value = '';
    activeMixSongId = next.mixSongId || 0;
    totalCount.value = 0;
    if (detailsScrollRef.value) detailsScrollRef.value.scrollTop = 0;
    if (commentsScrollRef.value) commentsScrollRef.value.scrollTop = 0;
    void fetchComments(true, true);
    void loadEnrichedTrackDetails(next, seq);
  },
);

function switchSubMode(next: CommentSubMode) {
  if (subMode.value === next) return;
  echoSystem.haptic('selection');
  subMode.value = next;
  if (next === 'hotword' && !selectedHotword.value && hotwords.value.length) {
    selectedHotword.value = hotwords.value[0].word;
  }
  void fetchComments(true);
}

function selectHotword(word: string) {
  echoSystem.haptic('selection');
  const changed = selectedHotword.value !== word || subMode.value !== 'hotword';
  selectedHotword.value = word;
  subMode.value = 'hotword';
  ui.commentsSheetTab = 'comments';
  if (changed) void fetchComments(true);
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
  if (!spId) {
    ui.showToast(t('comments.empty'));
    return;
  }

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

const likingIds = ref<Record<string, boolean>>({});

async function handleToggleCommentLike(target: SongComment) {
  if (!accounts.isLoggedIn) {
    ui.loginModalOpen = true;
    return;
  }
  const spId = target.specialId || specialId.value;
  if (!spId || likingIds.value[target.id]) return;

  echoSystem.haptic('light');
  const prevLiked = Boolean(target.liked);
  const prevCount = target.likeCount;
  const nextLiked = !prevLiked;

  target.liked = nextLiked;
  target.likeCount = Math.max(0, prevCount + (nextLiked ? 1 : -1));
  likingIds.value = { ...likingIds.value, [target.id]: true };

  try {
    const res = await kugouApi.toggleCommentLike({
      specialId: spId,
      commentId: target.id,
      liked: nextLiked,
    });
    if (!res.ok) {
      target.liked = prevLiked;
      target.likeCount = prevCount;
      ui.showToast(res.message || t('comments.sendFailed'));
    } else {
      if (typeof res.isLiked === 'boolean' && res.isLiked !== target.liked) {
        target.liked = res.isLiked;
        target.likeCount = Math.max(0, prevCount + (res.isLiked ? 1 : -1));
      }
      saveCurrentBucket();
    }
  } catch {
    target.liked = prevLiked;
    target.likeCount = prevCount;
  } finally {
    const nextMap = { ...likingIds.value };
    delete nextMap[target.id];
    likingIds.value = nextMap;
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
        saveCurrentBucket();
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
  const enrichedSong: Song = {
    ...song.value,
    albumId: resolvedAlbumId.value || song.value.albumId,
    album: resolvedAlbumName.value || song.value.album,
    coverUrl: resolvedAlbumCover.value || song.value.coverUrl,
  };
  await openAlbumFromSong(enrichedSong, router, ui, t('album.empty'));
}

async function playChorusHighlight() {
  if (!song.value || !climaxRange.value) return;
  echoSystem.haptic('medium');
  const startMs = climaxRange.value.startMs;
  if (!isCurrentPlayingSong.value) {
    await player.playSong(song.value);
  } else if (!player.isPlaying) {
    await player.togglePlay(true);
  }
  await player.seek(startMs);
  ui.showToast(`${t('comments.detailClimax')} ${formatMsShort(startMs)}`);
}

async function toggleFav() {
  if (!song.value) return;
  echoSystem.haptic('light');
  await player.toggleFavorite(song.value);
}

function playNextInQueue() {
  if (!song.value) return;
  player.addToQueueNext(song.value);
}

function openUnblock() {
  if (!song.value) return;
  const s = song.value;
  ui.commentsSheetSong = null;
  ui.unblockModalSong = s;
}

function playAlbumSibling(track: Song) {
  const list = albumDetail.value?.songs || [track];
  const idx = list.findIndex((item) => item.id === track.id && item.hash === track.hash);
  void player.playQueue(list, idx >= 0 ? idx : 0);
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

function addToPlaylist() {
  if (!song.value) return;
  ui.openAddToPlaylist(song.value);
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

            <!-- Song Header Card -->
            <div class="px-4 pt-1 pb-3 flex items-center gap-3">
              <div class="w-13 h-13 rounded-[12px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-md flex items-center justify-center">
                <img v-if="resolvedAlbumCover" :src="resolvedAlbumCover" class="w-full h-full object-cover" alt="" />
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

            <!-- Main 2-Segment Tabs with Sliding Pill Thumb: Details | Comments (N) -->
            <div class="px-4 pb-2.5 am-hairline-b" @touchstart.stop>
              <div class="pt-seg-group grid-cols-2">
                <div
                  class="pt-seg-thumb"
                  :style="{
                    width: 'calc((100% - 6px) / 2)',
                    transform: `translate3d(${mainTabIndex * 100}%, 0, 0)`,
                  }"
                />
                <button
                  type="button"
                  class="pt-seg-btn bg-transparent"
                  :class="
                    ui.commentsSheetTab === 'details'
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  "
                  @click="switchMainTab('details')"
                >
                  {{ t('comments.tabDetails') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn tabular-nums bg-transparent"
                  :class="
                    ui.commentsSheetTab === 'comments'
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  "
                  @click="switchMainTab('comments')"
                >
                  {{ t('comments.tabComments') }}<template v-if="totalCount > 0"> ({{ formatCompactCount(totalCount, effectiveLocale) }})</template>
                </button>
              </div>
            </div>
          </div>

          <!-- Persistent Dual-Pane Stage: ZERO unmount, ZERO blank frame, ZERO avatar re-decode! -->
          <div class="pt-pane-stage">
            <!-- ==================== PANE A: RICH TRACK DETAILS ==================== -->
            <div
              class="pt-pane flex flex-col overflow-hidden"
              :class="ui.commentsSheetTab === 'details' ? 'is-active' : 'is-before'"
              :aria-hidden="ui.commentsSheetTab !== 'details'"
            >
              <div
                ref="detailsScrollRef"
                class="flex-1 am-scroll px-4 pt-3.5 pb-[calc(var(--safe-bottom)+24px)] space-y-3 overflow-x-hidden"
                @touchstart.passive="dragSheet.onBodyTouchStart"
                @touchmove="dragSheet.onBodyTouchMove"
                @touchend.passive="dragSheet.onBodyTouchEnd"
                @touchcancel.passive="dragSheet.onBodyTouchEnd"
              >
              <!-- Quick Actions Strip -->
              <div class="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  class="py-2.5 px-1.5 rounded-[16px] bg-[var(--bg-card)] border-0 flex flex-col items-center justify-center gap-1 shadow-xs am-tap"
                  @click="toggleFav"
                >
                  <Icon
                    :icon="isFavoriteSong ? iconHeartFilled : iconHeart"
                    class="w-4.5 h-4.5"
                    :class="isFavoriteSong ? 'text-[#ff3b30]' : 'am-accent-text'"
                  />
                  <span class="text-[11px] font-semibold text-[var(--text-primary)] truncate max-w-full">
                    {{ isFavoriteSong ? t('song.unfavorite') : t('song.favorite') }}
                  </span>
                </button>
                <button
                  type="button"
                  class="py-2.5 px-1.5 rounded-[16px] bg-[var(--bg-card)] border-0 flex flex-col items-center justify-center gap-1 shadow-xs am-tap"
                  @click="playNextInQueue"
                >
                  <Icon :icon="iconPlaylistAdd" class="w-4.5 h-4.5 am-accent-text" />
                  <span class="text-[11px] font-semibold text-[var(--text-primary)] truncate max-w-full">
                    {{ t('song.playNext') }}
                  </span>
                </button>
                <button
                  type="button"
                  class="py-2.5 px-1.5 rounded-[16px] bg-[var(--bg-card)] border-0 flex flex-col items-center justify-center gap-1 shadow-xs am-tap"
                  @click="openUnblock"
                >
                  <Icon :icon="iconSparkles" class="w-4.5 h-4.5 am-accent-text" />
                  <span class="text-[11px] font-semibold text-[var(--text-primary)] truncate max-w-full">
                    {{ t('song.unblock') }}
                  </span>
                </button>
                <button
                  type="button"
                  class="py-2.5 px-1.5 rounded-[16px] bg-[var(--bg-card)] border-0 flex flex-col items-center justify-center gap-1 shadow-xs am-tap"
                  @click="openPoster"
                >
                  <Icon :icon="iconPhoto" class="w-4.5 h-4.5 am-accent-text" />
                  <span class="text-[11px] font-semibold text-[var(--text-primary)] truncate max-w-full">
                    {{ t('song.poster') }}
                  </span>
                </button>
              </div>

              <!-- Artist + Album Spotlight Card -->
              <section class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden divide-y divide-[var(--hairline)] shadow-xs">
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

                <!-- Rich Album Row (Auto-populated via privilege_lite even if missing on track!) -->
                <button
                  v-if="resolvedAlbumName || resolvedAlbumId"
                  type="button"
                  class="w-full px-4 py-3 bg-transparent border-0 flex items-center gap-3 text-left am-tap"
                  @click="openAlbum"
                >
                  <div class="w-12 h-12 rounded-[10px] overflow-hidden bg-[var(--bg-subtle)] shrink-0 shadow-xs flex items-center justify-center">
                    <img v-if="resolvedAlbumCover" :src="resolvedAlbumCover" class="w-full h-full object-cover" alt="" />
                    <Icon v-else :icon="iconDisc" class="w-5 h-5 am-accent-text" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[11px] text-[var(--text-secondary)]">{{ t('comments.detailAlbum') }}</div>
                    <div class="text-[14.5px] font-bold text-[var(--text-primary)] truncate mt-0.5">
                      {{ resolvedAlbumName || t('comments.viewFullAlbum') }}
                    </div>
                    <div
                      v-if="albumDetail?.publishDate || albumDetail?.language"
                      class="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5 tabular-nums"
                    >
                      <template v-if="albumDetail?.publishDate">{{ albumDetail.publishDate }}</template>
                      <template v-if="albumDetail?.publishDate && albumDetail?.language"> · </template>
                      <template v-if="albumDetail?.language">{{ albumDetail.language }}</template>
                    </div>
                  </div>
                  <Icon :icon="iconChevronRight" class="w-4.5 h-4.5 text-[var(--text-tertiary)] shrink-0" />
                </button>

                <!-- 3-Metric Telemetry Grid -->
                <div class="px-4 py-3 grid grid-cols-3 gap-2 text-center">
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2.5 px-1">
                    <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                      {{ formatDuration(resolvedDurationSec) }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailDuration') }}</div>
                  </div>
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2.5 px-1">
                    <div class="text-[14px] font-bold text-[var(--text-primary)] tabular-nums">
                      {{ totalCount > 0 ? formatCompactCount(totalCount, effectiveLocale) : '--' }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailComments') }}</div>
                  </div>
                  <div class="rounded-xl bg-[var(--bg-subtle)]/55 py-2.5 px-1">
                    <div class="text-[14px] font-bold am-accent-text truncate">
                      {{ peakQualityLabel }}
                    </div>
                    <div class="text-[10.5px] text-[var(--text-secondary)] mt-0.5">{{ t('comments.detailQuality') }}</div>
                  </div>
                </div>

                <!-- Full Audio Quality Formats Matrix (Bitrate + File Size) -->
                <div v-if="enrichedMeta?.qualities.length" class="px-4 py-3 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-[11.5px] font-medium text-[var(--text-secondary)]">{{ t('comments.detailQualities') }}</span>
                    <span class="text-[11px] font-semibold am-accent-text truncate">
                      {{ isCurrentPlayingSong && player.sourceTag ? player.sourceTag : t('comments.sourceNative') }}
                    </span>
                  </div>
                  <div class="flex flex-wrap gap-1.5">
                    <span
                      v-for="q in enrichedMeta.qualities"
                      :key="q.quality"
                      class="px-2.5 py-1 rounded-xl bg-[var(--bg-subtle)]/75 text-[11.5px] font-semibold text-[var(--text-primary)] inline-flex items-center gap-1 tabular-nums"
                    >
                      <span>{{ q.label }}</span>
                      <span v-if="q.sizeText" class="text-[10.5px] text-[var(--text-tertiary)] font-normal">{{ q.sizeText }}</span>
                    </span>
                  </div>
                </div>

                <!-- Active Source Row Fallback -->
                <div v-else class="px-4 py-3 flex items-center justify-between gap-2">
                  <span class="text-[13px] text-[var(--text-secondary)]">{{ t('comments.detailSource') }}</span>
                  <span class="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {{ isCurrentPlayingSong && player.sourceTag ? player.sourceTag : t('comments.sourceNative') }}
                  </span>
                </div>
              </section>

              <!-- Chorus Highlight Quick Preview Card -->
              <section
                v-if="climaxRange"
                class="rounded-[18px] bg-gradient-to-r from-[var(--accent)]/14 via-[var(--accent)]/6 to-[var(--bg-card)] p-3.5 flex items-center justify-between gap-3 border border-[var(--accent)]/20"
              >
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-9 h-9 rounded-full am-accent-bg text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Icon :icon="iconWaveSine" class="w-4.5 h-4.5" />
                  </div>
                  <div class="min-w-0">
                    <div class="text-[13px] font-bold text-[var(--text-primary)]">{{ t('comments.detailClimax') }}</div>
                    <div class="text-[11.5px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                      {{ formatMsShort(climaxRange.startMs) }} – {{ formatMsShort(climaxRange.endMs) }}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="px-3.5 h-8 rounded-full am-accent-bg text-white text-[12px] font-semibold border-0 inline-flex items-center gap-1 shrink-0 am-tap"
                  @click="playChorusHighlight"
                >
                  <Icon :icon="iconPlayerPlayFilled" class="w-3.5 h-3.5" />
                  <span>{{ t('comments.playClimax') }}</span>
                </button>
              </section>

              <!-- Listener Hotwords Preview Cloud (Tap -> Jump straight to filtered comments!) -->
              <section v-if="hotwords.length" class="rounded-[20px] bg-[var(--bg-card)] p-4 space-y-2.5 shadow-xs">
                <div class="flex items-center justify-between">
                  <span class="text-[12.5px] font-bold text-[var(--text-primary)]">{{ t('comments.detailHotwords') }}</span>
                  <span class="text-[11px] text-[var(--text-tertiary)]">{{ t('comments.hotword') }}</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="hw in hotwords.slice(0, 8)"
                    :key="`det-${hw.word}`"
                    type="button"
                    class="px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[12px] font-semibold text-[var(--text-primary)] border-0 inline-flex items-center gap-1 am-tap"
                    @click="selectHotword(hw.word)"
                  >
                    <span class="am-accent-text">#</span>
                    <span>{{ hw.word }}</span>
                    <span v-if="hw.count" class="text-[10.5px] text-[var(--text-tertiary)] tabular-nums">{{ hw.count }}</span>
                  </button>
                </div>
              </section>

              <!-- More from This Album -->
              <section v-if="albumPreviewTracks.length" class="rounded-[20px] bg-[var(--bg-card)] overflow-hidden shadow-xs">
                <div class="px-4 py-3 flex items-center justify-between am-hairline-b">
                  <span class="text-[13px] font-bold text-[var(--text-primary)]">{{ t('comments.detailAlbumTracks') }}</span>
                  <button
                    type="button"
                    class="text-[12px] font-semibold am-accent-text bg-transparent border-0 p-0 inline-flex items-center gap-0.5 am-tap"
                    @click="openAlbum"
                  >
                    <span>{{ t('comments.viewFullAlbum') }}</span>
                    <Icon :icon="iconChevronRight" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div class="divide-y divide-[var(--hairline)]">
                  <button
                    v-for="(trk, tidx) in albumPreviewTracks"
                    :key="`${trk.id}-${tidx}`"
                    type="button"
                    class="w-full px-4 py-2.5 bg-transparent border-0 flex items-center gap-3 text-left am-tap"
                    @click="playAlbumSibling(trk)"
                  >
                    <span class="w-5 text-[12px] font-bold text-[var(--text-tertiary)] tabular-nums text-center shrink-0">
                      {{ tidx + 1 }}
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="text-[13.5px] font-semibold text-[var(--text-primary)] truncate">{{ trk.title }}</div>
                      <div class="text-[11px] text-[var(--text-secondary)] truncate">{{ trk.artist }}</div>
                    </div>
                    <span class="text-[11px] text-[var(--text-tertiary)] tabular-nums shrink-0">
                      {{ formatDuration(trk.duration) }}
                    </span>
                  </button>
                </div>
              </section>

              <!-- Add to Playlist & Copy Song Meta Dual Action Row -->
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  class="h-10.5 px-3 rounded-[16px] bg-[var(--bg-card)] text-[13px] font-semibold am-accent-text border-0 inline-flex items-center justify-center gap-1.5 shadow-xs am-tap"
                  @click="addToPlaylist"
                >
                  <Icon :icon="iconPlaylistAdd" class="w-4 h-4 shrink-0" />
                  <span class="truncate">{{ t('song.addToPlaylist') }}</span>
                </button>
                <button
                  type="button"
                  class="h-10.5 px-3 rounded-[16px] bg-[var(--bg-card)] text-[13px] font-semibold text-[var(--text-secondary)] border-0 inline-flex items-center justify-center gap-1.5 shadow-xs am-tap"
                  @click="copyMeta"
                >
                  <Icon :icon="iconCopy" class="w-4 h-4 am-accent-text shrink-0" />
                  <span class="truncate">{{ t('song.copyMeta') }}</span>
                </button>
              </div>
              </div>
            </div>

            <!-- ==================== PANE B: 4-MODE REAL COMMENTS + COMPOSER ==================== -->
            <div
              class="pt-pane flex flex-col overflow-hidden"
              :class="ui.commentsSheetTab === 'comments' ? 'is-active' : 'is-after'"
              :aria-hidden="ui.commentsSheetTab !== 'comments'"
            >
              <div
                ref="commentsScrollRef"
                class="flex-1 am-scroll px-4 pt-3.5 pb-6 space-y-3 overflow-x-hidden"
                @touchstart.passive="dragSheet.onBodyTouchStart"
                @touchmove="dragSheet.onBodyTouchMove"
                @touchend.passive="dragSheet.onBodyTouchEnd"
                @touchcancel.passive="dragSheet.onBodyTouchEnd"
              >
              <div class="pt-seg-group grid-cols-4">
                <div
                  class="pt-seg-thumb"
                  :style="{
                    width: 'calc((100% - 6px) / 4)',
                    transform: `translate3d(${subModeIndex * 100}%, 0, 0)`,
                  }"
                />
                <button
                  type="button"
                  class="pt-seg-btn bg-transparent"
                  :class="subMode === 'all' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
                  @click="switchSubMode('all')"
                >
                  {{ t('comments.all') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn bg-transparent"
                  :class="subMode === 'hot' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
                  @click="switchSubMode('hot')"
                >
                  {{ t('comments.hot') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn bg-transparent"
                  :class="subMode === 'newest' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
                  @click="switchSubMode('newest')"
                >
                  {{ t('comments.newest') }}
                </button>
                <button
                  type="button"
                  class="pt-seg-btn bg-transparent"
                  :class="subMode === 'hotword' ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
                  @click="switchSubMode('hotword')"
                >
                  {{ t('comments.hotword') }}
                </button>
              </div>

              <!-- Real Hotword Chips (from KuGou hot_word_list[].content) -->
              <div v-if="subMode === 'hotword' && hotwords.length" class="flex items-center gap-1.5 am-hscroll pb-0.5">
                <button
                  v-for="hw in hotwords"
                  :key="hw.word"
                  type="button"
                  class="px-3 h-7 rounded-full text-[12px] font-semibold border-0 shrink-0 transition-colors inline-flex items-center gap-1 am-tap"
                  :class="
                    selectedHotword === hw.word
                      ? 'am-accent-bg text-white shadow-xs'
                      : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                  "
                  @click="selectHotword(hw.word)"
                >
                  <span># {{ hw.word }}</span>
                  <span v-if="hw.count" class="text-[10.5px] opacity-75 tabular-nums">{{ hw.count }}</span>
                </button>
              </div>

              <!-- Loading Skeleton -->
              <div v-if="loading" class="py-12 text-center text-[13px] text-[var(--text-secondary)]">
                {{ t('comments.loading') }}
              </div>

              <!-- No Hotwords State -->
              <div
                v-else-if="subMode === 'hotword' && !hotwords.length"
                class="py-12 text-center text-[13px] text-[var(--text-secondary)]"
              >
                {{ t('comments.noHotwords') }}
              </div>

              <!-- Empty State -->
              <div v-else-if="!comments.length" class="py-12 text-center text-[13px] text-[var(--text-secondary)]">
                {{ t('comments.empty') }}
              </div>

              <!-- Comment Cards (gently dims on uncached sub-tab load instead of wiping blank!) -->
              <div v-else class="space-y-2.5 transition-opacity duration-150" :class="{ 'opacity-55': switchingSubMode }">
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

                    <button
                      type="button"
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border-0 text-[11px] font-semibold tabular-nums shrink-0 transition-colors am-tap"
                      :class="
                        cmt.liked
                          ? 'am-accent-bg text-white shadow-xs'
                          : 'bg-[var(--bg-subtle)]/75 text-[var(--text-secondary)]'
                      "
                      :disabled="Boolean(likingIds[cmt.id])"
                      @click="handleToggleCommentLike(cmt)"
                    >
                      <Icon
                        :icon="cmt.liked ? iconThumbUpFilled : iconThumbUp"
                        class="w-3.5 h-3.5"
                        :class="cmt.liked ? 'text-white' : 'am-accent-text'"
                      />
                      <span>{{ formatCompactCount(cmt.likeCount, effectiveLocale) }}</span>
                    </button>
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
                      v-if="floorStates[cmt.id]?.loading && !floorStates[cmt.id]?.replies.length"
                      class="text-[12px] text-[var(--text-secondary)]"
                    >
                      {{ t('common.loading') }}
                    </div>
                    <div
                      v-else-if="!(floorStates[cmt.id]?.replies?.length)"
                      class="text-[12px] text-[var(--text-tertiary)]"
                    >
                      {{ t('comments.empty') }}
                    </div>
                    <div
                      v-for="rep in floorStates[cmt.id]?.replies || []"
                      :key="rep.id"
                      class="space-y-0.5"
                    >
                      <div class="flex items-center justify-between gap-2 text-[11.5px]">
                        <span class="font-bold text-[var(--text-primary)] truncate">
                          {{ rep.userName }}
                          <template v-if="rep.replyToUser">
                            <span class="font-normal text-[var(--text-tertiary)]"> ▸ {{ rep.replyToUser }}</span>
                          </template>
                        </span>
                        <div class="inline-flex items-center gap-2 shrink-0">
                          <span class="text-[10.5px] text-[var(--text-tertiary)] tabular-nums">{{ rep.addTime }}</span>
                          <button
                            type="button"
                            class="inline-flex items-center gap-0.5 bg-transparent border-0 p-0 text-[10.5px] font-semibold tabular-nums am-tap"
                            :class="rep.liked ? 'am-accent-text' : 'text-[var(--text-tertiary)]'"
                            :disabled="Boolean(likingIds[rep.id])"
                            @click="handleToggleCommentLike(rep)"
                          >
                            <Icon :icon="rep.liked ? iconThumbUpFilled : iconThumbUp" class="w-3 h-3" />
                            <span v-if="rep.likeCount > 0">{{ formatCompactCount(rep.likeCount, effectiveLocale) }}</span>
                          </button>
                        </div>
                      </div>
                      <p class="text-[12.5px] leading-snug text-[var(--text-primary)]/90 whitespace-pre-wrap break-words m-0">
                        {{ rep.content }}
                      </p>
                    </div>
                    <button
                      v-if="floorStates[cmt.id]?.hasMore"
                      type="button"
                      class="text-[11.5px] font-semibold am-accent-text bg-transparent border-0 p-0 am-tap"
                      :disabled="floorStates[cmt.id]?.loading"
                      @click="loadMoreFloorReplies(cmt)"
                    >
                      {{ floorStates[cmt.id]?.loading ? t('common.loading') : t('common.loadMore') }}
                    </button>
                  </div>
                </article>

                <button
                  v-if="hasMore"
                  type="button"
                  class="w-full h-10 rounded-2xl bg-[var(--bg-subtle)] text-[13px] font-semibold am-accent-text border-0 am-tap"
                  :disabled="loadingMore"
                  @click="fetchComments(false)"
                >
                  {{ loadingMore ? t('common.loading') : t('common.loadMore') }}
                </button>
              </div>
              </div>

              <!-- IME-Aware Bottom Comment / Reply Composer (Solid surface inside Pane B: zero flex jump & zero nested blur!) -->
              <div
                class="shrink-0 px-4 pt-2.5 am-hairline-t bg-[var(--bg-card)] space-y-1.5"
                :style="{ paddingBottom: `calc(max(var(--safe-bottom), var(--ime-height)) + 10px)` }"
              >
            <div v-if="replyTarget" class="flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl bg-[var(--bg-subtle)]/75 text-[11.5px]">
              <span class="text-[var(--text-secondary)] truncate">
                {{ t('comments.replyingTo', { user: replyTarget.userName }) }}
              </span>
              <button
                type="button"
                class="bg-transparent border-0 p-0.5 text-[var(--text-tertiary)]"
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
                class="flex-1 h-10 px-3.5 rounded-full bg-[var(--bg-subtle)] text-[13.5px] text-[var(--text-primary)] border-0 outline-none"
                @focus="!accounts.isLoggedIn && (ui.loginModalOpen = true)"
              />
              <button
                type="submit"
                class="px-4 h-10 rounded-full am-accent-bg text-white text-[13px] font-semibold border-0 inline-flex items-center gap-1 am-tap shrink-0 disabled:opacity-45"
                :disabled="sending || !composerText.trim()"
              >
                <Icon :icon="iconSend" class="w-3.5 h-3.5" />
                <span>{{ t('comments.send') }}</span>
              </button>
            </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
