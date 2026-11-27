import { describe, expect, it, vi } from 'vitest';
import {
  classifyUserPlaylistOwnership,
  formatPlaylistTrackAddPayload,
} from '@/services/kugou/kugouEngine';
import { echoSystem } from '@/native/echoSystem';
import {
  deletePlaylistSnapshot,
  readPlaylistSnapshot,
  writePlaylistSnapshot,
} from '@/services/playback/playlistSnapshotCache';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';
import type { Song } from '@/types/music';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    hash: 'AABBCCDD11223344',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 269,
    coverUrl: '',
    albumId: '960303',
    mixSongId: 12345678,
    ...overrides,
  };
}

describe('v2.4.3 Cloud Playlist Management Core', () => {
  it('formats track add payload with raw UTF-8 title (no %XX encoding) and strips delimiters', () => {
    const payload = formatPlaylistTrackAddPayload([
      makeSong({ title: '晴天', hash: 'HASH01', albumId: '100', mixSongId: 200 }),
      makeSong({ title: 'Hello, World | Remix', hash: 'HASH02', albumId: '', mixSongId: 0 }),
    ]);

    expect(payload).not.toContain('%E6');
    expect(payload).toBe('晴天|HASH01|100|200,Hello World Remix|HASH02|0|0');
  });

  it('skips entries without valid audio hash when building track add payload', () => {
    const payload = formatPlaylistTrackAddPayload([
      makeSong({ title: 'No Hash Track', hash: '' }),
      makeSong({ title: 'Valid Track', hash: '  ABC123  ', albumId: '42', mixSongId: 99 }),
    ]);

    expect(payload).toBe('Valid Track|ABC123|42|99');
  });

  it('classifies favorite, self-created, private, and collected user playlists accurately', () => {
    const fav = classifyUserPlaylistOwnership({ name: '我喜欢', listid: 2, is_pri: 0, type: 0 }, '8888');
    expect(fav).toEqual({ isFavorite: true, isOwner: true, isPrivate: false });

    const ownPublic = classifyUserPlaylistOwnership(
      { name: '深夜循环', listid: 12, is_pri: 0, type: 0, source: 1, list_create_userid: 8888 },
      '8888',
    );
    expect(ownPublic).toEqual({ isFavorite: false, isOwner: true, isPrivate: false });

    const ownPrivate = classifyUserPlaylistOwnership(
      { name: '私藏曲库', listid: 15, is_pri: 1, type: 0, source: 1, list_create_userid: 8888 },
      '8888',
    );
    expect(ownPrivate).toEqual({ isFavorite: false, isOwner: true, isPrivate: true });

    const collectedOtherCreator = classifyUserPlaylistOwnership(
      { name: '精选纯音乐', listid: 30, is_pri: 0, type: 1, source: 2, list_create_userid: 9999 },
      '8888',
    );
    expect(collectedOtherCreator).toEqual({ isFavorite: false, isOwner: false, isPrivate: false });

    const collectedByType = classifyUserPlaylistOwnership(
      { name: '电台歌单', listid: 31, is_pri: 0, type: 1, list_create_userid: 0 },
      '8888',
    );
    expect(collectedByType).toEqual({ isFavorite: false, isOwner: false, isPrivate: false });
  });

  it('supports writing, reading, and deleting playlist snapshots cleanly', async () => {
    const store = new Map<string, unknown>();
    const setSpy = vi.spyOn(echoSystem, 'kvSetJson').mockImplementation(async (k, v) => {
      store.set(k, v);
    });
    const getSpy = vi.spyOn(echoSystem, 'kvGetJson').mockImplementation(async (k, fallback) => {
      return (store.has(k) ? store.get(k) : fallback) as any;
    });
    const delSpy = vi.spyOn(echoSystem, 'kvDelete').mockImplementation(async (k) => {
      store.delete(k);
    });

    try {
      const key = 'test_playlist_v243';
      const sample = [makeSong({ id: 'a', hash: 'H1' })];
      await writePlaylistSnapshot(key, sample, 1);
      const loaded = await readPlaylistSnapshot(key);
      expect(loaded?.songs.length).toBe(1);
      expect(loaded?.songs[0]?.hash).toBe('H1');

      await deletePlaylistSnapshot(key);
      const afterDelete = await readPlaylistSnapshot(key);
      expect(afterDelete).toBeNull();
    } finally {
      setSpy.mockRestore();
      getSpy.mockRestore();
      delSpy.mockRestore();
    }
  });

  it('reports a valid v2.4.x semver as the fallback app version', () => {
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.4\.\d+$/);
  });
});
