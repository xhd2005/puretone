import type { PlaylistSortMode, Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import { cleanSongTitleAndArtist } from '@/services/kugou/kugouEngine';

export interface PlaylistSnapshot {
  key: string;
  songs: Song[];
  totalCount: number;
  totalVer?: number;
  updatedAt: number;
}

const SNAPSHOT_PREFIX = 'playlist.snap.v1:';
const DAILY_PREFIX = 'daily.recommend.v1:';

function compactSong(s: Song): Song {
  return {
    id: s.id,
    hash: s.hash,
    ...(s.hash320 ? { hash320: s.hash320 } : {}),
    ...(s.hashFlac ? { hashFlac: s.hashFlac } : {}),
    ...(s.mixSongId ? { mixSongId: s.mixSongId } : {}),
    ...(s.fileId ? { fileId: s.fileId } : {}),
    ...(s.addedAt ? { addedAt: s.addedAt } : {}),
    ...(s.albumId ? { albumId: s.albumId } : {}),
    title: s.title,
    artist: s.artist,
    album: s.album,
    duration: s.duration,
    coverUrl: s.coverUrl,
    ...(s.isVip ? { isVip: true } : {}),
    ...(s.isGray ? { isGray: true } : {}),
    ...(s.privilege !== undefined ? { privilege: s.privilege } : {}),
  };
}

function getSongDedupeKey(s: Song): string {
  return s.fileId
    ? `fid:${s.fileId}`
    : s.hash
      ? `h:${s.hash.toLowerCase()}`
      : `id:${s.id}:${s.title}`;
}

export function dedupeSongsByKey(songs: Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    const key = getSongDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Decides whether opening a playlist should trigger a cloud paginated sync.
 * When a local snapshot already matches KuGou's cloud `totalVer` and `trackCount`,
 * returns `false` so opening "我喜欢" or large playlists is 0ms / 0-network instant!
 */
export function shouldSyncPlaylistSnapshot(
  snapshot: PlaylistSnapshot | null | undefined,
  cloudMeta: { totalVer?: number; trackCount?: number },
): boolean {
  if (!snapshot || !Array.isArray(snapshot.songs) || snapshot.songs.length === 0) {
    return true;
  }
  const cloudVer = Number(cloudMeta.totalVer || 0);
  const cloudCount = Number(cloudMeta.trackCount || 0);
  const snapVer = Number(snapshot.totalVer || 0);

  if (cloudVer > 0) {
    // Legacy snapshot without totalVer -> perform one-time sync to stamp version
    if (snapVer <= 0) return true;
    if (snapVer !== cloudVer) return true;
    if (cloudCount > 0 && snapshot.songs.length !== cloudCount) return true;
    return false;
  }

  // External / search playlists without cloud totalVer: trust snapshot if count matches
  if (cloudCount > 0 && snapshot.songs.length !== cloudCount) {
    return true;
  }
  return false;
}

/**
 * Sorts playlist tracks cleanly.
 * KuGou's v3 cloud playlist endpoint returns "我喜欢" oldest-first; `'newest'` places
 * the most recently liked songs at index 0 using `addedAt`, then `fileId`, then reverse index.
 */
export function sortPlaylistSongs(songs: Song[], mode: PlaylistSortMode): Song[] {
  if (songs.length <= 1 || mode === 'default') return [...songs];

  if (mode === 'title') {
    return [...songs].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  }
  if (mode === 'artist') {
    return [...songs].sort(
      (a, b) => a.artist.localeCompare(b.artist, 'zh-Hans-CN') || a.title.localeCompare(b.title, 'zh-Hans-CN'),
    );
  }

  const withAddedAt = songs.filter((s) => (s.addedAt ?? 0) > 0).length;
  const withFileId = songs.filter((s) => (s.fileId ?? 0) > 0).length;
  const indexed = songs.map((song, idx) => ({ song, idx }));

  if (withAddedAt >= Math.max(2, Math.floor(songs.length * 0.5))) {
    indexed.sort((a, b) => {
      const diff = (a.song.addedAt ?? 0) - (b.song.addedAt ?? 0);
      if (diff !== 0) return mode === 'newest' ? -diff : diff;
      return mode === 'newest' ? b.idx - a.idx : a.idx - b.idx;
    });
    return indexed.map((x) => x.song);
  }

  if (withFileId >= Math.max(2, Math.floor(songs.length * 0.5))) {
    indexed.sort((a, b) => {
      const diff = (a.song.fileId ?? 0) - (b.song.fileId ?? 0);
      if (diff !== 0) return mode === 'newest' ? -diff : diff;
      return mode === 'newest' ? b.idx - a.idx : a.idx - b.idx;
    });
    return indexed.map((x) => x.song);
  }

  return mode === 'newest' ? [...songs].reverse() : [...songs];
}

export async function readPlaylistSnapshot(key: string): Promise<PlaylistSnapshot | null> {
  if (!key) return null;
  const snap = await echoSystem.kvGetJson<PlaylistSnapshot | null>(SNAPSHOT_PREFIX + key, null);
  if (!snap || !Array.isArray(snap.songs)) return null;
  return {
    ...snap,
    songs: snap.songs.map((s) => {
      const cleaned = cleanSongTitleAndArtist(s.title, s.artist);
      return {
        ...s,
        title: cleaned.title,
        artist: cleaned.artist,
      };
    }),
  };
}

export async function writePlaylistSnapshot(
  key: string,
  songs: Song[],
  totalCount?: number,
  totalVer?: number,
): Promise<void> {
  if (!key) return;
  const deduped = dedupeSongsByKey(songs).map(compactSong);
  const payload: PlaylistSnapshot = {
    key,
    songs: deduped,
    totalCount: Math.max(totalCount ?? 0, deduped.length),
    ...(totalVer !== undefined && totalVer > 0 ? { totalVer } : {}),
    updatedAt: Date.now(),
  };
  await echoSystem.kvSetJson(SNAPSHOT_PREFIX + key, payload);
}

/**
 * Incrementally inserts newly liked / added songs into an existing local snapshot
 * so opening the playlist afterwards stays 0ms / 0-sync instead of wiping the whole cache.
 */
export async function prependSongsToPlaylistSnapshot(
  key: string,
  addedSongs: Song[],
  totalVer?: number,
): Promise<PlaylistSnapshot | null> {
  if (!key || !addedSongs.length) return null;
  const existing = await readPlaylistSnapshot(key);
  if (!existing || !existing.songs.length) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const stamped = addedSongs.map((s, idx) =>
    compactSong({
      ...s,
      addedAt: s.addedAt && s.addedAt > 0 ? s.addedAt : nowSec + (addedSongs.length - idx),
    }),
  );

  // Dedupe by hash/fileId keeping newly added songs cleanly merged
  const existingHashes = new Set(existing.songs.map((s) => s.hash?.toLowerCase()).filter(Boolean));
  const freshToAdd = stamped.filter((s) => !s.hash || !existingHashes.has(s.hash.toLowerCase()));
  const merged = dedupeSongsByKey([...freshToAdd, ...existing.songs]);
  const nextVer = totalVer && totalVer > 0 ? totalVer : existing.totalVer;
  const payload: PlaylistSnapshot = {
    key,
    songs: merged,
    totalCount: merged.length,
    ...(nextVer && nextVer > 0 ? { totalVer: nextVer } : {}),
    updatedAt: Date.now(),
  };
  await echoSystem.kvSetJson(SNAPSHOT_PREFIX + key, payload);
  return payload;
}

/**
 * Incrementally removes unliked / deleted songs from an existing local snapshot.
 */
export async function removeSongsFromPlaylistSnapshot(
  key: string,
  removedSongs: Song[],
  totalVer?: number,
): Promise<PlaylistSnapshot | null> {
  if (!key || !removedSongs.length) return null;
  const existing = await readPlaylistSnapshot(key);
  if (!existing || !existing.songs.length) return null;

  const remFileIds = new Set(removedSongs.map((s) => s.fileId).filter((v): v is number => Boolean(v)));
  const remHashes = new Set(removedSongs.map((s) => s.hash?.toLowerCase()).filter((v): v is string => Boolean(v)));
  const remIds = new Set(removedSongs.map((s) => s.id).filter(Boolean));

  const nextSongs = existing.songs.filter((s) => {
    if (s.fileId && remFileIds.has(s.fileId)) return false;
    if (s.hash && remHashes.has(s.hash.toLowerCase())) return false;
    if (!s.hash && s.id && remIds.has(s.id)) return false;
    return true;
  });

  const nextVer = totalVer && totalVer > 0 ? totalVer : existing.totalVer;
  const payload: PlaylistSnapshot = {
    key,
    songs: nextSongs,
    totalCount: nextSongs.length,
    ...(nextVer && nextVer > 0 ? { totalVer: nextVer } : {}),
    updatedAt: Date.now(),
  };
  await echoSystem.kvSetJson(SNAPSHOT_PREFIX + key, payload);
  return payload;
}

/**
 * Stamps the latest cloud `totalVer` onto an up-to-date local snapshot after a local mutation
 * (e.g. toggling favorite or adding/removing tracks on this device).
 */
export async function stampPlaylistSnapshotVersion(
  key: string,
  totalVer: number,
  expectedCount?: number,
): Promise<void> {
  if (!key || !totalVer || totalVer <= 0) return;
  const existing = await readPlaylistSnapshot(key);
  if (!existing || !existing.songs.length) return;
  if (expectedCount && expectedCount > 0 && existing.songs.length !== expectedCount) return;
  if (existing.totalVer === totalVer) return;
  await echoSystem.kvSetJson(SNAPSHOT_PREFIX + key, {
    ...existing,
    totalVer,
    updatedAt: Date.now(),
  });
}

export async function deletePlaylistSnapshot(key: string): Promise<void> {
  if (!key) return;
  await echoSystem.kvDelete(SNAPSHOT_PREFIX + key);
}

export function getLocalDateKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function readDailyRecommendSnapshot(userId: string, dateKey = getLocalDateKey()): Promise<Song[] | null> {
  if (!userId) return null;
  const saved = await echoSystem.kvGetJson<{ dateKey: string; songs: Song[] } | null>(
    `${DAILY_PREFIX}${userId}`,
    null,
  );
  if (!saved || saved.dateKey !== dateKey || !Array.isArray(saved.songs) || !saved.songs.length) {
    return null;
  }
  return saved.songs;
}

export async function writeDailyRecommendSnapshot(
  userId: string,
  songs: Song[],
  dateKey = getLocalDateKey(),
): Promise<void> {
  if (!userId || !songs.length) return;
  await echoSystem.kvSetJson(`${DAILY_PREFIX}${userId}`, {
    dateKey,
    songs: songs.map(compactSong),
    updatedAt: Date.now(),
  });
}
