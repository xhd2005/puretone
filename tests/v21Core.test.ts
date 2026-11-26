import { describe, expect, it } from 'vitest';
import { computeTitleCrossfade } from '@/composables/useCollapsingTitle';
import { sortPlaylistSongs } from '@/services/playback/playlistSnapshotCache';
import { stripAudioExtension } from '@/services/kugou/kugouEngine';
import { compareSemver, pickReleaseApkAsset } from '@/services/update/updateService';
import type { Song } from '@/types/music';

function makeSong(overrides: Partial<Song> & { id: string; title: string; artist: string }): Song {
  return {
    hash: overrides.id,
    album: '',
    duration: 210,
    coverUrl: '',
    ...overrides,
  };
}

describe('computeTitleCrossfade (zero-overlap header dead zone)', () => {
  it('never renders large and compact titles visible at the same scroll position', () => {
    for (let y = 0; y <= 120; y += 1) {
      const state = computeTitleCrossfade(y);
      const bothVisible = state.largeTitleOpacity > 0 && state.compactTitleOpacity > 0;
      expect(bothVisible, `Overlap detected at scrollTop=${y}`).toBe(false);
    }
  });

  it('starts with large title full opacity at top and transitions cleanly to compact title', () => {
    const top = computeTitleCrossfade(0);
    expect(top.largeTitleOpacity).toBe(1);
    expect(top.compactTitleOpacity).toBe(0);
    expect(top.headerGlassActive).toBe(false);

    const deadZone = computeTitleCrossfade(30);
    expect(deadZone.largeTitleOpacity).toBe(0);
    expect(deadZone.compactTitleOpacity).toBe(0);
    expect(deadZone.headerGlassActive).toBe(true);

    const scrolled = computeTitleCrossfade(60);
    expect(scrolled.largeTitleOpacity).toBe(0);
    expect(scrolled.compactTitleOpacity).toBe(1);
    expect(scrolled.headerGlassActive).toBe(true);
  });
});

describe('sortPlaylistSongs', () => {
  const oldest = makeSong({ id: '1', title: '晴天', artist: '周杰伦', addedAt: 1000, fileId: 101 });
  const middle = makeSong({ id: '2', title: '稻香', artist: '周杰伦', addedAt: 2000, fileId: 202 });
  const newest = makeSong({ id: '3', title: '雨爱', artist: '杨丞琳', addedAt: 3000, fileId: 303 });

  it('places most recently added tracks first in newest mode (fixes inverted 我喜欢 list)', () => {
    const sorted = sortPlaylistSongs([oldest, middle, newest], 'newest');
    expect(sorted.map((s) => s.id)).toEqual(['3', '2', '1']);
  });

  it('falls back cleanly to fileId or reverse order when addedAt is missing', () => {
    const byFileId = sortPlaylistSongs(
      [
        makeSong({ id: 'a', title: 'A', artist: 'X', fileId: 10 }),
        makeSong({ id: 'b', title: 'B', artist: 'X', fileId: 50 }),
        makeSong({ id: 'c', title: 'C', artist: 'X', fileId: 30 }),
      ],
      'newest',
    );
    expect(byFileId.map((s) => s.id)).toEqual(['b', 'c', 'a']);

    const byIndex = sortPlaylistSongs(
      [
        makeSong({ id: 'first', title: 'First', artist: 'X' }),
        makeSong({ id: 'last', title: 'Last', artist: 'X' }),
      ],
      'newest',
    );
    expect(byIndex.map((s) => s.id)).toEqual(['last', 'first']);
  });

  it('supports oldest, title, and artist sort modes without mutating source array', () => {
    const input = [newest, oldest, middle];
    expect(sortPlaylistSongs(input, 'oldest').map((s) => s.id)).toEqual(['1', '2', '3']);
    expect(sortPlaylistSongs(input, 'artist')[0].artist).toBe('杨丞琳');
    expect(input.map((s) => s.id)).toEqual(['3', '1', '2']);
  });
});

describe('stripAudioExtension', () => {
  it('strips common audio file suffixes case-insensitively while preserving normal titles', () => {
    expect(stripAudioExtension('晴天.mp3')).toBe('晴天');
    expect(stripAudioExtension('稻香 - 周杰伦.FLAC')).toBe('稻香 - 周杰伦');
    expect(stripAudioExtension('雨爱 (Live).m4a')).toBe('雨爱 (Live)');
    expect(stripAudioExtension('夜曲.wav')).toBe('夜曲');
    expect(stripAudioExtension('Mr. Brightside')).toBe('Mr. Brightside');
  });
});

describe('updateService semver and APK asset selection', () => {
  it('compares semver tags accurately with or without v prefix', () => {
    expect(compareSemver('v2.1.0', '2.0.0')).toBeGreaterThan(0);
    expect(compareSemver('2.1.0', '2.1.0')).toBe(0);
    expect(compareSemver('2.0.9', '2.1.0')).toBeLessThan(0);
    expect(compareSemver('v2.10.0', 'v2.2.0')).toBeGreaterThan(0);
  });

  it('prefers release APK over debug APK and falls back gracefully', () => {
    const picked = pickReleaseApkAsset([
      { name: 'PureTone-debug.apk', browser_download_url: 'https://example.com/debug.apk', size: 9_000_000 },
      { name: 'PureTone-v2.1.0-release.apk', browser_download_url: 'https://example.com/release.apk', size: 8_500_000 },
    ]);
    expect(picked?.fileName).toBe('PureTone-v2.1.0-release.apk');
    expect(picked?.url).toBe('https://example.com/release.apk');

    const fallback = pickReleaseApkAsset([
      { name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt' },
      { name: 'app-debug.apk', browser_download_url: 'https://example.com/app-debug.apk', size: 9_100_000 },
    ]);
    expect(fallback?.fileName).toBe('app-debug.apk');
  });
});
