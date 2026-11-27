export type AudioQuality = '128' | '320' | 'flac';

export type PlayMode = 'sequence' | 'shuffle' | 'repeat-one' | 'fm';

export type SleepTimerMode = 'off' | '15' | '30' | '60' | 'track';

export type PlaylistSortMode = 'default' | 'newest' | 'oldest' | 'title' | 'artist';

export interface SongArtistRef {
  id: string;
  name: string;
}

export interface Song {
  id: string;
  hash: string;
  hash320?: string;
  hashFlac?: string;
  mixSongId?: number;
  fileId?: number;
  addedAt?: number;
  albumId?: string;
  title: string;
  artist: string;
  artists?: SongArtistRef[];
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
  /** True when created/owned by the active account (editable, accepts track additions/removals). */
  isOwner?: boolean;
  isPrivate?: boolean;
  totalVer?: number;
  createUserId?: string;
  createListId?: string;
}

export interface PlaylistActionContext {
  listId: string;
  globalCollectionId: string;
  name: string;
  isOwner: boolean;
  isFavorite: boolean;
  onTrackRemoved?: (song: Song) => void;
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

export interface VipTierStatus {
  active: boolean;
  endTime?: string;
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
  pGrade?: number;
  friends?: number;
  follows?: number;
  fans?: number;
  visitors?: number;
  gender?: number; // 1 male, 0/2 female
  province?: string;
  city?: string;
  registerTime?: number; // unix sec
  listenDurationMin?: number; // KuGou cumulative minutes
  vipTiers?: {
    svip: VipTierStatus;
    luxuryVip: VipTierStatus;
    conceptVip: VipTierStatus;
    listenVip: VipTierStatus;
  };
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

export interface HotSearchItem {
  keyword: string;
  reason?: string;
  tag?: string;
  rank: number;
}

export interface HotSearchTab {
  title: string;
  items: HotSearchItem[];
}

export interface SongComment {
  id: string;
  tid: string;
  specialId?: string;
  userId?: string;
  userName: string;
  userAvatar: string;
  isVip: boolean;
  content: string;
  addTime: string;
  location?: string;
  likeCount: number;
  liked?: boolean;
  replyCount: number;
  replyToUser?: string;
}

export interface CommentClassifyTag {
  id: string;
  name: string;
  count?: number;
}

export interface CommentHotwordTag {
  word: string;
  count?: number;
}

export interface SongCommentsPage {
  comments: SongComment[];
  total: number;
  hasMore: boolean;
  specialId?: string;
  classifies: CommentClassifyTag[];
  hotwords: CommentHotwordTag[];
}

export interface ArtistSummary {
  id: string;
  name: string;
  avatar: string;
  songCount: number;
  albumCount: number;
  fansCount: number;
  isFollow?: boolean;
}

export interface ArtistBioSection {
  title: string;
  content: string;
}

export interface ArtistDetail extends ArtistSummary {
  mvCount: number;
  birthday?: string;
  intro: string;
  longIntro: string;
  bioSections?: ArtistBioSection[];
}

export interface SongQualitySpec {
  quality: string;
  label: string;
  bitrate: number;
  sizeText: string;
  extname: string;
  needVip: boolean;
  obtainable: boolean;
}

export interface SongEnrichedMeta {
  albumId?: string;
  albumName?: string;
  durationSec?: number;
  coverUrl?: string;
  qualities: SongQualitySpec[];
}

export interface AlbumSummary {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverUrl: string;
  publishDate?: string;
  songCount?: number;
  language?: string;
  intro?: string;
}

export interface AlbumDetail extends AlbumSummary {
  songs: Song[];
}

export interface SongClimaxRange {
  startMs: number;
  endMs: number;
}
