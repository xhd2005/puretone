import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface PlayerTrackMetadata {
  title: string;
  artist: string;
  album: string;
  coverUrl?: string;
  durationMs?: number;
}

export interface PlayerStateSnapshot {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTimeMs: number;
  durationMs: number;
  volume: number;
  speed: number;
  repeatOne: boolean;
  trackSeq: number;
}

export interface PlayerTimeEvent {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  trackSeq: number;
  sampledAt: number;
}

export interface PlayerStateEvent {
  isPlaying: boolean;
  isBuffering: boolean;
  ended: boolean;
  trackSeq: number;
}

export interface PlayerErrorEvent {
  code: string;
  message: string;
  trackSeq: number;
}

export interface MediaCommandEvent {
  command: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'toggleFavorite' | 'cyclePlayMode';
  positionMs?: number;
}

export interface TrackAutoAdvancedEvent {
  queueIndex: number;
  trackSeq: number;
}

export interface UpcomingNativeTrack {
  mediaId?: string;
  queueIndex: number;
  url: string;
  headers?: Record<string, string>;
  metadata: PlayerTrackMetadata;
  cacheKey?: string;
}

export type EqPresetId = 'flat' | 'vocal' | 'bass' | 'night' | 'live';

export interface AudioCacheStats {
  usedBytes: number;
  maxBytes: number;
}

export interface EchoPlayerPluginInterface {
  load(options: {
    url: string;
    headers?: Record<string, string>;
    metadata: PlayerTrackMetadata;
    autoPlay?: boolean;
    trackSeq: number;
    cacheKey?: string;
    queueIndex?: number;
  }): Promise<void>;
  syncUpcomingTracks(options: { tracks: UpcomingNativeTrack[] }): Promise<void>;
  prepareNext(options: {
    url: string;
    headers?: Record<string, string>;
    metadata: PlayerTrackMetadata;
    cacheKey?: string;
    queueIndex?: number;
  }): Promise<void>;
  clearNext(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  fadeOutAndPause(options: { durationMs?: number }): Promise<void>;
  stop(): Promise<void>;
  seek(options: { positionMs: number }): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  setSpeed(options: { speed: number }): Promise<void>;
  setRepeatOne(options: { enabled: boolean }): Promise<void>;
  setFavoriteState(options: { favorite: boolean }): Promise<void>;
  setPlayModeState(options: { mode: string }): Promise<void>;
  setLiveLyric(options: { line: string }): Promise<void>;
  setEqPreset(options: { preset: EqPresetId }): Promise<void>;
  setTransitionFadeMs(options: { fadeMs: number }): Promise<void>;
  setVolumeLeveling(options: { enabled: boolean }): Promise<void>;
  updateMetadata(options: PlayerTrackMetadata): Promise<void>;
  getAudioCacheStats(): Promise<AudioCacheStats>;
  clearAudioCache(): Promise<{ cleared: boolean }>;
  getState(): Promise<PlayerStateSnapshot>;
  addListener(eventName: 'timeUpdate', listener: (ev: PlayerTimeEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'stateChange', listener: (ev: PlayerStateEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'playerError', listener: (ev: PlayerErrorEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'mediaCommand', listener: (ev: MediaCommandEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'trackAutoAdvanced',
    listener: (ev: TrackAutoAdvancedEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const EchoPlayerNative = registerPlugin<EchoPlayerPluginInterface>('EchoPlayer');

// Lightweight HTMLAudio fallback for browser preview & tests
class WebAudioFallback {
  private audio: HTMLAudioElement | null = typeof Audio !== 'undefined' ? new Audio() : null;
  private trackSeq = 0;
  private timeTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = {
    timeUpdate: new Set<(ev: PlayerTimeEvent) => void>(),
    stateChange: new Set<(ev: PlayerStateEvent) => void>(),
    playerError: new Set<(ev: PlayerErrorEvent) => void>(),
    mediaCommand: new Set<(ev: MediaCommandEvent) => void>(),
  };

  constructor() {
    if (!this.audio) return;
    this.audio.preload = 'auto';
    this.audio.addEventListener('play', () => this.emitState(false));
    this.audio.addEventListener('pause', () => this.emitState(false));
    this.audio.addEventListener('waiting', () => this.emitState(false));
    this.audio.addEventListener('playing', () => this.emitState(false));
    this.audio.addEventListener('ended', () => {
      if (this.audio?.loop) return;
      this.emitState(true);
    });
    this.audio.addEventListener('error', () => {
      const ev: PlayerErrorEvent = {
        code: 'WEB_AUDIO_ERROR',
        message: this.audio?.error?.message || '音频加载失败',
        trackSeq: this.trackSeq,
      };
      this.listeners.playerError.forEach((fn) => fn(ev));
    });
    this.timeTimer = setInterval(() => {
      if (!this.audio || this.audio.paused) return;
      this.emitTime();
    }, 250);
  }

  private emitTime() {
    if (!this.audio) return;
    const ev: PlayerTimeEvent = {
      currentTimeMs: Math.round((this.audio.currentTime || 0) * 1000),
      durationMs: Math.round((Number.isFinite(this.audio.duration) ? this.audio.duration : 0) * 1000),
      isPlaying: !this.audio.paused,
      trackSeq: this.trackSeq,
      sampledAt: Date.now(),
    };
    this.listeners.timeUpdate.forEach((fn) => fn(ev));
  }

  private emitState(ended: boolean) {
    if (!this.audio) return;
    const ev: PlayerStateEvent = {
      isPlaying: !this.audio.paused && !ended,
      isBuffering: this.audio.readyState < 3 && !this.audio.paused,
      ended,
      trackSeq: this.trackSeq,
    };
    this.listeners.stateChange.forEach((fn) => fn(ev));
  }

  async load(options: {
    url: string;
    metadata: PlayerTrackMetadata;
    autoPlay?: boolean;
    trackSeq: number;
  }) {
    this.trackSeq = options.trackSeq;
    if (!this.audio) return;
    this.audio.src = options.url;
    this.audio.load();
    this.updateMediaSession(options.metadata);
    if (options.autoPlay !== false) {
      await this.audio.play().catch(() => {});
    }
  }

  private updateMediaSession(meta: PlayerTrackMetadata) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        artwork: meta.coverUrl ? [{ src: meta.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () =>
        this.listeners.mediaCommand.forEach((fn) => fn({ command: 'play' })),
      );
      navigator.mediaSession.setActionHandler('pause', () =>
        this.listeners.mediaCommand.forEach((fn) => fn({ command: 'pause' })),
      );
      navigator.mediaSession.setActionHandler('nexttrack', () =>
        this.listeners.mediaCommand.forEach((fn) => fn({ command: 'next' })),
      );
      navigator.mediaSession.setActionHandler('previoustrack', () =>
        this.listeners.mediaCommand.forEach((fn) => fn({ command: 'previous' })),
      );
    } catch {
      // ignore unsupported mediaSession
    }
  }

  async play() {
    await this.audio?.play().catch(() => {});
  }

  async pause() {
    this.audio?.pause();
  }

  async fadeOutAndPause(durationMs = 3000) {
    if (!this.audio) return;
    const startVol = this.audio.volume;
    const steps = 12;
    const interval = Math.max(20, Math.round(durationMs / steps));
    for (let i = 1; i <= steps; i += 1) {
      await new Promise((r) => setTimeout(r, interval));
      if (!this.audio) return;
      this.audio.volume = Math.max(0, startVol * (1 - i / steps));
    }
    this.audio.pause();
    this.audio.volume = startVol;
  }

  async stop() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  async seek(positionMs: number) {
    if (!this.audio) return;
    this.audio.currentTime = Math.max(0, positionMs / 1000);
    this.emitTime();
  }

  async setVolume(volume: number) {
    if (!this.audio) return;
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  async setSpeed(speed: number) {
    if (!this.audio) return;
    this.audio.playbackRate = Math.max(0.5, Math.min(2.0, speed));
  }

  async setRepeatOne(enabled: boolean) {
    if (!this.audio) return;
    this.audio.loop = enabled;
  }

  async updateMetadata(meta: PlayerTrackMetadata) {
    this.updateMediaSession(meta);
  }

  async getState(): Promise<PlayerStateSnapshot> {
    return {
      isPlaying: Boolean(this.audio && !this.audio.paused),
      isBuffering: false,
      currentTimeMs: Math.round((this.audio?.currentTime || 0) * 1000),
      durationMs: Math.round((Number.isFinite(this.audio?.duration) ? this.audio!.duration : 0) * 1000),
      volume: this.audio?.volume ?? 1,
      speed: this.audio?.playbackRate ?? 1,
      repeatOne: Boolean(this.audio?.loop),
      trackSeq: this.trackSeq,
    };
  }

  on<K extends keyof WebAudioFallback['listeners']>(
    event: K,
    cb: WebAudioFallback['listeners'][K] extends Set<infer T> ? T : never,
  ): () => void {
    const set = this.listeners[event] as Set<unknown>;
    set.add(cb);
    return () => set.delete(cb);
  }
}

let webFallback: WebAudioFallback | null = null;
function getWebFallback() {
  if (!webFallback) webFallback = new WebAudioFallback();
  return webFallback;
}

export const echoPlayer = {
  async load(options: Parameters<EchoPlayerPluginInterface['load']>[0]) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.load(options);
    return getWebFallback().load(options);
  },
  async syncUpcomingTracks(tracks: UpcomingNativeTrack[]) {
    if (Capacitor.isNativePlatform()) {
      return EchoPlayerNative.syncUpcomingTracks({ tracks }).catch(() => {});
    }
  },
  async prepareNext(options: Parameters<EchoPlayerPluginInterface['prepareNext']>[0]) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.prepareNext(options);
  },
  async clearNext() {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.clearNext();
  },
  async play() {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.play();
    return getWebFallback().play();
  },
  async pause() {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.pause();
    return getWebFallback().pause();
  },
  async fadeOutAndPause(durationMs = 3000) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.fadeOutAndPause({ durationMs });
    return getWebFallback().fadeOutAndPause(durationMs);
  },
  async stop() {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.stop();
    return getWebFallback().stop();
  },
  async seek(positionMs: number) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.seek({ positionMs });
    return getWebFallback().seek(positionMs);
  },
  async setVolume(volume: number) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setVolume({ volume });
    return getWebFallback().setVolume(volume);
  },
  async setSpeed(speed: number) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setSpeed({ speed });
    return getWebFallback().setSpeed(speed);
  },
  async setRepeatOne(enabled: boolean) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setRepeatOne({ enabled });
    return getWebFallback().setRepeatOne(enabled);
  },
  async setFavoriteState(favorite: boolean) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setFavoriteState({ favorite }).catch(() => {});
  },
  async setPlayModeState(mode: string) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setPlayModeState({ mode }).catch(() => {});
  },
  async setLiveLyric(line: string) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setLiveLyric({ line }).catch(() => {});
  },
  async setEqPreset(preset: EqPresetId) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setEqPreset({ preset }).catch(() => {});
  },
  async setTransitionFadeMs(fadeMs: number) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setTransitionFadeMs({ fadeMs }).catch(() => {});
  },
  async setVolumeLeveling(enabled: boolean) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.setVolumeLeveling({ enabled }).catch(() => {});
  },
  async updateMetadata(metadata: PlayerTrackMetadata) {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.updateMetadata(metadata);
    return getWebFallback().updateMetadata(metadata);
  },
  async getAudioCacheStats(): Promise<AudioCacheStats> {
    if (Capacitor.isNativePlatform()) {
      return EchoPlayerNative.getAudioCacheStats().catch(() => ({ usedBytes: 0, maxBytes: 300 * 1024 * 1024 }));
    }
    return { usedBytes: 0, maxBytes: 300 * 1024 * 1024 };
  },
  async clearAudioCache(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const res = await EchoPlayerNative.clearAudioCache().catch(() => ({ cleared: false }));
      return Boolean(res?.cleared);
    }
    return true;
  },
  async getState(): Promise<PlayerStateSnapshot> {
    if (Capacitor.isNativePlatform()) return EchoPlayerNative.getState();
    return getWebFallback().getState();
  },
  async onTimeUpdate(cb: (ev: PlayerTimeEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoPlayerNative.addListener('timeUpdate', cb);
      return () => void h.remove();
    }
    return getWebFallback().on('timeUpdate', cb);
  },
  async onStateChange(cb: (ev: PlayerStateEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoPlayerNative.addListener('stateChange', cb);
      return () => void h.remove();
    }
    return getWebFallback().on('stateChange', cb);
  },
  async onError(cb: (ev: PlayerErrorEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoPlayerNative.addListener('playerError', cb);
      return () => void h.remove();
    }
    return getWebFallback().on('playerError', cb);
  },
  async onMediaCommand(cb: (ev: MediaCommandEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoPlayerNative.addListener('mediaCommand', cb);
      return () => void h.remove();
    }
    return getWebFallback().on('mediaCommand', cb);
  },
  async onTrackAutoAdvanced(cb: (ev: TrackAutoAdvancedEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoPlayerNative.addListener('trackAutoAdvanced', cb);
      return () => void h.remove();
    }
    return () => {};
  },
};
