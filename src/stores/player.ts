import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AudioQuality, CoverPalette, ParsedLyrics, PlayMode, SleepTimerMode, Song, UnblockCandidate } from '@/types/music';
import { echoPlayer, type UpcomingNativeTrack } from '@/native/echoPlayer';
import { echoSystem } from '@/native/echoSystem';
import { cleanSongTitleAndArtist, kugouApi } from '@/services/kugou/kugouEngine';
import { clearCachedResolvedStream, buildAudioCacheKey, resolvePlayableStream } from '@/services/playback/urlResolver';
import { decidePlaybackRecovery, MAX_STREAM_RECOVERY_ATTEMPTS } from '@/services/playback/playbackRecovery';
import { fetchLyricsForSong } from '@/services/playback/krcParser';
import { DEFAULT_APPLE_PALETTE, extractPaletteFromCoverUrl } from '@/services/playback/coverPalette';
import { pinSourceForSong, resolveCandidateUrl } from '@/services/playback/unblockEngine';
import {
  prependSongsToPlaylistSnapshot,
  removeSongsFromPlaylistSnapshot,
  stampPlaylistSnapshotVersion,
} from '@/services/playback/playlistSnapshotCache';
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
  const playbackSpeed = ref<number>(1);
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

  // High-frequency monotonic sub-millisecond interpolation anchor for 120Hz KRC karaoke
  const lastSampleTimeMs = ref(0);
  const lastSampleAt = ref(0);
  const monotonicNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let trackSeq = 0;
  let listenersBound = false;
  let notifPromptedThisSession = false;
  let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  let shuffleNextIndexCache = -1;
  let lastLiveLyricSent = '';
  let lastStatSampleAt = 0;
  let activeTrackCacheKey = '';
  let activeTrackIsUnblocked = false;
  let recoveryAttemptsForCurrentTrack = 0;
  let recoveryInFlight = false;
  let needsRecoveryResumeOnPlay = false;
  let pendingSeekTargetMs = -1;
  let pendingSeekGuardUntil = 0;

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

  // Live quality switching: reload active track in-place at exact playback position
  watch(
    () => settingsStore.quality,
    (nextQ, prevQ) => {
      if (!prevQ || nextQ === prevQ) return;
      const song = currentSong.value;
      if (!song || trackSeq <= 0 || isResolving.value) return;
      clearCachedResolvedStream(song);
      const resumePos = currentTimeMs.value;
      const keepPlaying = isPlaying.value;
      const qualityLabels: Record<AudioQuality, string> = {
        high: 'Hi-Res 母带',
        flac: '无损 FLAC',
        '320': '高品 320k',
        '128': '标准 128k',
      };
      void loadAndPlayCurrent(keepPlaying, undefined, {
        startPositionMs: resumePos,
        bypassCache: true,
        overrideQuality: nextQ,
        isRecovery: true,
      }).then((ok) => {
        if (ok) {
          useUiStore().showToast(`已切换音质：${sourceTag.value || qualityLabels[nextQ]}`);
        }
      });
    },
  );

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
    const cleaned = cleanSongTitleAndArtist(song.title, song.artist);
    const clean: Song = {
      ...song,
      title: cleaned.title,
      artist: cleaned.artist,
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

  function pickUpcomingIndices(count = 3): number[] {
    if (queue.value.length <= 1 || playMode.value === 'repeat-one') return [];
    const maxItems = Math.min(count, queue.value.length - 1);
    const picked: number[] = [];
    const used = new Set<number>([currentIndex.value]);

    if (playMode.value === 'shuffle') {
      if (
        shuffleNextIndexCache >= 0 &&
        shuffleNextIndexCache < queue.value.length &&
        !used.has(shuffleNextIndexCache)
      ) {
        picked.push(shuffleNextIndexCache);
        used.add(shuffleNextIndexCache);
      }
      let guard = 0;
      while (picked.length < maxItems && guard < 40) {
        guard += 1;
        const cand = Math.floor(Math.random() * queue.value.length);
        if (!used.has(cand)) {
          used.add(cand);
          picked.push(cand);
        }
      }
      if (picked.length > 0) shuffleNextIndexCache = picked[0];
      return picked;
    }

    for (let step = 1; step <= maxItems; step += 1) {
      const idx = (currentIndex.value + step) % queue.value.length;
      if (!used.has(idx)) {
        used.add(idx);
        picked.push(idx);
      }
    }
    return picked;
  }

  /**
   * Resolves up to 3 upcoming tracks and pushes them into ExoPlayer's NATIVE playlist queue.
   * Ensures uninterrupted screen-off playback (e.g., cycling in pocket) and instant 0ms Bluetooth skipping!
   */
  function scheduleNextTrackPrefetch(expectedSeq: number, delayMs = 1200) {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      if (expectedSeq !== trackSeq) return;
      if (playMode.value === 'repeat-one') {
        await echoPlayer.clearNext();
        return;
      }

      // If FM queue is near the end, fetch more tracks proactively before screen sleeps
      if (playMode.value === 'fm' && queue.value.length - currentIndex.value <= 2) {
        try {
          const more = await kugouApi.getPersonalFm();
          if (expectedSeq === trackSeq && more.length > 0) {
            queue.value.push(...more);
          }
        } catch {
          // non-fatal
        }
      }

      const upcomingIndices = pickUpcomingIndices(2);
      if (!upcomingIndices.length) {
        await echoPlayer.clearNext();
        return;
      }

      const resolvedTracks: UpcomingNativeTrack[] = [];
      for (const qIdx of upcomingIndices) {
        if (expectedSeq !== trackSeq) return;
        const nextSong = queue.value[qIdx];
        if (!nextSong) continue;
        try {
          const resolved = await resolvePlayableStream(nextSong, settingsStore.quality, {
            enableUnblock: settingsStore.enableUnblock,
          });
          if (expectedSeq !== trackSeq) return;
          const nextCacheKey =
            resolved.cacheKey ?? buildAudioCacheKey(nextSong, resolved.quality, resolved.sourceTag, resolved.isUnblocked);
          resolvedTracks.push({
            mediaId: `pt_${expectedSeq}_${qIdx}_${nextSong.id}`,
            queueIndex: qIdx,
            url: resolved.url,
            headers: resolved.headers,
            metadata: {
              title: nextSong.title,
              artist: nextSong.artist,
              album: nextSong.album,
              coverUrl: nextSong.coverUrl,
              durationMs: (nextSong.duration || 0) * 1000,
            },
            cacheKey: nextCacheKey,
          });
          // Push incrementally as soon as the immediate next track is ready!
          if (resolvedTracks.length === 1) {
            await echoPlayer.syncUpcomingTracks([...resolvedTracks]);
          }
        } catch {
          // Skip unresolvable track gracefully so remaining lookahead still loads
        }
      }

      if (expectedSeq === trackSeq && resolvedTracks.length > 1) {
        await echoPlayer.syncUpcomingTracks(resolvedTracks);
      }
    }, delayMs);
  }

  async function bindNativeListeners() {
    if (listenersBound) return;
    listenersBound = true;

    await echoPlayer.onTimeUpdate((ev) => {
      if (ev.trackSeq !== trackSeq) return;
      const wallNow = ev.sampledAt || Date.now();
      const perfNow = monotonicNow();
      // Ignore stale pre-seek ticks still in flight across the native bridge for 380ms after seek()
      if (pendingSeekTargetMs >= 0 && wallNow < pendingSeekGuardUntil) {
        if (Math.abs(ev.currentTimeMs - pendingSeekTargetMs) > 1500) {
          return;
        }
        pendingSeekTargetMs = -1;
      }
      currentTimeMs.value = ev.currentTimeMs;
      if (ev.durationMs > 0) durationMs.value = ev.durationMs;
      lastSampleTimeMs.value = ev.currentTimeMs;
      lastSampleAt.value = perfNow;

      if (ev.isPlaying) {
        if (lastStatSampleAt > 0) {
          const deltaSec = (wallNow - lastStatSampleAt) / 1000;
          if (deltaSec > 0 && deltaSec <= 5) {
            statsStore.addListeningDeltaSec(deltaSec);
          }
        }
        lastStatSampleAt = wallNow;
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
      if (activeTrackCacheKey) {
        void echoPlayer.removeCachedTrack(activeTrackCacheKey);
      }
      const decision = decidePlaybackRecovery({
        reason: 'stream_error',
        positionMs: currentTimeMs.value,
        attemptsSoFar: MAX_STREAM_RECOVERY_ATTEMPTS,
        enableUnblock: settingsStore.enableUnblock,
        alreadyUnblocked: activeTrackIsUnblocked,
        songTitle: currentSong.value?.title || '当前歌曲',
        errorMessage: ev.message,
      });
      if (decision.action === 'stop_with_notice') {
        needsRecoveryResumeOnPlay = true;
        ui.showToast(decision.toastMessage);
      }
    });

    await echoPlayer.onPlaybackRecovery(async (ev) => {
      if (ev.trackSeq !== trackSeq) return;
      const song = currentSong.value;
      if (!song) return;

      if (ev.reason === 'upcoming_dropped') {
        // Upcoming lookahead item failed pre-buffering; native already protected & resumed Track A.
        // Quietly clear stale prefetched URLs and refresh valid upcoming tracks in the background.
        for (const qIdx of pickUpcomingIndices(2)) {
          const upSong = queue.value[qIdx];
          if (upSong) clearCachedResolvedStream(upSong);
        }
        scheduleNextTrackPrefetch(trackSeq, 900);
        return;
      }

      if (recoveryInFlight) return;
      recoveryInFlight = true;
      const ui = useUiStore();
      const targetPosMs = ev.positionMs || currentTimeMs.value;
      try {
        while (currentSong.value?.id === song.id) {
          const decision = decidePlaybackRecovery({
            reason: ev.reason,
            positionMs: targetPosMs,
            attemptsSoFar: recoveryAttemptsForCurrentTrack,
            enableUnblock: settingsStore.enableUnblock,
            alreadyUnblocked: activeTrackIsUnblocked,
            songTitle: song.title,
            errorMessage: ev.message,
          });

          if (
            decision.action === 'reload_same_source' ||
            decision.action === 'reload_force_unblock' ||
            decision.action === 'reload_stable_quality'
          ) {
            recoveryAttemptsForCurrentTrack = decision.attempt;
            clearCachedResolvedStream(song);
            if (activeTrackCacheKey) {
              await echoPlayer.removeCachedTrack(activeTrackCacheKey).catch(() => {});
            }
            const ok = await loadAndPlayCurrent(true, undefined, {
              startPositionMs: decision.positionMs,
              bypassCache: true,
              forceUnblock: decision.action === 'reload_force_unblock',
              overrideQuality: decision.action === 'reload_stable_quality' ? '128' : undefined,
              isRecovery: true,
            });
            if (ok) return;
            // Fresh URL resolution failed immediately — loop to next recovery tier (never auto-skip!)
            if (decision.action === 'reload_force_unblock') {
              activeTrackIsUnblocked = true;
            }
            continue;
          }

          if (decision.action === 'stop_with_notice') {
            isPlaying.value = false;
            isBuffering.value = false;
            needsRecoveryResumeOnPlay = true;
            ui.showToast(decision.toastMessage);
          }
          return;
        }
      } finally {
        recoveryInFlight = false;
      }
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

    await echoPlayer.onTrackAutoAdvanced((ev) => {
      // ExoPlayer seamlessly advanced natively (screen-off or Bluetooth headset skip)
      trackSeq = Math.max(trackSeq, ev.trackSeq);
      if (ev.queueIndex >= 0 && ev.queueIndex < queue.value.length) {
        currentIndex.value = ev.queueIndex;
      }
      shuffleNextIndexCache = -1;
      lastLiveLyricSent = '';
      lastStatSampleAt = 0;
      recoveryAttemptsForCurrentTrack = 0;
      recoveryInFlight = false;
      needsRecoveryResumeOnPlay = false;
      activeTrackCacheKey = '';
      activeTrackIsUnblocked = false;
      currentTimeMs.value = 0;
      isPlaying.value = true;
      isBuffering.value = false;

      const song = currentSong.value;
      if (song) {
        durationMs.value = (song.duration || 0) * 1000;
        void refreshCoverPalette(song.coverUrl);
        void loadLyrics(song);
        pushRecent(song);
        statsStore.recordSongPlay(song);
        void persistQueue();
        void echoPlayer.setFavoriteState(isCurrentFavorite.value);
      }

      if (sleepTimerMode.value === 'track') {
        clearSleepTimer();
        void echoPlayer.pause();
        isPlaying.value = false;
        return;
      }

      // Immediately top up the next 2 upcoming tracks in ExoPlayer
      scheduleNextTrackPrefetch(trackSeq, 600);
    });
  }

  async function hydrate() {
    await bindNativeListeners();
    const [savedRecent, savedQueue] = await Promise.all([
      echoSystem.kvGetJson<Song[]>(RECENT_KEY, []),
      echoSystem.kvGetJson<PersistedQueue>(QUEUE_KEY, { queue: [], currentIndex: -1, playMode: 'sequence' }),
    ]);
    const cleanSong = (s: Song): Song => {
      const cleaned = cleanSongTitleAndArtist(s.title, s.artist);
      return {
        ...s,
        title: cleaned.title,
        artist: cleaned.artist,
      };
    };
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
    resumeOptions?: {
      startPositionMs?: number;
      bypassCache?: boolean;
      forceUnblock?: boolean;
      overrideQuality?: AudioQuality;
      isRecovery?: boolean;
    },
  ): Promise<boolean> {
    const song = currentSong.value;
    if (!song) return false;
    if (prefetchTimer) clearTimeout(prefetchTimer);
    shuffleNextIndexCache = -1;

    const isRecovery = Boolean(resumeOptions?.isRecovery);
    const resumePosMs = Math.max(0, Math.round(resumeOptions?.startPositionMs || 0));

    const seq = ++trackSeq;
    lastStatSampleAt = 0;
    needsRecoveryResumeOnPlay = false;
    isResolving.value = true;
    isBuffering.value = true;

    if (!isRecovery) {
      recoveryAttemptsForCurrentTrack = 0;
      recoveryInFlight = false;
      lastLiveLyricSent = '';
      currentTimeMs.value = 0;
      lastSampleTimeMs.value = 0;
      lastSampleAt.value = monotonicNow();
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
    } else {
      currentTimeMs.value = resumePosMs;
      lastSampleTimeMs.value = resumePosMs;
      lastSampleAt.value = monotonicNow();
    }

    const ui = useUiStore();
    try {
      let playUrl = customStream?.url || '';
      let tag = customStream?.sourceTag || '';
      let headers = customStream?.headers;
      let resolvedQuality = resumeOptions?.overrideQuality || settingsStore.quality;
      let resolvedUnblocked = Boolean(customStream && /解灰|酷狗异版/i.test(customStream.sourceTag || ''));
      let cacheKey: string | undefined;

      if (!playUrl) {
        const resolved = await resolvePlayableStream(song, resolvedQuality, {
          enableUnblock: settingsStore.enableUnblock,
          bypassCache: resumeOptions?.bypassCache,
          forceUnblock: resumeOptions?.forceUnblock,
        });
        if (seq !== trackSeq) return false;
        playUrl = resolved.url;
        tag = resolved.sourceTag;
        headers = resolved.headers;
        resolvedQuality = resolved.quality;
        resolvedUnblocked = resolved.isUnblocked;
        cacheKey = resolved.cacheKey;
      }

      if (!cacheKey) {
        cacheKey = buildAudioCacheKey(song, resolvedQuality, tag, resolvedUnblocked);
      }
      activeTrackCacheKey = cacheKey || '';
      activeTrackIsUnblocked = resolvedUnblocked;
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
        cacheKey,
        queueIndex: currentIndex.value,
        startPositionMs: resumePosMs,
        isRecovery,
      });
      if (seq === trackSeq) {
        if (playbackSpeed.value !== 1) {
          void echoPlayer.setSpeed(playbackSpeed.value);
        }
        isPlaying.value = autoPlay;
        scheduleNextTrackPrefetch(seq);
      }
      return true;
    } catch (err: any) {
      if (seq !== trackSeq) return false;
      if (!isRecovery) {
        isPlaying.value = false;
        isBuffering.value = false;
        ui.showToast(err?.message || '暂无可用音源，已为你打开换源面板');
        ui.unblockModalSong = song;
      }
      return false;
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
      if (needsRecoveryResumeOnPlay) {
        needsRecoveryResumeOnPlay = false;
        recoveryAttemptsForCurrentTrack = 0;
        await loadAndPlayCurrent(true, undefined, {
          startPositionMs: currentTimeMs.value,
          bypassCache: true,
          isRecovery: true,
        });
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

  async function previous(forcePrevTrack = false) {
    if (!queue.value.length) return;
    echoSystem.haptic('light');
    if (!forcePrevTrack && currentTimeMs.value > 5000) {
      await seek(0);
      return;
    }
    currentIndex.value = (currentIndex.value - 1 + queue.value.length) % queue.value.length;
    await loadAndPlayCurrent(true);
  }

  async function seek(positionMs: number) {
    const clamped = Math.max(0, Math.min(durationMs.value || positionMs, positionMs));
    pendingSeekTargetMs = clamped;
    pendingSeekGuardUntil = Date.now() + 380;
    currentTimeMs.value = clamped;
    lastSampleTimeMs.value = clamped;
    lastSampleAt.value = monotonicNow();
    await echoPlayer.seek(clamped);
  }

  async function setPlaybackSpeed(speed: number) {
    const clamped = Math.max(0.5, Math.min(2.0, Number(speed) || 1));
    playbackSpeed.value = clamped;
    echoSystem.haptic('selection');
    await echoPlayer.setSpeed(clamped);
    useUiStore().showToast(`播放倍速：${clamped}x`);
  }

  function cyclePlayMode() {
    echoSystem.haptic('selection');
    const order: PlayMode[] = ['sequence', 'shuffle', 'repeat-one'];
    const idx = order.indexOf(playMode.value === 'fm' ? 'sequence' : playMode.value);
    playMode.value = order[(idx + 1) % order.length];
    shuffleNextIndexCache = -1;
    void echoPlayer.setRepeatOne(playMode.value === 'repeat-one');
    void persistQueue();
    if (trackSeq > 0) scheduleNextTrackPrefetch(trackSeq, 400);
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
    if (trackSeq > 0) scheduleNextTrackPrefetch(trackSeq, 300);
    ui.showToast('已添加到下一首播放');
  }

  function moveQueueItemNext(index: number) {
    if (index < 0 || index >= queue.value.length || index === currentIndex.value) return;
    echoSystem.haptic('selection');
    const [item] = queue.value.splice(index, 1);
    if (index < currentIndex.value) {
      currentIndex.value -= 1;
    }
    queue.value.splice(currentIndex.value + 1, 0, item);
    void persistQueue();
    if (trackSeq > 0) scheduleNextTrackPrefetch(trackSeq, 300);
    useUiStore().showToast(`已置顶「${item.title}」为下一首`);
  }

  function clearQueue() {
    echoSystem.haptic('medium');
    queue.value = [];
    currentIndex.value = -1;
    shuffleNextIndexCache = -1;
    isPlaying.value = false;
    void echoPlayer.stop();
    void persistQueue();
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
      if (trackSeq > 0) scheduleNextTrackPrefetch(trackSeq, 400);
    } else if (trackSeq > 0) {
      scheduleNextTrackPrefetch(trackSeq, 400);
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

  function syncFavoriteSnapshotVersion(favKey: string) {
    if (!favKey) return;
    void kugouApi
      .getUserPlaylists()
      .then((pls) => {
        const fav = pls.find((p) => p.isFavorite || p.listId === favoriteListId.value);
        if (fav?.totalVer) {
          void stampPlaylistSnapshotVersion(favKey, fav.totalVer, fav.trackCount);
        }
      })
      .catch(() => {});
  }

  async function toggleFavorite(song: Song) {
    const ui = useUiStore();
    const key = song.hash?.toLowerCase();
    if (!key) return;
    if (!favoriteListId.value) {
      ui.showToast('请先登录并加载“我喜欢”歌单');
      return;
    }
    const favSnapKey = favoriteGlobalId.value || favoriteListId.value;

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
        await removeSongsFromPlaylistSnapshot(favSnapKey, [{ ...song, fileId }]);
        syncFavoriteSnapshotVersion(favSnapKey);
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
      await prependSongsToPlaylistSnapshot(favSnapKey, [song]);
      ui.showToast('已收藏到“我喜欢”');
      void refreshFavoriteFileId(key);
      syncFavoriteSnapshotVersion(favSnapKey);
    } catch {
      ui.showToast('收藏失败，请检查登录状态');
    }
  }

  function getInterpolatedTimeMs(): number {
    if (!isPlaying.value || isBuffering.value) return currentTimeMs.value;
    if (lastSampleAt.value <= 0) return currentTimeMs.value;
    const elapsed = Math.max(0, Math.min(450, monotonicNow() - lastSampleAt.value));
    return currentTimeMs.value + elapsed * (playbackSpeed.value || 1);
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
    playbackSpeed,
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
    setPlaybackSpeed,
    cyclePlayMode,
    addToQueueNext,
    moveQueueItemNext,
    clearQueue,
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
