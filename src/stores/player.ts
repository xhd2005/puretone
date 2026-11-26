import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { CoverPalette, ParsedLyrics, PlayMode, SleepTimerMode, Song, UnblockCandidate } from '@/types/music';
import { echoPlayer } from '@/native/echoPlayer';
import { echoSystem } from '@/native/echoSystem';
import { kugouApi, stripAudioExtension } from '@/services/kugou/kugouEngine';
import { clearCachedResolvedStream, resolvePlayableStream } from '@/services/playback/urlResolver';
import { fetchLyricsForSong } from '@/services/playback/krcParser';
import { DEFAULT_APPLE_PALETTE, extractPaletteFromCoverUrl } from '@/services/playback/coverPalette';
import { getTrackKey, pinSourceForSong, resolveCandidateUrl } from '@/services/playback/unblockEngine';
import { useSettingsStore } from './settings';
import { useStatsStore } from './stats';
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
  const favoriteFileIds = ref<Map<string, number>>(new Map());
  const favoriteListId = ref<string>('');
  const favoriteGlobalId = ref<string>('');

  // Sleep timer state
  const sleepTimerMode = ref<SleepTimerMode>('off');
  const sleepRemainingSec = ref<number>(0);
  let sleepInterval: ReturnType<typeof setInterval> | null = null;

  // High-frequency interpolation anchor for 60fps KRC karaoke
  const lastSampleTimeMs = ref(0);
  const lastSampleAt = ref(0);

  let trackSeq = 0;
  let listenersBound = false;
  let notifPromptedThisSession = false;
  let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  let shuffleNextIndexCache = -1;
  let lastLiveLyricSent = '';
  let lastStatSampleAt = 0;

  const settingsStore = useSettingsStore();
  const statsStore = useStatsStore();

  const currentSong = computed<Song | null>(() => {
    if (currentIndex.value < 0 || currentIndex.value >= queue.value.length) return null;
    return queue.value[currentIndex.value] || null;
  });

  const isCurrentFavorite = computed(() => {
    const h = currentSong.value?.hash?.toLowerCase();
    return Boolean(h && favoriteHashes.value.has(h));
  });

  const sleepTimerBadge = computed(() => {
    if (sleepTimerMode.value === 'off') return '';
    if (sleepTimerMode.value === 'track') return '本曲后停';
    const sec = Math.max(0, sleepRemainingSec.value);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  function applyPaletteToCss(p: CoverPalette) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const useClassicRed = settingsStore.accentMode === 'apple-red';
    root.style.setProperty('--accent-light', useClassicRed ? DEFAULT_APPLE_PALETTE.accentLight : p.accentLight);
    root.style.setProperty('--accent-dark', useClassicRed ? DEFAULT_APPLE_PALETTE.accentDark : p.accentDark);
    root.style.setProperty('--fluid-1', p.fluidColors[0]);
    root.style.setProperty('--fluid-2', p.fluidColors[1]);
    root.style.setProperty('--fluid-3', p.fluidColors[2]);
    root.style.setProperty('--fluid-4', p.fluidColors[3]);
  }

  watch([palette, () => settingsStore.accentMode], ([p]) => applyPaletteToCss(p), { immediate: true });
  watch(isCurrentFavorite, (fav) => {
    void echoPlayer.setFavoriteState(fav);
  });
  watch(playMode, (mode) => {
    void echoPlayer.setPlayModeState(mode);
  });

  async function persistQueue() {
    // Persist up to 200 items centered around currentIndex for fast startup
    const total = queue.value.length;
    if (total <= 200) {
      await echoSystem.kvSetJson(QUEUE_KEY, {
        queue: queue.value,
        currentIndex: currentIndex.value,
        playMode: playMode.value,
      });
      return;
    }
    const start = Math.max(0, currentIndex.value - 50);
    const sliced = queue.value.slice(start, start + 200);
    await echoSystem.kvSetJson(QUEUE_KEY, {
      queue: sliced,
      currentIndex: Math.max(0, currentIndex.value - start),
      playMode: playMode.value,
    });
  }

  function pushRecent(song: Song) {
    const clean: Song = {
      ...song,
      title: stripAudioExtension(song.title) || song.title,
      artist: stripAudioExtension(song.artist) || song.artist,
    };
    const filtered = recentPlays.value.filter((s) => s.id !== clean.id && s.hash !== clean.hash);
    recentPlays.value = [clean, ...filtered].slice(0, 120);
    void echoSystem.kvSetJson(RECENT_KEY, recentPlays.value);
  }

  function clearRecentPlays() {
    recentPlays.value = [];
    void echoSystem.kvSetJson(RECENT_KEY, []);
  }

  function syncLockScreenLyricLine(posMs: number) {
    if (!settingsStore.showLockScreenLyrics || !isPlaying.value) return;
    const lines = lyrics.value.lines;
    if (!lines.length) return;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].startMs <= posMs + 120) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const text = ans >= 0 ? lines[ans].text.trim() : '';
    if (text && text !== lastLiveLyricSent) {
      lastLiveLyricSent = text;
      void echoPlayer.setLiveLyric(text);
    }
  }

  function clearSleepTimer() {
    if (sleepInterval) {
      clearInterval(sleepInterval);
      sleepInterval = null;
    }
    sleepTimerMode.value = 'off';
    sleepRemainingSec.value = 0;
  }

  function setSleepTimer(mode: SleepTimerMode) {
    clearSleepTimer();
    sleepTimerMode.value = mode;
    echoSystem.haptic('selection');
    const ui = useUiStore();
    if (mode === 'off') {
      ui.showToast('已关闭睡眠定时');
      return;
    }
    if (mode === 'track') {
      ui.showToast('已设定：播完当前曲目后柔和停止');
      return;
    }
    const mins = Number(mode);
    sleepRemainingSec.value = mins * 60;
    ui.showToast(`睡眠定时已开启：${mins} 分钟后柔和淡出暂停`);
    sleepInterval = setInterval(() => {
      if (sleepRemainingSec.value <= 1) {
        clearSleepTimer();
        if (isPlaying.value) {
          void echoPlayer.fadeOutAndPause(3000);
          isPlaying.value = false;
        }
        useUiStore().showToast('睡眠定时已到，晚安');
        return;
      }
      sleepRemainingSec.value -= 1;
    }, 1000);
  }

  async function ensureNotificationReadyForMedia() {
    if (notifPromptedThisSession) return;
    notifPromptedThisSession = true;
    try {
      const check = await echoSystem.checkNotificationPermission();
      if (!check.granted) {
        await echoSystem.requestNotificationPermission();
      }
    } catch {
      // non-fatal
    }
  }

  function pickUpcomingIndex(): number {
    if (queue.value.length <= 1) return -1;
    if (playMode.value === 'repeat-one') return currentIndex.value;
    if (playMode.value === 'shuffle') {
      if (
        shuffleNextIndexCache >= 0 &&
        shuffleNextIndexCache < queue.value.length &&
        shuffleNextIndexCache !== currentIndex.value
      ) {
        return shuffleNextIndexCache;
      }
      let nextIdx = currentIndex.value;
      while (nextIdx === currentIndex.value) {
        nextIdx = Math.floor(Math.random() * queue.value.length);
      }
      shuffleNextIndexCache = nextIdx;
      return nextIdx;
    }
    return (currentIndex.value + 1) % queue.value.length;
  }

  function scheduleNextTrackPrefetch(expectedSeq: number) {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      if (expectedSeq !== trackSeq) return;
      const nextIdx = pickUpcomingIndex();
      if (nextIdx < 0 || nextIdx === currentIndex.value) return;
      const nextSong = queue.value[nextIdx];
      if (!nextSong) return;
      try {
        const resolved = await resolvePlayableStream(nextSong, settingsStore.quality, {
          enableUnblock: settingsStore.enableUnblock,
        });
        if (expectedSeq !== trackSeq) return;
        await echoPlayer.prepareNext({
          url: resolved.url,
          headers: resolved.headers,
          metadata: {
            title: nextSong.title,
            artist: nextSong.artist,
            album: nextSong.album,
            coverUrl: nextSong.coverUrl,
            durationMs: (nextSong.duration || 0) * 1000,
          },
          cacheKey: getTrackKey(nextSong),
        });
      } catch {
        // silent background prefetch
      }
    }, 3000);
  }

  async function bindNativeListeners() {
    if (listenersBound) return;
    listenersBound = true;

    await echoPlayer.onTimeUpdate((ev) => {
      if (ev.trackSeq !== trackSeq) return;
      currentTimeMs.value = ev.currentTimeMs;
      if (ev.durationMs > 0) durationMs.value = ev.durationMs;
      lastSampleTimeMs.value = ev.currentTimeMs;
      const now = ev.sampledAt || Date.now();
      lastSampleAt.value = now;

      if (ev.isPlaying) {
        if (lastStatSampleAt > 0) {
          const deltaSec = (now - lastStatSampleAt) / 1000;
          if (deltaSec > 0 && deltaSec <= 5) {
            statsStore.addListeningDeltaSec(deltaSec);
          }
        }
        lastStatSampleAt = now;
        syncLockScreenLyricLine(ev.currentTimeMs);
      } else {
        lastStatSampleAt = 0;
      }
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
      if (currentSong.value) {
        clearCachedResolvedStream(currentSong.value);
      }
      ui.showToast(`播放异常：${ev.message}，可尝试换源`);
    });

    await echoPlayer.onMediaCommand((ev) => {
      if (ev.command === 'next') void next();
      else if (ev.command === 'previous') void previous();
      else if (ev.command === 'play') void togglePlay(true);
      else if (ev.command === 'pause') void togglePlay(false);
      else if (ev.command === 'seek' && typeof ev.positionMs === 'number') void seek(ev.positionMs);
      else if (ev.command === 'toggleFavorite' && currentSong.value) void toggleFavorite(currentSong.value);
      else if (ev.command === 'cyclePlayMode') cyclePlayMode();
    });
  }

  async function hydrate() {
    await bindNativeListeners();
    const [savedRecent, savedQueue] = await Promise.all([
      echoSystem.kvGetJson<Song[]>(RECENT_KEY, []),
      echoSystem.kvGetJson<PersistedQueue>(QUEUE_KEY, { queue: [], currentIndex: -1, playMode: 'sequence' }),
    ]);
    const cleanSong = (s: Song): Song => ({
      ...s,
      title: stripAudioExtension(s.title) || s.title,
      artist: stripAudioExtension(s.artist) || s.artist,
    });
    recentPlays.value = Array.isArray(savedRecent) ? savedRecent.map(cleanSong) : [];
    queue.value = Array.isArray(savedQueue.queue) ? savedQueue.queue.map(cleanSong) : [];
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

  async function loadAndPlayCurrent(
    autoPlay = true,
    customStream?: { url: string; sourceTag: string; headers?: Record<string, string> },
  ) {
    const song = currentSong.value;
    if (!song) return;
    if (prefetchTimer) clearTimeout(prefetchTimer);
    shuffleNextIndexCache = -1;

    const seq = ++trackSeq;
    lastLiveLyricSent = '';
    lastStatSampleAt = 0;
    isResolving.value = true;
    isBuffering.value = true;
    currentTimeMs.value = 0;
    lastSampleTimeMs.value = 0;
    lastSampleAt.value = Date.now();
    durationMs.value = (song.duration || 0) * 1000;
    sourceTag.value = customStream?.sourceTag || '';

    void ensureNotificationReadyForMedia();
    void refreshCoverPalette(song.coverUrl);
    void loadLyrics(song);
    pushRecent(song);
    statsStore.recordSongPlay(song);
    void persistQueue();
    void echoPlayer.setFavoriteState(isCurrentFavorite.value);
    void echoPlayer.setPlayModeState(playMode.value);
    void echoPlayer.setEqPreset(settingsStore.eqPreset);

    const ui = useUiStore();
    try {
      let playUrl = customStream?.url || '';
      let tag = customStream?.sourceTag || '';
      let headers = customStream?.headers;

      if (!playUrl) {
        const resolved = await resolvePlayableStream(song, settingsStore.quality, {
          enableUnblock: settingsStore.enableUnblock,
        });
        if (seq !== trackSeq) return;
        playUrl = resolved.url;
        tag = resolved.sourceTag;
        headers = resolved.headers;
      }

      sourceTag.value = tag;
      await echoPlayer.setRepeatOne(playMode.value === 'repeat-one');
      await echoPlayer.load({
        url: playUrl,
        headers,
        metadata: {
          title: song.title,
          artist: song.artist,
          album: song.album,
          coverUrl: song.coverUrl,
          durationMs: (song.duration || 0) * 1000,
        },
        autoPlay,
        trackSeq: seq,
        cacheKey: getTrackKey(song),
      });
      if (seq === trackSeq) {
        isPlaying.value = autoPlay;
        scheduleNextTrackPrefetch(seq);
      }
    } catch (err: any) {
      if (seq !== trackSeq) return;
      isPlaying.value = false;
      isBuffering.value = false;
      ui.showToast(err?.message || '暂无可用音源，已为你打开换源面板');
      ui.unblockModalSong = song;
    } finally {
      if (seq === trackSeq) isResolving.value = false;
    }
  }

  async function playSong(song: Song, newQueue?: Song[]) {
    echoSystem.haptic('light');
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
    echoSystem.haptic('light');
    queue.value = [...songs];
    currentIndex.value = Math.max(0, Math.min(startIndex, songs.length - 1));
    if (mode) playMode.value = mode;
    else if (playMode.value === 'fm') playMode.value = 'sequence';
    await loadAndPlayCurrent(true);
  }

  async function playPersonalFm() {
    echoSystem.haptic('medium');
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
    echoSystem.haptic('light');
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
    if (sleepTimerMode.value === 'track') {
      clearSleepTimer();
      isPlaying.value = false;
      useUiStore().showToast('当前曲目已播完，晚安');
      return;
    }
    if (playMode.value === 'repeat-one') {
      await seek(0);
      await echoPlayer.play();
      return;
    }
    await next();
  }

  async function next() {
    if (!queue.value.length) return;
    echoSystem.haptic('light');
    if (playMode.value === 'shuffle' && queue.value.length > 1) {
      const nextIdx = pickUpcomingIndex();
      currentIndex.value = nextIdx >= 0 ? nextIdx : 0;
      shuffleNextIndexCache = -1;
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
    echoSystem.haptic('light');
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
    echoSystem.haptic('selection');
    const order: PlayMode[] = ['sequence', 'shuffle', 'repeat-one'];
    const idx = order.indexOf(playMode.value === 'fm' ? 'sequence' : playMode.value);
    playMode.value = order[(idx + 1) % order.length];
    shuffleNextIndexCache = -1;
    void echoPlayer.setRepeatOne(playMode.value === 'repeat-one');
    void persistQueue();
  }

  function addToQueueNext(song: Song) {
    echoSystem.haptic('light');
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
    ui.showToast('已添加到下一首播放');
  }

  function removeFromQueue(index: number) {
    if (index < 0 || index >= queue.value.length) return;
    echoSystem.haptic('selection');
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
    const resolved = await resolveCandidateUrl(candidate, settingsStore.quality, song.duration);
    if (!resolved?.url) {
      ui.showToast('该候选音源解析失败，请换一个试试');
      return false;
    }
    clearCachedResolvedStream(song);
    if (pin) {
      await pinSourceForSong(song, candidate, resolved.url, resolved.headers);
    }
    const tag =
      candidate.channel === 'kugou-alt'
        ? '酷狗异版'
        : candidate.sourcePlatform === 'kuwo'
          ? '解灰 · 酷我 320k'
          : candidate.sourcePlatform === 'bilibili'
            ? '解灰 · B站音频'
            : `解灰 · ${(candidate.sourcePlatform || 'EXT').toUpperCase()}`;

    const isCurrent = currentSong.value && currentSong.value.hash === song.hash && currentSong.value.id === song.id;
    if (isCurrent) {
      await loadAndPlayCurrent(true, { url: resolved.url, sourceTag: tag, headers: resolved.headers });
    } else {
      await playSong(song);
    }
    echoSystem.haptic('success');
    ui.showToast(pin ? `已切换并锁定：${tag}` : `正在试听：${tag}`);
    return true;
  }

  async function syncFavoritesFromPlaylist(listId: string, tracks: Song[], globalId?: string) {
    favoriteListId.value = listId;
    if (globalId) favoriteGlobalId.value = globalId;
    const set = new Set<string>();
    const fidMap = new Map<string, number>();
    for (const s of tracks) {
      if (s.hash) {
        const key = s.hash.toLowerCase();
        set.add(key);
        if (s.fileId) fidMap.set(key, s.fileId);
      }
    }
    favoriteHashes.value = set;
    favoriteFileIds.value = fidMap;
  }

  async function refreshFavoriteFileId(targetHashLower: string) {
    if (!favoriteListId.value) return;
    try {
      const page = await kugouApi.getPlaylistTracksPaged({
        listId: favoriteListId.value,
        globalCollectionId: favoriteGlobalId.value,
        page: 1,
        pagesize: 30,
      });
      for (const s of page.songs) {
        if (s.hash && s.hash.toLowerCase() === targetHashLower && s.fileId) {
          favoriteFileIds.value.set(targetHashLower, s.fileId);
          break;
        }
      }
    } catch {
      // non-fatal
    }
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
      echoSystem.haptic('selection');
      let fileId = song.fileId || favoriteFileIds.value.get(key);
      if (!fileId) {
        await refreshFavoriteFileId(key);
        fileId = favoriteFileIds.value.get(key);
      }
      try {
        if (fileId) {
          await kugouApi.removeTracksFromPlaylist(favoriteListId.value, [fileId]);
        }
        favoriteHashes.value.delete(key);
        favoriteFileIds.value.delete(key);
        favoriteHashes.value = new Set(favoriteHashes.value);
        ui.showToast(fileId ? '已从“我喜欢”移除' : '已取消红心标记');
      } catch {
        ui.showToast('取消收藏失败，请检查网络');
      }
      return;
    }

    echoSystem.haptic('success');
    try {
      await kugouApi.addTracksToPlaylist(favoriteListId.value, [song]);
      favoriteHashes.value.add(key);
      favoriteHashes.value = new Set(favoriteHashes.value);
      ui.showToast('已收藏到“我喜欢”');
      void refreshFavoriteFileId(key);
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
    sleepTimerMode,
    sleepRemainingSec,
    sleepTimerBadge,
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
    setSleepTimer,
    clearSleepTimer,
    clearRecentPlays,
    getInterpolatedTimeMs,
  };
});
