import type { Router } from 'vue-router';
import type { Song, SongArtistRef } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';

export interface ArtistNavUiBridge {
  nowPlayingOpen: boolean;
  actionSheetSong: Song | null;
  commentsSheetSong: Song | null;
  artistPickerCandidates: SongArtistRef[] | null;
  showToast: (msg: string, durationMs?: number) => void;
}

/**
 * Pure helper: returns individual artists for a track (from structured `song.artists` or splitting `song.artist`).
 */
export function extractArtistRefsFromSong(song: Pick<Song, 'artist' | 'artists'>): SongArtistRef[] {
  if (Array.isArray(song.artists) && song.artists.length > 0) {
    return song.artists.filter((a) => Boolean(a?.name?.trim()));
  }
  const names = String(song.artist || '')
    .split(/\s*(?:\/|、|&|,|，|\bfeat\.?\b|\bft\.?\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s && s !== '未知歌手');
  return names.map((name) => ({ id: '', name }));
}

export async function navigateToArtistRef(
  refItem: SongArtistRef,
  router: Router,
  ui: ArtistNavUiBridge,
  labels: { resolving: string; notFound: string },
): Promise<boolean> {
  let targetId = refItem.id.trim();
  let targetName = refItem.name.trim();
  let targetAvatar = '';

  if (!targetId) {
    ui.showToast(labels.resolving, 1200);
    const resolved = await kugouApi.resolveArtistByName(targetName);
    if (!resolved) {
      ui.showToast(labels.notFound);
      return false;
    }
    targetId = resolved.id;
    targetName = resolved.name || targetName;
    targetAvatar = resolved.avatar;
  }

  ui.artistPickerCandidates = null;
  ui.actionSheetSong = null;
  ui.commentsSheetSong = null;
  ui.nowPlayingOpen = false;

  await router.push({
    path: `/artist/${encodeURIComponent(targetId)}`,
    query: {
      name: targetName,
      ...(targetAvatar ? { avatar: targetAvatar } : {}),
    },
  });
  return true;
}

export async function openArtistProfileFromSong(
  song: Song,
  router: Router,
  ui: ArtistNavUiBridge,
  labels: { resolving: string; notFound: string },
): Promise<void> {
  const refs = extractArtistRefsFromSong(song);
  if (!refs.length) {
    ui.showToast(labels.notFound);
    return;
  }
  if (refs.length > 1) {
    ui.artistPickerCandidates = refs;
    return;
  }
  await navigateToArtistRef(refs[0], router, ui, labels);
}

function isValidAlbumId(raw?: string | number | null): string {
  const s = String(raw ?? '').trim();
  return s && s !== '0' && s !== 'null' && s !== 'undefined' ? s : '';
}

export async function openAlbumFromSong(
  song: Song,
  router: Router,
  ui: ArtistNavUiBridge,
  fallbackNotFound?: string,
): Promise<boolean> {
  let albumId = isValidAlbumId(song.albumId);
  let albumName = String(song.album || '').trim();
  let albumCover = song.coverUrl || '';

  // 1. Resolve via KuGou privilege_lite by track hash (returns recommend_album_id & real albumname!)
  if (!albumId && song.hash) {
    try {
      const enriched = await kugouApi.getSongEnrichedMeta(song);
      if (enriched) {
        albumId = isValidAlbumId(enriched.albumId);
        if (!albumName && enriched.albumName) albumName = enriched.albumName;
        if (!albumCover && enriched.coverUrl) albumCover = enriched.coverUrl;
      }
    } catch {
      // fallback below
    }
  }

  // 2. Fallback: search exact track by title + artist to recover AlbumID (works even on old cached playlists)
  if (!albumId && song.title) {
    try {
      const found = await kugouApi.searchSongs(`${song.title} ${song.artist}`.trim(), 1, 6);
      const matched =
        found.songs.find((s) => s.hash && song.hash && s.hash.toLowerCase() === song.hash.toLowerCase() && isValidAlbumId(s.albumId)) ||
        found.songs.find((s) => isValidAlbumId(s.albumId));
      if (matched) {
        albumId = isValidAlbumId(matched.albumId);
        if (!albumName && matched.album) albumName = matched.album;
        if (!albumCover && matched.coverUrl) albumCover = matched.coverUrl;
      }
    } catch {
      // fallback below
    }
  }

  // 3. Final fallback: search album directly by album name
  if (!albumId && albumName) {
    const found = await kugouApi.searchAlbums(`${albumName} ${song.artist}`.trim(), 1, 5).catch(() => []);
    albumId = isValidAlbumId(found[0]?.id);
    if (!albumCover && found[0]?.coverUrl) albumCover = found[0].coverUrl;
  }

  if (!albumId) {
    if (fallbackNotFound) ui.showToast(fallbackNotFound);
    return false;
  }
  ui.actionSheetSong = null;
  ui.commentsSheetSong = null;
  ui.nowPlayingOpen = false;
  await router.push({
    path: `/album/${encodeURIComponent(albumId)}`,
    query: {
      name: albumName,
      cover: albumCover,
      artist: song.artist || '',
    },
  });
  return true;
}
