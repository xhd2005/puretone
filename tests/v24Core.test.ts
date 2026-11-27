import { describe, expect, it } from 'vitest';
import {
  extractSongArtistRefs,
  formatCompactCount,
  normalizeClimaxRange,
  normalizeCommentItem,
  normalizeSong,
  parseHotSearchTabs,
} from '@/services/kugou/kugouEngine';
import { extractArtistRefsFromSong } from '@/services/playback/artistNavigation';
import { shouldShowComplianceDisclaimer } from '@/components/ComplianceDisclaimerModal.vue';
import { formatPosterDateStamp } from '@/services/share/lyricPosterRenderer';
import { buildLast7DaysSeries } from '@/stores/stats';
import { enUS, zhCN, zhTW } from '@/i18n/messages';

describe('MELUNE v2.4.0 brand, hot search, comments, artist, climax & i18n checks', () => {
  it('enforces mandatory disclaimer re-acceptance after every version upgrade', () => {
    expect(shouldShowComplianceDisclaimer(null, '2.4.0')).toBe(true);
    expect(shouldShowComplianceDisclaimer({ accepted: false, acceptedVersion: '2.4.0' }, '2.4.0')).toBe(true);
    expect(shouldShowComplianceDisclaimer({ accepted: true, version: '2.3.0' }, '2.4.0')).toBe(true);
    expect(shouldShowComplianceDisclaimer({ accepted: true, acceptedVersion: '2.4.0' }, '2.4.0')).toBe(false);
    expect(shouldShowComplianceDisclaimer({ accepted: true, acceptedVersion: 'v2.4.0' }, '2.4.0')).toBe(false);
  });

  it('parses multi-tab KuGou hot search charts with rank, reason, and tags', () => {
    const tabs = parseHotSearchTabs({
      data: {
        list: [
          {
            name: '热搜榜',
            keywords: [
              { keyword: '千千阙歌', reason: '经典港乐重温', icon: 2 },
              { keyword: '晴天', reason: '', icon: 1 },
              { keyword: '千千阙歌', reason: 'dup' },
            ],
          },
          {
            name: '飙升榜',
            keywords: [{ keyword: 'May I (Unshaken)', tag: 'HOT' }],
          },
        ],
      },
    });
    expect(tabs).toHaveLength(2);
    expect(tabs[0].title).toBe('热搜榜');
    expect(tabs[0].items).toHaveLength(2);
    expect(tabs[0].items[0]).toEqual({ keyword: '千千阙歌', reason: '经典港乐重温', tag: 'HOT', rank: 1 });
    expect(tabs[0].items[1].tag).toBe('NEW');
    expect(tabs[1].items[0].rank).toBe(1);
  });

  it('extracts structured multi-artist refs from raw KuGou songs and falls back cleanly on cached strings', () => {
    const song = normalizeSong({
      hash: 'abc123',
      songname: '周杰伦 / 费玉清 - 千里之外.mp3',
      singerinfo: [
        { id: 3520, name: '周杰伦' },
        { id: 9011, name: '费玉清' },
      ],
      album_id: '778899',
      album_name: '依然范特西',
    });
    expect(song.title).toBe('千里之外');
    expect(song.albumId).toBe('778899');
    expect(song.artists).toEqual([
      { id: '3520', name: '周杰伦' },
      { id: '9011', name: '费玉清' },
    ]);

    const fallbackRefs = extractArtistRefsFromSong({ artist: '陈慧娴 / 张学友' });
    expect(fallbackRefs).toEqual([
      { id: '', name: '陈慧娴' },
      { id: '', name: '张学友' },
    ]);

    const singleRef = extractSongArtistRefs({ author_id: '8821' }, '陈慧娴');
    expect(singleRef).toEqual([{ id: '8821', name: '陈慧娴' }]);
  });

  it('normalizes song comments, compact counts, and chorus climax ranges', () => {
    const cmt = normalizeCommentItem(
      {
        id: 'c1',
        tid: 't1',
        user_name: '仰望星空',
        user_pic: 'http://img.kugou.com/{size}/a.jpg',
        vip_type: 6,
        content: '从岛上回来那段太震撼了',
        addtime: '2026-11-27 12:00:00',
        location: '河北',
        like: { likenum: 225 },
        reply_num: 11,
      },
      'sp_99',
    );
    expect(cmt.userAvatar).toBe('https://img.kugou.com/120/a.jpg');
    expect(cmt.isVip).toBe(true);
    expect(cmt.likeCount).toBe(225);
    expect(cmt.replyCount).toBe(11);
    expect(cmt.specialId).toBe('sp_99');

    expect(formatCompactCount(470, 'zh-CN')).toBe('470');
    expect(formatCompactCount(17400, 'zh-CN')).toBe('1.7万');
    expect(formatCompactCount(17400, 'zh-TW')).toBe('1.7萬');
    expect(formatCompactCount(17400, 'en')).toBe('17.4K');

    const climax = normalizeClimaxRange({ data: [{ start_time: 62000, timelength: 30000 }] }, 210000);
    expect(climax).toEqual({ startMs: 62000, endMs: 92000 });
  });

  it('localizes 7-day listening stats, poster date stamp, and MELUNE 3-locale brand parity', () => {
    const refDate = new Date(2026, 10, 27); // Nov 27, 2026 (Fri)
    const enSeries = buildLast7DaysSeries({}, refDate, 'en');
    const twSeries = buildLast7DaysSeries({}, refDate, 'zh-TW');
    expect(enSeries.days[6].shortLabel).toBe('Today');
    expect(enSeries.days[6].fullLabel).toContain('Nov 27');
    expect(twSeries.days[5].shortLabel).toBe('週四');

    expect(formatPosterDateStamp(refDate)).toBe('NOV 27 · 2026');

    const cnKeys = Object.keys(zhCN).sort();
    expect(Object.keys(zhTW).sort()).toEqual(cnKeys);
    expect(Object.keys(enUS).sort()).toEqual(cnKeys);

    expect(zhCN['app.fullName']).toBe('弥音 · MELUNE');
    expect(zhTW['app.fullName']).toBe('彌音 · MELUNE');
    expect(enUS['app.fullName']).toBe('MELUNE');
    expect(zhCN['app.slogan']).toBe('余音绵延，音乐无界。');
    expect(enUS['app.slogan']).toBe('Where Music Becomes Memory.');
    // Ensure compact zero-overflow speed normal label across all 3 locales
    expect(enUS['song.speedNormal']).toBe('1.0x');
    expect(zhCN['song.speedNormal']).toBe('1.0x');
  });
});
