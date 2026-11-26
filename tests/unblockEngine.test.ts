import { describe, expect, it } from 'vitest';
import {
  decodeHtmlEntities,
  extractUrlsFromPayload,
  parseDurationLabel,
  parseKuwoSearchPayload,
  scoreCandidate,
} from '@/services/playback/unblockEngine';
import { buildPaletteFromSamples, DEFAULT_APPLE_PALETTE } from '@/services/playback/coverPalette';

describe('Unblock matching, Kuwo parser & cover palette engines', () => {
  it('scores original studio tracks high and penalizes unwanted DJ/karaoke/cover variants', () => {
    const target = { title: '晴天', artist: '周杰伦', duration: 269 };

    const exact = scoreCandidate(target, { title: '晴天', artist: '周杰伦', duration: 269 });
    const karaoke = scoreCandidate(target, { title: '晴天 (伴奏)', artist: '周杰伦', duration: 269 });
    const dj = scoreCandidate(target, { title: '晴天 DJ版', artist: '周杰伦', duration: 269 });
    const cover = scoreCandidate(target, { title: '晴天 (翻唱)', artist: 'RyaVocal', duration: 269 });

    expect(exact).toBeGreaterThanOrEqual(0.95);
    expect(karaoke).toBe(0);
    expect(dj).toBe(0);
    expect(cover).toBe(0);
  });

  it('parses single-quoted Kuwo r.s search payload with HTML entities cleanly', () => {
    const raw = `{'HIT':'1','abslist':[{'MUSICRID':'MUSIC_228908','SONGNAME':'晴天&nbsp;(原版)','ARTIST':'周杰伦&amp;朋友','ALBUM':'叶惠美','DURATION':'269'}]}`;
    const list = parseKuwoSearchPayload(raw);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      rid: '228908',
      title: '晴天 (原版)',
      artist: '周杰伦&朋友',
      album: '叶惠美',
      duration: 269,
    });
  });

  it('parses mm:ss and ms duration labels accurately', () => {
    expect(parseDurationLabel('4:30')).toBe(270);
    expect(parseDurationLabel('01:02:05')).toBe(3725);
    expect(parseDurationLabel(269000)).toBe(269);
    expect(parseDurationLabel(269)).toBe(269);
    expect(decodeHtmlEntities('<em>晴天</em> &amp; 周杰伦')).toBe('晴天 & 周杰伦');
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
