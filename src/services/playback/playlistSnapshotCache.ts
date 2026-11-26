import type { Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';

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

export async function readPlaylistSnapshot(key: string): Promise<PlaylistSnapshot | null> {
  if (!key) return null;
  const snap = await echoSystem.kvGetJson<PlaylistSnapshot | null>(SNAPSHOT_PREFIX + key, null);
  if (!snap || !Array.isArray(snap.songs)) return null;
  return snap;
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
