import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Song } from '@/types/music';
import { sanitizeAudioCacheLimitMb, useSettingsStore } from '@/stores/settings';
import {
  prependSongsToPlaylistSnapshot,
  readDailyRecommendSnapshot,
  readPlaylistSnapshot,
  removeSongsFromPlaylistSnapshot,
  shouldSyncPlaylistSnapshot,
  stampPlaylistSnapshotVersion,
  writeDailyRecommendSnapshot,
  writePlaylistSnapshot,
} from '@/services/playback/playlistSnapshotCache';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';
import { zhCN, zhTW, enUS } from '@/i18n/messages';

vi.mock('@/native/echoPlayer', () => ({
  echoPlayer: {
    setEqPreset: vi.fn().mockResolvedValue(undefined),
    setTransitionFadeMs: vi.fn().mockResolvedValue(undefined),
    setVolumeLeveling: vi.fn().mockResolvedValue(undefined),
    setLiveLyric: vi.fn().mockResolvedValue(undefined),
    setAudioCacheMaxMb: vi.fn().mockResolvedValue({ usedBytes: 0, maxBytes: 2048 * 1024 * 1024, maxMb: 2048 }),
    isTrackCached: vi.fn().mockResolvedValue(false),
  },
}));

import { echoPlayer } from '@/native/echoPlayer';
import { resolvePlayableStream } from '@/services/playback/urlResolver';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function makeSong(id: string, title: string, fileId?: number): Song {
  return {
    id,
    hash: `HASH_${id}`,
    fileId,
    title,
    artist: 'Tester',
    album: 'Test Album',
    duration: 210,
    coverUrl: 'https://example.com/c.jpg',
  };
}

describe('v2.4.9 P0 Dark Mode Root Safety Guard', () => {
  it('forbids :global(.dark) inside scoped styles of AccountVipSheet.vue to prevent root opacity collapse', () => {
    const vueSrc = readFileSync(resolve(process.cwd(), 'src/components/AccountVipSheet.vue'), 'utf8');
    expect(vueSrc).not.toContain(':global(.dark)');
  });
});

describe('v2.4.9 Configurable 2GB Audio Cache & Offline Playback Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
  });

  it('defaults audioCacheMaxMb to 2048 (2GB) and validates all 5 tiers', async () => {
    const settings = useSettingsStore();
    expect(settings.audioCacheMaxMb).toBe(2048);

    expect(sanitizeAudioCacheLimitMb(500)).toBe(500);
    expect(sanitizeAudioCacheLimitMb(1024)).toBe(1024);
    expect(sanitizeAudioCacheLimitMb(2048)).toBe(2048);
    expect(sanitizeAudioCacheLimitMb(4096)).toBe(4096);
    expect(sanitizeAudioCacheLimitMb(0)).toBe(0);
    expect(sanitizeAudioCacheLimitMb(999)).toBe(2048);

    await settings.importSnapshot({ audioCacheMaxMb: 4096 });
    expect(settings.exportSnapshot().audioCacheMaxMb).toBe(4096);
    expect(echoPlayer.setAudioCacheMaxMb).toHaveBeenCalledWith(4096);
  });

  it('serves local cached audio immediately when offline and track exists in Media3 SimpleCache', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(echoPlayer.isTrackCached).mockResolvedValueOnce(true);

    const song = makeSong('offline1', 'Midnight Echo');
    const resolved = await resolvePlayableStream(song, 'flac', { bypassCache: true, enableUnblock: false });

    expect(resolved.sourceTag).toBe('本地缓存');
    expect(resolved.url).toContain('melune.local.cache');
    expect(echoPlayer.isTrackCached).toHaveBeenCalledTimes(1);
  });
});

describe('v2.4.9 Smart Playlist Version Sync, Incremental Mutations & Home Daily Snapshot', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  it('skips redundant full re-sync when cloud totalVer and trackCount match snapshot', () => {
    const songs = [makeSong('1', 'A', 101), makeSong('2', 'B', 102)];
    expect(shouldSyncPlaylistSnapshot(null, { totalVer: 50, trackCount: 2 })).toBe(true);
    expect(
      shouldSyncPlaylistSnapshot({ key: 'fav', songs, totalCount: 2, totalVer: 50, updatedAt: Date.now() }, {
        totalVer: 50,
        trackCount: 2,
      }),
    ).toBe(false);
    // Remote change on another device bumps totalVer -> syncs automatically
    expect(
      shouldSyncPlaylistSnapshot({ key: 'fav', songs, totalCount: 2, totalVer: 50, updatedAt: Date.now() }, {
        totalVer: 51,
        trackCount: 3,
      }),
    ).toBe(true);
    // Legacy snapshot without totalVer -> upgrades once
    expect(
      shouldSyncPlaylistSnapshot({ key: 'fav', songs, totalCount: 2, updatedAt: Date.now() }, {
        totalVer: 50,
        trackCount: 2,
      }),
    ).toBe(true);
  });

  it('updates playlist snapshot in-place on local add/remove and stamps cloud totalVer', async () => {
    const s1 = makeSong('1', 'Song One', 101);
    const s2 = makeSong('2', 'Song Two', 102);
    const s3 = makeSong('3', 'Song Three', 103);

    await writePlaylistSnapshot('fav_key', [s1, s2], 2, 100);
    await prependSongsToPlaylistSnapshot('fav_key', [s3]);
    await stampPlaylistSnapshotVersion('fav_key', 101, 3);

    let snap = await readPlaylistSnapshot('fav_key');
    expect(snap?.songs.length).toBe(3);
    expect(snap?.songs[0].id).toBe('3');
    expect(snap?.totalVer).toBe(101);
    expect(shouldSyncPlaylistSnapshot(snap, { totalVer: 101, trackCount: 3 })).toBe(false);

    await removeSongsFromPlaylistSnapshot('fav_key', [s2]);
    await stampPlaylistSnapshotVersion('fav_key', 102, 2);
    snap = await readPlaylistSnapshot('fav_key');
    expect(snap?.songs.map((s) => s.id)).toEqual(['3', '1']);
    expect(snap?.totalVer).toBe(102);
  });

  it('persists daily recommendations keyed by user & local date', async () => {
    const list = [makeSong('d1', 'Morning Light')];
    await writeDailyRecommendSnapshot('u123', list, '2026-11-28');
    expect((await readDailyRecommendSnapshot('u123', '2026-11-28'))?.length).toBe(1);
    expect(await readDailyRecommendSnapshot('u123', '2026-11-29')).toBeNull();
  });

  it('ships complete v2.4.9 i18n keys and version bump', () => {
    const keys = [
      'playlist.syncedToast',
      'settings.cacheUnlimited',
      'settings.cacheUnlimitedShort',
      'settings.audioCacheCleared',
      'settings.snapshotCacheTitle',
      'settings.snapshotCacheSub',
      'settings.snapshotCleared',
    ] as const;
    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.\d+\.\d+$/);
  });
});
