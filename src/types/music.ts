export type AudioQuality = '128' | '320' | 'flac';

export type PlayMode = 'sequence' | 'shuffle' | 'repeat-one' | 'fm';

export type SleepTimerMode = 'off' | '15' | '30' | '60' | 'track';

export interface Song {
  id: string;
  hash: string;
  hash320?: string;
  hashFlac?: string;
  mixSongId?: number;
  fileId?: number;
  albumId?: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  coverUrl: string;
  isVip?: boolean;
  isGray?: boolean;
  privilege?: number;
  /** Runtime tag when resolved via unblock */
  sourceTag?: string;
  /** Explicit URL override when unblocked */
  resolvedUrl?: string;
  resolvedQuality?: AudioQuality;
  resolvedHeaders?: Record<string, string>;
}

export interface PlaylistSummary {
  id: string;
  listId?: string;
  globalCollectionId: string;
  name: string;
  coverUrl: string;
  trackCount: number;
  creator?: string;
  description?: string;
  isFavorite?: boolean;
}

export interface LyricWord {
  startMs: number;
  durationMs: number;
  text: string;
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  text: string;
  translation?: string;
  romanization?: string;
  words?: LyricWord[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  hasWordTiming: boolean;
  hasTranslation: boolean;
  source: 'kugou-krc' | 'kugou-lrc' | 'netease' | 'lrclib' | 'none';
}

export interface AccountProfile {
  userid: string;
  token: string;
  t1?: string;
  nickname: string;
  avatar: string;
  vipType?: number;
  isVip?: boolean;
  vipEndTime?: string;
  tvipEndTime?: string;
  addedAt: number;
  lastUsedAt: number;
}

export type VipStepStatus = 'idle' | 'running' | 'success' | 'already' | 'failed' | 'skipped';

export interface VipStepState {
  baseVip: VipStepStatus;
  upgrade: VipStepStatus;
  conceptAd: VipStepStatus;
  conceptListen: VipStepStatus;
}

export interface VipStepDetails {
  baseVip: string;
  upgrade: string;
  conceptAd: string;
  conceptListen: string;
}

export interface VipLedgerEntry {
  id: string;
  userId: string;
  claimDate: string; // YYYY-MM-DD
  claimedAt: number;
  expiryText: string;
  upgradeSuccess: boolean;
  conceptSuccess: boolean;
  status: 'success' | 'failed';
  message: string;
}

export interface UnblockCandidate {
  id: string;
  channel: 'kugou-alt' | 'external';
  channelLabel: string;
  provider?: 'kuwo-direct' | 'gdstudio-joox' | 'bilibili-dash' | 'gdstudio' | 'custom';
  sourcePlatform?: string;
  externalId?: string;
  lyricId?: string;
  hash?: string;
  fallbackHashes?: string[];
  title: string;
  artist: string;
  album: string;
  duration: number;
  quality: AudioQuality;
  score: number;
  url?: string;
  headers?: Record<string, string>;
}

export interface PinnedSource {
  trackKey: string;
  channel: 'kugou-alt' | 'external';
  provider?: 'kuwo-direct' | 'gdstudio-joox' | 'bilibili-dash' | 'gdstudio' | 'custom';
  sourcePlatform?: string;
  externalId?: string;
  hash?: string;
  fallbackHashes?: string[];
  title: string;
  artist: string;
  quality: AudioQuality;
  url?: string;
  headers?: Record<string, string>;
  urlCachedAt: number;
}

export interface CoverPalette {
  accentLight: string;
  accentDark: string;
  fluidColors: [string, string, string, string];
}
