import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { SafeAreaInsets } from '@/native/echoSystem';
import type { PlaylistActionContext, Song, SongArtistRef } from '@/types/music';
import type { ReleaseUpdateInfo } from '@/services/update/updateService';
import { echoSystem } from '@/native/echoSystem';

export const useUiStore = defineStore('ui', () => {
  const nowPlayingOpen = ref(false);
  const nowPlayingMode = ref<'cover' | 'lyrics' | 'queue'>('cover');
  const accountSheetOpen = ref(false);
  const loginModalOpen = ref(false);
  const actionSheetSong = ref<Song | null>(null);
  const actionSheetContext = ref<PlaylistActionContext | null>(null);
  const addToPlaylistSongs = ref<Song[] | null>(null);
  const unblockModalSong = ref<Song | null>(null);
  const lyricPosterSong = ref<Song | null>(null);
  const commentsSheetSong = ref<Song | null>(null);
  const commentsSheetTab = ref<'details' | 'comments'>('comments');
  const artistPickerCandidates = ref<SongArtistRef[] | null>(null);
  const updateReleaseInfo = ref<ReleaseUpdateInfo | null>(null);
  const complianceModalOpen = ref(false);
  /** When true (e.g. playlist batch selection), AppShell smoothly hides MiniPlayer & TabBar for a bottom takeover dock. */
  const batchDockActive = ref(false);
  let batchExitHandler: (() => void) | null = null;
  /** Incrementing counter to smoothly replay the moonlit brand splash from Settings -> About. */
  const splashReplaySeq = ref(0);

  const toastMessage = ref('');
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const insets = ref<SafeAreaInsets>({ top: 0, bottom: 0, left: 0, right: 0, imeBottom: 0 });

  const hasModalOverlay = computed(() =>
    Boolean(
      nowPlayingOpen.value ||
        accountSheetOpen.value ||
        loginModalOpen.value ||
        actionSheetSong.value ||
        addToPlaylistSongs.value?.length ||
        unblockModalSong.value ||
        lyricPosterSong.value ||
        commentsSheetSong.value ||
        artistPickerCandidates.value ||
        updateReleaseInfo.value ||
        complianceModalOpen.value,
    ),
  );

  function applyInsetsToCss(val: SafeAreaInsets) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--safe-top', `${Math.max(0, val.top)}px`);
    root.style.setProperty('--safe-bottom', `${Math.max(0, val.bottom)}px`);
    root.style.setProperty('--ime-height', `${Math.max(0, val.imeBottom)}px`);
  }

  async function initSystemInsets() {
    const initial = await echoSystem.getInsets();
    insets.value = initial;
    applyInsetsToCss(initial);
    await echoSystem.onInsetsChange((next) => {
      insets.value = next;
      applyInsetsToCss(next);
    });
  }

  function showToast(msg: string, durationMs = 2400) {
    toastMessage.value = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage.value = '';
    }, durationMs);
  }

  function openNowPlaying(mode: 'cover' | 'lyrics' | 'queue' = 'cover') {
    echoSystem.haptic('light');
    nowPlayingMode.value = mode;
    nowPlayingOpen.value = true;
  }

  function openSongComments(song: Song, tab: 'details' | 'comments' = 'comments') {
    echoSystem.haptic('light');
    commentsSheetTab.value = tab;
    commentsSheetSong.value = song;
  }

  function openSongActions(song: Song, context: PlaylistActionContext | null = null) {
    echoSystem.haptic('light');
    actionSheetContext.value = context;
    actionSheetSong.value = song;
  }

  function closeSongActions() {
    actionSheetSong.value = null;
    actionSheetContext.value = null;
  }

  function openAddToPlaylist(songOrSongs: Song | Song[]) {
    const list = Array.isArray(songOrSongs) ? songOrSongs.filter(Boolean) : [songOrSongs];
    if (!list.length) return;
    echoSystem.haptic('light');
    addToPlaylistSongs.value = list;
  }

  function setBatchDock(active: boolean, onExit?: (() => void) | null) {
    batchDockActive.value = active;
    batchExitHandler = active ? (onExit ?? null) : null;
  }

  function replaySplash() {
    echoSystem.haptic('light');
    accountSheetOpen.value = false;
    splashReplaySeq.value += 1;
  }

  function closeTopOverlay(): boolean {
    if (complianceModalOpen.value) {
      return true;
    }
    if (addToPlaylistSongs.value?.length) {
      addToPlaylistSongs.value = null;
      return true;
    }
    if (artistPickerCandidates.value) {
      artistPickerCandidates.value = null;
      return true;
    }
    if (updateReleaseInfo.value) {
      updateReleaseInfo.value = null;
      return true;
    }
    if (lyricPosterSong.value) {
      lyricPosterSong.value = null;
      return true;
    }
    if (commentsSheetSong.value) {
      commentsSheetSong.value = null;
      return true;
    }
    if (unblockModalSong.value) {
      unblockModalSong.value = null;
      return true;
    }
    if (actionSheetSong.value) {
      closeSongActions();
      return true;
    }
    if (loginModalOpen.value) {
      loginModalOpen.value = false;
      return true;
    }
    if (accountSheetOpen.value) {
      accountSheetOpen.value = false;
      return true;
    }
    if (nowPlayingOpen.value) {
      nowPlayingOpen.value = false;
      return true;
    }
    if (batchDockActive.value) {
      const handler = batchExitHandler;
      setBatchDock(false);
      handler?.();
      return true;
    }
    return false;
  }

  return {
    nowPlayingOpen,
    nowPlayingMode,
    accountSheetOpen,
    loginModalOpen,
    actionSheetSong,
    actionSheetContext,
    addToPlaylistSongs,
    unblockModalSong,
    lyricPosterSong,
    commentsSheetSong,
    commentsSheetTab,
    artistPickerCandidates,
    updateReleaseInfo,
    complianceModalOpen,
    batchDockActive,
    splashReplaySeq,
    hasModalOverlay,
    toastMessage,
    insets,
    initSystemInsets,
    showToast,
    openNowPlaying,
    openSongComments,
    openSongActions,
    closeSongActions,
    openAddToPlaylist,
    setBatchDock,
    replaySplash,
    closeTopOverlay,
  };
});
