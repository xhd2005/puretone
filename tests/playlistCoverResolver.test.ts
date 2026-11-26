import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import {
  extractDistinctCoversFromSongs,
  isValidCoverUrl,
  recordPlaylistCoversFromSongs,
  getResolvedPlaylistCovers,
} from '@/services/playback/playlistCoverResolver';
import { dedupeSongsByKey } from '@/services/playback/playlistSnapshotCache';

function makeSong(idx: number, coverUrl: string, fileId?: number): Song {
  return {
    id: `song-${idx}`,
    hash: `HASH${idx}`,
    fileId,
    title: `Track ${idx}`,
    artist: 'Artist',
    album: 'Album',
    duration: 210,
    coverUrl,
  };
}

describe('Playlist cover resolver & snapshot deduplication', () => {
  it('filters KuGou default placeholder covers and empty strings', () => {
    expect(isValidCoverUrl('')).toBe(false);
    expect(isValidCoverUrl('https://imge.kugou.com/soft/collection/default.jpg')).toBe(false);
    expect(isValidCoverUrl('https://imge.kugou.com/stdmusic/20130807185439172736.png')).toBe(false);
    expect(isValidCoverUrl('https://imge.kugou.com/stdmusic/480/20240101/cover1.jpg')).toBe(true);
  });

  it('extracts up to 4 unique valid covers for Apple Music 2x2 collage', () => {
    const songs = [
      makeSong(1, 'https://imge.kugou.com/soft/collection/default.jpg'),
      makeSong(2, 'https://cdn.example.com/a.jpg'),
      makeSong(3, 'https://cdn.example.com/a.jpg'), // duplicate
      makeSong(4, 'https://cdn.example.com/b.jpg'),
      makeSong(5, 'https://cdn.example.com/c.jpg'),
      makeSong(6, 'https://cdn.example.com/d.jpg'),
      makeSong(7, 'https://cdn.example.com/e.jpg'),
    ];

    const covers = extractDistinctCoversFromSongs(songs, 4);
    expect(covers).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
      'https://cdn.example.com/c.jpg',
      'https://cdn.example.com/d.jpg',
    ]);

    recordPlaylistCoversFromSongs('pl-test-collage', songs);
    expect(getResolvedPlaylistCovers('pl-test-collage', 'https://imge.kugou.com/soft/collection/default.jpg')).toEqual(
      covers,
    );
    expect(getResolvedPlaylistCovers('pl-test-collage', 'https://cdn.example.com/explicit.jpg')).toEqual([
      'https://cdn.example.com/explicit.jpg',
    ]);
  });

  it('deduplicates large 1000+ song playlists cleanly by fileId or hash', () => {
    const s1 = makeSong(1, 'https://cdn.example.com/1.jpg', 1001);
    const s1Dup = makeSong(1, 'https://cdn.example.com/1.jpg', 1001);
    const s2 = makeSong(2, 'https://cdn.example.com/2.jpg', 1002);
    const s3 = makeSong(3, 'https://cdn.example.com/3.jpg');
    const s3Dup = { ...makeSong(3, 'https://cdn.example.com/3.jpg'), hash: 'hash3' };

    const result = dedupeSongsByKey([s1, s1Dup, s2, s3, s3Dup]);
    expect(result).toHaveLength(3);
  });
});
