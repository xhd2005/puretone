import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { PlaylistSummary, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import {
  backfillMissingPlaylistCovers,
  getPlaylistCacheKey,
} from '@/services/playback/playlistCoverResolver';
import { deletePlaylistSnapshot } from '@/services/playback/playlistSnapshotCache';
import { useAccountsStore } from './accounts';
import { usePlayerStore } from './player';

export const usePlaylistsStore = defineStore('playlists', () => {
  const playlists = ref<PlaylistSummary[]>([]);
  const loading = ref(false);
  const loadedUserId = ref('');

  const accounts = useAccountsStore();
  const player = usePlayerStore();

  const favoritePlaylist = computed(() => playlists.value.find((p) => p.isFavorite) || null);
  const createdPlaylists = computed(() =>
    playlists.value.filter((p) => !p.isFavorite && p.isOwner !== false),
  );
  const collectedPlaylists = computed(() =>
    playlists.value.filter((p) => !p.isFavorite && p.isOwner === false),
  );
  /** All playlists the user can add songs into ("我喜欢" first, then all self-created playlists). */
  const editablePlaylists = computed<PlaylistSummary[]>(() => {
    const out: PlaylistSummary[] = [];
    if (favoritePlaylist.value) out.push(favoritePlaylist.value);
    out.push(...createdPlaylists.value);
    return out;
  });

  function reset() {
    playlists.value = [];
    loadedUserId.value = '';
  }

  function findById(globalOrListId: string): PlaylistSummary | null {
    const clean = String(globalOrListId || '').trim();
    if (!clean) return null;
    return (
      playlists.value.find(
        (p) => p.globalCollectionId === clean || p.listId === clean || p.id === clean,
      ) || null
    );
  }

  function isCollected(globalCollectionId: string): PlaylistSummary | null {
    const clean = String(globalCollectionId || '').trim();
    if (!clean) return null;
    return (
      playlists.value.find(
        (p) => p.globalCollectionId === clean || p.id === clean,
      ) || null
    );
  }

  async function fetchPlaylists(force = false): Promise<PlaylistSummary[]> {
    const uid = accounts.activeAccount?.userid || '';
    if (!accounts.isLoggedIn || !uid) {
      reset();
      return [];
    }
    if (!force && loadedUserId.value === uid && playlists.value.length > 0) {
      return playlists.value;
    }
    loading.value = true;
    try {
      const list = await kugouApi.getUserPlaylists();
      playlists.value = list;
      loadedUserId.value = uid;
      void backfillMissingPlaylistCovers(list);
      return list;
    } finally {
      loading.value = false;
    }
  }

  async function createPlaylist(options: { name: string; isPrivate?: boolean }): Promise<PlaylistSummary | null> {
    const cleanName = options.name.trim();
    if (!cleanName) return null;
    const res = await kugouApi.createPlaylist(cleanName, Boolean(options.isPrivate));
    if (!res.ok) {
      throw new Error(res.message || '创建歌单失败');
    }
    const list = await fetchPlaylists(true);
    const created =
      (res.listId ? list.find((p) => p.listId === res.listId || p.id === res.listId) : null) ||
      list.find((p) => !p.isFavorite && p.isOwner !== false && p.name === cleanName) ||
      null;
    return created;
  }

  async function updatePlaylist(options: {
    listId: string;
    name: string;
    intro?: string;
    totalVer?: number;
  }): Promise<boolean> {
    const cleanName = options.name.trim();
    if (!options.listId || !cleanName) return false;
    const target = playlists.value.find((p) => p.listId === options.listId || p.id === options.listId);
    const res = await kugouApi.updatePlaylist({
      listId: options.listId,
      name: cleanName,
      intro: options.intro ?? target?.description ?? '',
      totalVer: options.totalVer ?? target?.totalVer ?? 0,
    });
    if (!res.ok) {
      throw new Error(res.message || '更新歌单失败');
    }
    if (target) {
      target.name = cleanName;
      if (options.intro !== undefined) target.description = options.intro;
    }
    void fetchPlaylists(true);
    return true;
  }

  async function deletePlaylist(pl: Pick<PlaylistSummary, 'id' | 'listId' | 'globalCollectionId'>): Promise<boolean> {
    const targetListId = pl.listId || pl.id;
    if (!targetListId) return false;
    const res = await kugouApi.deletePlaylist(targetListId);
    if (!res.ok) {
      throw new Error(res.message || '删除歌单失败');
    }
    const cacheKey = getPlaylistCacheKey({
      id: pl.id,
      listId: pl.listId,
      globalCollectionId: pl.globalCollectionId,
    });
    playlists.value = playlists.value.filter(
      (item) => item.listId !== targetListId && item.id !== pl.id,
    );
    void deletePlaylistSnapshot(cacheKey);
    return true;
  }

  async function collectPlaylist(options: {
    name: string;
    globalCollectionId: string;
    createUserId?: string;
    createListId?: string;
  }): Promise<boolean> {
    const res = await kugouApi.collectPlaylist(options);
    if (!res.ok) {
      throw new Error(res.message || '收藏歌单失败');
    }
    await fetchPlaylists(true);
    return true;
  }

  async function addSongsToPlaylist(playlist: PlaylistSummary, songs: Song[]): Promise<number> {
    const targetListId = playlist.listId || playlist.id;
    const validSongs = songs.filter((s) => Boolean(s?.hash));
    if (!targetListId || !validSongs.length) return 0;

    // Chunk at 30 songs per call so large batch additions never hit KuGou payload limits
    for (let i = 0; i < validSongs.length; i += 30) {
      const chunk = validSongs.slice(i, i + 30);
      await kugouApi.addTracksToPlaylist(targetListId, chunk);
    }

    const found = playlists.value.find((p) => p.listId === targetListId || p.id === playlist.id);
    if (found) {
      found.trackCount += validSongs.length;
    }
    void deletePlaylistSnapshot(getPlaylistCacheKey(playlist));
    if (playlist.isFavorite) {
      const nextFav = new Set(player.favoriteHashes);
      for (const s of validSongs) {
        if (s.hash) nextFav.add(s.hash.toLowerCase());
      }
      player.favoriteHashes = nextFav;
    }
    return validSongs.length;
  }

  async function removeSongsFromPlaylist(
    playlist: Pick<PlaylistSummary, 'id' | 'listId' | 'isFavorite'>,
    songs: Song[],
  ): Promise<number> {
    const targetListId = playlist.listId || playlist.id;
    const fileIds = songs.map((s) => Number(s.fileId || 0)).filter((fid) => Number.isFinite(fid) && fid > 0);
    if (!targetListId || !fileIds.length) return 0;

    for (let i = 0; i < fileIds.length; i += 50) {
      const chunk = fileIds.slice(i, i + 50);
      await kugouApi.removeTracksFromPlaylist(targetListId, chunk);
    }

    const found = playlists.value.find((p) => p.listId === targetListId || p.id === playlist.id);
    if (found) {
      found.trackCount = Math.max(0, found.trackCount - fileIds.length);
    }
    if (playlist.isFavorite) {
      const nextFav = new Set(player.favoriteHashes);
      for (const s of songs) {
        if (s.hash) nextFav.delete(s.hash.toLowerCase());
      }
      player.favoriteHashes = nextFav;
    }
    return fileIds.length;
  }

  return {
    playlists,
    loading,
    favoritePlaylist,
    createdPlaylists,
    collectedPlaylists,
    editablePlaylists,
    reset,
    findById,
    isCollected,
    fetchPlaylists,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    collectPlaylist,
    addSongsToPlaylist,
    removeSongsFromPlaylist,
  };
});
