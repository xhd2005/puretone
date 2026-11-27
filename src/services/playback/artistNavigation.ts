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

export async function openAlbumFromSong(
  song: Song,
  router: Router,
  ui: ArtistNavUiBridge,
  fallbackNotFound?: string,
): Promise<boolean> {
  let albumId = song.albumId?.trim() || '';
  if (!albumId && song.album) {
    const found = await kugouApi.searchAlbums(`${song.album} ${song.artist}`, 1, 5).catch(() => []);
    albumId = found[0]?.id || '';
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
      name: song.album || '',
      cover: song.coverUrl || '',
      artist: song.artist || '',
    },
  });
  return true;
}
