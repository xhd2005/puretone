import type { PlaylistSortMode, Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import { stripAudioExtension } from '@/services/kugou/kugouEngine';

export interface PlaylistSnapshot {
  key: string;
  songs: Song[];
  totalCount: number;
  updatedAt: number;
}

const SNAPSHOT_PREFIX = 'playlist.snap.v1:';

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

export function dedupeSongsByKey(songs: Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of songs) {
    const key = s.fileId
      ? `fid:${s.fileId}`
      : s.hash
        ? `h:${s.hash.toLowerCase()}`
        : `id:${s.id}:${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
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
    songs: snap.songs.map((s) => ({
      ...s,
      title: stripAudioExtension(s.title) || s.title,
      artist: stripAudioExtension(s.artist) || s.artist,
    })),
  };
}

export async function writePlaylistSnapshot(key: string, songs: Song[], totalCount?: number): Promise<void> {
  if (!key) return;
  const deduped = dedupeSongsByKey(songs).map(compactSong);
  const payload: PlaylistSnapshot = {
    key,
    songs: deduped,
    totalCount: Math.max(totalCount ?? 0, deduped.length),
    updatedAt: Date.now(),
  };
  await echoSystem.kvSetJson(SNAPSHOT_PREFIX + key, payload);
}
