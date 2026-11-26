import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { CoverPalette, ParsedLyrics, PlayMode, Song, UnblockCandidate } from '@/types/music';
import { echoPlayer } from '@/native/echoPlayer';
import { echoSystem } from '@/native/echoSystem';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { resolvePlayableStream } from '@/services/playback/urlResolver';
import { fetchLyricsForSong } from '@/services/playback/krcParser';
import { DEFAULT_APPLE_PALETTE, extractPaletteFromCoverUrl } from '@/services/playback/coverPalette';
import { pinSourceForSong, resolveCandidateUrl } from '@/services/playback/unblockEngine';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

const RECENT_KEY = 'player.recent.v1';
const QUEUE_KEY = 'player.queue.v1';

interface PersistedQueue {
  queue: Song[];
  currentIndex: number;
  playMode: PlayMode;
}

export const usePlayerStore = defineStore('player', () => {
  const queue = ref<Song[]>([]);
  const currentIndex = ref<number>(-1);
  const playMode = ref<PlayMode>('sequence');
  const isPlaying = ref(false);
  const isBuffering = ref(false);
  const isResolving = ref(false);
  const currentTimeMs = ref(0);
  const durationMs = ref(0);
  const sourceTag = ref('');
  const palette = ref<CoverPalette>(DEFAULT_APPLE_PALETTE);

  const lyrics = ref<ParsedLyrics>({
    lines: [],
    hasWordTiming: false,
    hasTranslation: false,
    source: 'none',
  });
  const lyricsLoading = ref(false);

  const recentPlays = ref<Song[]>([]);
  const favoriteHashes = ref<Set<string>>(new Set());
  const favoriteListId = ref<string>('');

  // High-frequency interpolation anchor for 60fps KRC karaoke
  const lastSampleTimeMs = ref(0);
  const lastSampleAt = ref(0);

  let trackSeq = 0;
  let listenersBound = false;

  const settingsStore = useSettingsStore();

  const currentSong = computed<Song | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= queue.value.length) return null;
    return queue.value[currentIndex.value] || null;
  });

  const isCurrentFavorite = computed(() => {
    const h = currentSong.value?.hash?.toLowerCase();
    return Boolean(h && favoriteHashes.value.has(h));
  });

  function applyPaletteToCss(p: CoverPalette) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--accent-light', p.accentLight);
    root.style.setProperty('--accent-dark', p.accentDark);
    root.style.setProperty('--fluid-1', p.fluidColors[0]);
    root.style.setProperty('--fluid-2', p.fluidColors[1]);
    root.style.setProperty('--fluid-3', p.fluidColors[2]);
    root.style.setProperty('--fluid-4', p.fluidColors[3]);
  }

  watch(palette, applyPaletteToCss, { immediate: true });

  async function persistQueue() {
    await echoSystem.kvSetJson(QUEUE_KEY, {
      queue: queue.value.slice(0, 120),
      currentIndex: currentIndex.value,
      playMode: playMode.value,
    });
  }

  function pushRecent(song: Song) {
    const filtered = recentPlays.value.filter((s) => s.id !== song.id && s.hash !== song.hash);
    recentPlays.value = [song, ...filtered].slice(0, 60);
    void echoSystem.kvSetJson(RECENT_KEY, recentPlays.value);
  }

  async function bindNativeListeners() {
    if (listenersBound) return;
    listenersBound = true;

    await echoPlayer.onTimeUpdate((ev) => {
      if (ev.trackSeq !== trackSeq) return;
      currentTimeMs.value = ev.currentTimeMs;
      if (ev.durationMs > 0) durationMs.value = ev.durationMs;
      lastSampleTimeMs.value = ev.currentTimeMs;
      lastSampleAt.value = ev.sampledAt || Date.now();
    });

    await echoPlayer.onStateChange((ev) => {
      if (ev.trackSeq !== trackSeq) return;
      isPlaying.value = ev.isPlaying;
      isBuffering.value = ev.isBuffering;
      if (ev.ended) {
        void handleTrackEnded();
      }
    });

    await echoPlayer.onError((ev) => {
      if (ev.trackSeq !== trackSeq) return;
      isPlaying.value = false;
      isBuffering.value = false;
      const ui = useUiStore();
      ui.showToast(`播放异常：${ev.message}`);
    });

    await echoPlayer.onMediaCommand((ev) => {
      if (ev.command === 'next') void next();
      else if (ev.command === 'previous') void previous();
      else if (ev.command === 'play') void togglePlay(true);
      else if (ev.command === 'pause') void togglePlay(false);
      else if (ev.command === 'seek' && typeof ev.positionMs === 'number') void seek(ev.positionMs);
    });
  }

  async function hydrate() {
    await bindNativeListeners();
    const [savedRecent, savedQueue] = await Promise.all([
      echoSystem.kvGetJson<Song[]>(RECENT_KEY, []),
      echoSystem.kvGetJson<PersistedQueue>(QUEUE_KEY, { queue: [], currentIndex: -1, playMode: 'sequence' }),
    ]);
    recentPlays.value = Array.isArray(savedRecent) ? savedRecent : [];
    queue.value = Array.isArray(savedQueue.queue) ? savedQueue.queue : [];
    currentIndex.value =
      savedQueue.currentIndex >= 0 && savedQueue.currentIndex < queue.value.length
        ? savedQueue.currentIndex
        : queue.value.length > 0
          ? 0
          : -1;
    playMode.value = savedQueue.playMode || 'sequence';

    if (currentSong.value) {
      durationMs.value = (currentSong.value.duration || 0) * 1000;
      void refreshCoverPalette(currentSong.value.coverUrl);
      void loadLyrics(currentSong.value);
    }
  }

  async function refreshCoverPalette(coverUrl: string) {
    const p = await extractPaletteFromCoverUrl(coverUrl);
    palette.value = p;
  }

  async function loadLyrics(song: Song) {
    lyricsLoading.value = true;
    lyrics.value = { lines: [], hasWordTiming: false, hasTranslation: false, source: 'none' };
    const reqSeq = trackSeq;
    try {
      const parsed = await fetchLyricsForSong(song);
      if (reqSeq === trackSeq) {
        lyrics.value = parsed;
      }
    } finally {
      if (reqSeq === trackSeq) lyricsLoading.value = false;
    }
  }

  async function loadAndPlayCurrent(autoPlay = true, customUrl?: { url: string; sourceTag: string }) {
    const song = currentSong.value;
    if (!song) return;
    const seq = ++trackSeq;
    isResolving.value = true;
    isBuffering.value = true;
    currentTimeMs.value = 0;
    lastSampleTimeMs.value = 0;
    lastSampleAt.value = Date.now();
    durationMs.value = (song.duration || 0) * 1000;
    sourceTag.value = customUrl?.sourceTag || '';

    void refreshCoverPalette(song.coverUrl);
    void loadLyrics(song);
    pushRecent(song);
    void persistQueue();

    const ui = useUiStore();
    try {
      let playUrl = customUrl?.url || '';
      let tag = customUrl?.sourceTag || '';
      if (!playUrl) {
        const resolved = await resolvePlayableStream(song, settingsStore.quality, {
          enableUnblock: settingsStore.enableUnblock,
          externalPlatforms: settingsStore.unblockPlatforms,
        });
        if (seq !== trackSeq) return;
        playUrl = resolved.url;
        tag = resolved.sourceTag;
      }

      sourceTag.value = tag;
      await echoPlayer.setRepeatOne(playMode.value === 'repeat-one');
      await echoPlayer.load({
        url: playUrl,
        metadata: {
          title: song.title,
          artist: song.artist,
          album: song.album,
          coverUrl: song.coverUrl,
          durationMs: (song.duration || 0) * 1000,
        },
        autoPlay,
        trackSeq: seq,
      });
      if (seq === trackSeq) {
        isPlaying.value = autoPlay;
      }
    } catch (err: any) {
      if (seq !== trackSeq) return;
      isPlaying.value = false;
      isBuffering.value = false;
      ui.showToast(err?.message || '播放失败，可尝试手动换源');
    } finally {
      if (seq === trackSeq) isResolving.value = false;
    }
  }

  async function playSong(song: Song, newQueue?: Song[]) {
    if (newQueue && newQueue.length > 0) {
      queue.value = [...newQueue];
      const idx = queue.value.findIndex((s) => s.id === song.id && s.hash === song.hash);
      currentIndex.value = idx >= 0 ? idx : 0;
    } else {
      const existingIdx = queue.value.findIndex((s) => s.id === song.id && s.hash === song.hash);
      if (existingIdx >= 0) {
        currentIndex.value = existingIdx;
      } else {
        const insertAt = currentIndex.value >= 0 ? currentIndex.value + 1 : 0;
        queue.value.splice(insertAt, 0, song);
        currentIndex.value = insertAt;
      }
    }
    if (playMode.value === 'fm') playMode.value = 'sequence';
    await loadAndPlayCurrent(true);
  }

  async function playQueue(songs: Song[], startIndex = 0, mode?: PlayMode) {
    if (!songs.length) return;
    queue.value = [...songs];
    currentIndex.value = Math.max(0, Math.min(startIndex, songs.length - 1));
    if (mode) playMode.value = mode;
    else if (playMode.value === 'fm') playMode.value = 'sequence';
    await loadAndPlayCurrent(true);
  }

  async function playPersonalFm() {
    const ui = useUiStore();
    try {
      const tracks = await kugouApi.getPersonalFm();
      if (!tracks.length) {
        ui.showToast('私人 FM 暂无推荐歌曲，请先登录');
        return;
      }
      await playQueue(tracks, 0, 'fm');
    } catch {
      ui.showToast('加载私人 FM 失败');
    }
  }

  async function togglePlay(forceState?: boolean) {
    if (!currentSong.value) return;
    const target = forceState !== undefined ? forceState : !isPlaying.value;
    if (target) {
      if (trackSeq === 0) {
        await loadAndPlayCurrent(true);
        return;
      }
      await echoPlayer.play();
      isPlaying.value = true;
    } else {
      await echoPlayer.pause();
      isPlaying.value = false;
    }
  }

  async function handleTrackEnded() {
    if (playMode.value === 'repeat-one') {
      await seek(0);
      await echoPlayer.play();
      return;
    }
    await next();
  }

  async function next() {
    if (!queue.value.length) return;
    if (playMode.value === 'shuffle' && queue.value.length > 1) {
      let nextIdx = currentIndex.value;
      while (nextIdx === currentIndex.value) {
        nextIdx = Math.floor(Math.random() * queue.value.length);
      }
      currentIndex.value = nextIdx;
      await loadAndPlayCurrent(true);
      return;
    }

    if (currentIndex.value + 1 < queue.value.length) {
      currentIndex.value += 1;
      await loadAndPlayCurrent(true);
    } else if (playMode.value === 'fm') {
      const more = await kugouApi.getPersonalFm().catch(() => []);
      if (more.length > 0) {
        const nextIdx = queue.value.length;
        queue.value.push(...more);
        currentIndex.value = nextIdx;
        await loadAndPlayCurrent(true);
      }
    } else {
      currentIndex.value = 0;
      await loadAndPlayCurrent(true);
    }
  }

  async function previous() {
    if (!queue.value.length) return;
    if (currentTimeMs.value > 5000) {
      await seek(0);
      return;
    }
    currentIndex.value = (currentIndex.value - 1 + queue.value.length) % queue.value.length;
    await loadAndPlayCurrent(true);
  }

  async function seek(positionMs: number) {
    const clamped = Math.max(0, Math.min(durationMs.value || positionMs, positionMs));
    currentTimeMs.value = clamped;
    lastSampleTimeMs.value = clamped;
    lastSampleAt.value = Date.now();
    await echoPlayer.seek(clamped);
  }

  function cyclePlayMode() {
    const order: PlayMode[] = ['sequence', 'shuffle', 'repeat-one'];
    const idx = order.indexOf(playMode.value === 'fm' ? 'sequence' : playMode.value);
    playMode.value = order[(idx + 1) % order.length];
    void echoPlayer.setRepeatOne(playMode.value === 'repeat-one');
    void persistQueue();
  }

  function addToQueueNext(song: Song) {
    const ui = useUiStore();
    if (!queue.value.length) {
      void playSong(song);
      return;
    }
    const existing = queue.value.findIndex((s) => s.id === song.id && s.hash === song.hash);
    if (existing >= 0 && existing !== currentIndex.value) {
      queue.value.splice(existing, 1);
      if (existing < currentIndex.value) currentIndex.value -= 1;
    }
    if (existing !== currentIndex.value) {
      queue.value.splice(currentIndex.value + 1, 0, song);
    }
    void persistQueue();
    ui.showToast(`已添加到下一首播放`);
  }

  function removeFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return;
    const removingCurrent = index === currentIndex.value;
    queue.value.splice(index, 1);
    if (queue.value.length === 0) {
      currentIndex.value = -1;
      void echoPlayer.stop();
      isPlaying.value = false;
    } else if (removingCurrent) {
      currentIndex.value = Math.min(index, queue.value.length - 1);
      void loadAndPlayCurrent(isPlaying.value);
    } else if (index < currentIndex.value) {
      currentIndex.value -= 1;
    }
    void persistQueue();
  }

  async function applyUnblockCandidate(song: Song, candidate: UnblockCandidate, pin: boolean) {
    const ui = useUiStore();
    const resolved = await resolveCandidateUrl(candidate, settingsStore.quality);
    if (!resolved?.url) {
      ui.showToast('该候选音源解析失败，请换一个试试');
      return false;
    }
    if (pin) {
      await pinSourceForSong(song, candidate, resolved.url);
    }
    const tag =
      candidate.channel === 'kugou-alt'
        ? '酷狗异版'
        : `解灰 · ${(candidate.sourcePlatform || 'EXT').toUpperCase()}`;

    const isCurrent = currentSong.value && currentSong.value.hash === song.hash && currentSong.value.id === song.id;
    if (isCurrent) {
      await loadAndPlayCurrent(true, { url: resolved.url, sourceTag: tag });
    } else {
      await playSong(song);
    }
    ui.showToast(pin ? `已切换并锁定：${tag}` : `正在试听：${tag}`);
    return true;
  }

  async function syncFavoritesFromPlaylist(listId: string, tracks: Song[]) {
    favoriteListId.value = listId;
    const set = new Set<string>();
    for (const s of tracks) {
      if (s.hash) set.add(s.hash.toLowerCase());
    }
    favoriteHashes.value = set;
  }

  async function toggleFavorite(song: Song) {
    const ui = useUiStore();
    const key = song.hash?.toLowerCase();
    if (!key) return;
    if (!favoriteListId.value) {
      ui.showToast('请先登录并加载“我喜欢”歌单');
      return;
    }
    if (favoriteHashes.value.has(key)) {
      favoriteHashes.value.delete(key);
      favoriteHashes.value = new Set(favoriteHashes.value);
      ui.showToast('已从本地标记移除');
      return;
    }
    try {
      await kugouApi.addTracksToPlaylist(favoriteListId.value, [song]);
      favoriteHashes.value.add(key);
      favoriteHashes.value = new Set(favoriteHashes.value);
      ui.showToast('已收藏到“我喜欢”');
    } catch {
      ui.showToast('收藏失败，请检查登录状态');
    }
  }

  function getInterpolatedTimeMs(): number {
    if (!isPlaying.value) return currentTimeMs.value;
    if (lastSampleAt.value <= 0) return currentTimeMs.value;
    const elapsed = Math.max(0, Math.min(450, Date.now() - lastSampleAt.value));
    return currentTimeMs.value + elapsed;
  }

  return {
    queue,
    currentIndex,
    currentSong,
    playMode,
    isPlaying,
    isBuffering,
    isResolving,
    currentTimeMs,
    durationMs,
    sourceTag,
    palette,
    lyrics,
    lyricsLoading,
    recentPlays,
    favoriteHashes,
    isCurrentFavorite,
    hydrate,
    playSong,
    playQueue,
    playPersonalFm,
    togglePlay,
    next,
    previous,
    seek,
    cyclePlayMode,
    addToQueueNext,
    removeFromQueue,
    applyUnblockCandidate,
    syncFavoritesFromPlaylist,
    toggleFavorite,
    getInterpolatedTimeMs,
  };
});
