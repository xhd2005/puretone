import { describe, expect, it } from 'vitest';
import { cleanSongTitleAndArtist } from '@/services/kugou/kugouEngine';
import { resolveEffectiveLocale, translateKey } from '@/i18n';
import { enUS, zhCN, zhTW, type I18nKey } from '@/i18n/messages';

describe('cleanSongTitleAndArtist (strip redundant Artist - Title prefixes)', () => {
  it('strips matching artist prefix even when artist field is already populated', () => {
    expect(cleanSongTitleAndArtist('周杰伦 - 晴天.mp3', '周杰伦')).toEqual({
      title: '晴天',
      artist: '周杰伦',
    });
    expect(cleanSongTitleAndArtist('A-Lin - 给我一个理由忘记.flac', 'A-Lin')).toEqual({
      title: '给我一个理由忘记',
      artist: 'A-Lin',
    });
    expect(cleanSongTitleAndArtist('周杰伦、费玉清 - 千里之外', '周杰伦 / 费玉清')).toEqual({
      title: '千里之外',
      artist: '周杰伦 / 费玉清',
    });
  });

  it('extracts artist and title cleanly when artist field is empty', () => {
    expect(cleanSongTitleAndArtist('杨丞琳 - 雨爱.mp3', '')).toEqual({
      title: '雨爱',
      artist: '杨丞琳',
    });
  });

  it('preserves legitimate titles containing dashes that do not duplicate the artist', () => {
    expect(cleanSongTitleAndArtist('Love Story - Taylor Version', 'Taylor Swift')).toEqual({
      title: 'Love Story - Taylor Version',
      artist: 'Taylor Swift',
    });
  });
});

describe('3-locale i18n (zh-CN / zh-TW / en)', () => {
  it('resolves system locale cleanly across Simplified, Traditional, and English', () => {
    expect(resolveEffectiveLocale('system', 'zh-CN')).toBe('zh-CN');
    expect(resolveEffectiveLocale('system', 'zh-TW')).toBe('zh-TW');
    expect(resolveEffectiveLocale('system', 'zh-Hant-HK')).toBe('zh-TW');
    expect(resolveEffectiveLocale('system', 'en-US')).toBe('en');
    expect(resolveEffectiveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveEffectiveLocale('zh-TW', 'en-US')).toBe('zh-TW');
  });

  it('keeps all three locale dictionaries 100% key-aligned and interpolates parameters', () => {
    const cnKeys = Object.keys(zhCN).sort() as I18nKey[];
    const twKeys = Object.keys(zhTW).sort() as I18nKey[];
    const enKeys = Object.keys(enUS).sort() as I18nKey[];
    expect(twKeys).toEqual(cnKeys);
    expect(enKeys).toEqual(cnKeys);

    expect(translateKey('zh-CN', 'about.authorTitle')).toContain('Hayden Xue');
    expect(translateKey('zh-TW', 'about.authorTitle')).toContain('Hayden Xue');
    expect(translateKey('en', 'about.authorTitle')).toContain('Hayden Xue');
    expect(translateKey('en', 'common.totalSongs', { count: 42 })).toBe('42 tracks');
    // Ensure universal non-brand-specific media control wording
    expect(translateKey('zh-CN', 'settings.mediaControl').toLowerCase()).not.toContain('vivo');
    expect(translateKey('en', 'settings.mediaControl').toLowerCase()).not.toContain('vivo');
  });
});
