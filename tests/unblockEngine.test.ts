import { describe, expect, it } from 'vitest';
import { extractUrlsFromPayload, scoreCandidate } from '@/services/playback/unblockEngine';
import { buildPaletteFromSamples, DEFAULT_APPLE_PALETTE } from '@/services/playback/coverPalette';

describe('Unblock matching & cover palette engines', () => {
  it('scores original studio tracks high and penalizes unwanted DJ/karaoke variants', () => {
    const target = { title: '晴天', artist: '周杰伦', duration: 269 };

    const exact = scoreCandidate(target, { title: '晴天', artist: '周杰伦', duration: 269 });
    const karaoke = scoreCandidate(target, { title: '晴天 (伴奏)', artist: '周杰伦', duration: 269 });
    const dj = scoreCandidate(target, { title: '晴天 DJ版', artist: '周杰伦', duration: 269 });

    expect(exact).toBeGreaterThanOrEqual(0.95);
    expect(karaoke).toBe(0);
    expect(dj).toBe(0);
  });

  it('extracts nested audio URLs from heterogeneous API payloads', () => {
    const urls = extractUrlsFromPayload({
      data: {
        url: ['https://cdn1.example.com/a.flac'],
        backupUrl: 'https://cdn2.example.com/b.mp3',
      },
    });
    expect(urls).toEqual([
      'https://cdn1.example.com/a.flac',
      'https://cdn2.example.com/b.mp3',
    ]);
  });

  it('extracts vibrant dynamic accents and falls back to Apple Coral Red for monochrome covers', () => {
    const vivid = buildPaletteFromSamples([
      { r: 24, g: 120, b: 230 },
      { r: 40, g: 160, b: 245 },
      { r: 12, g: 45, b: 120 },
    ]);
    expect(vivid.accentLight).not.toBe(DEFAULT_APPLE_PALETTE.accentLight);
    expect(vivid.fluidColors).toHaveLength(4);

    const gray = buildPaletteFromSamples([
      { r: 120, g: 120, b: 120 },
      { r: 20, g: 20, b: 20 },
    ]);
    expect(gray.accentLight).toBe(DEFAULT_APPLE_PALETTE.accentLight);
    expect(gray.accentDark).toBe(DEFAULT_APPLE_PALETTE.accentDark);
  });
});
