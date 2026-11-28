import { describe, expect, it } from 'vitest';
import {
  advanceMonotonicLyricTime,
  computeWordSweepPosPercent,
  findActiveLyricIndex,
} from '@/utils/lyricClock';
import {
  formatCommentTime,
  parseFloorReplyContent,
  replaceKugouEmoticons,
} from '@/utils/commentFormat';
import { zhCN, zhTW, enUS } from '@/i18n/messages';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';

describe('v2.4.7 Monotonic Lyric Clock & Flicker-Free Sweep', () => {
  it('prevents backward 250ms IPC jitter while allowing genuine seeks', () => {
    // Normal forward advance
    expect(advanceMonotonicLyricTime(10000, 10016, true)).toBe(10016);
    // Small backward IPC phase jitter (< 450ms) stays locked forward -> zero flicker!
    expect(advanceMonotonicLyricTime(10240, 10190, true)).toBe(10240);
    expect(advanceMonotonicLyricTime(10240, 9820, true)).toBe(10240);
    // Genuine backward seek (>= 450ms) jumps immediately
    expect(advanceMonotonicLyricTime(10240, 5000, true)).toBe(5000);
    // Paused scrubbing always tracks raw time
    expect(advanceMonotonicLyricTime(10240, 10100, false)).toBe(10100);
  });

  it('computes smooth 100% -> 0% GPU gradient sweep position without layer swap', () => {
    const word = { startMs: 1000, durationMs: 400 };
    expect(computeWordSweepPosPercent(word, 900)).toBe(100);
    expect(computeWordSweepPosPercent(word, 1000)).toBe(100);
    expect(computeWordSweepPosPercent(word, 1200)).toBeCloseTo(50, 2);
    expect(computeWordSweepPosPercent(word, 1400)).toBe(0);
    expect(computeWordSweepPosPercent(word, 2500)).toBe(0);
  });

  it('finds active lyric line accurately with lookahead', () => {
    const lines = [{ startMs: 1000 }, { startMs: 4500 }, { startMs: 8200 }];
    expect(findActiveLyricIndex(lines, 500)).toBe(-1);
    expect(findActiveLyricIndex(lines, 950)).toBe(0);
    expect(findActiveLyricIndex(lines, 4450)).toBe(1);
    expect(findActiveLyricIndex(lines, 9000)).toBe(2);
  });
});

describe('v2.4.7 Floor Reply Parser, Emoticons & Compact Timestamps', () => {
  it('strips redundant //@parentUser:parentComment suffix when replying directly to parent', () => {
    const raw =
      '这个女人让一半的港台歌星崛起[撇嘴]//@suibcy23:这个女人确实可怕！网络不发达时，我们不知道不怪，现在既然知道了，送上我们最真诚的祝福吧！[玫瑰]';
    const parsed = parseFloorReplyContent(raw, {
      pid: '0',
      parentUserName: 'suibcy23',
      parentContent: '这个女人确实可怕！网络不发达时，我们不知道不怪，现在既然知道了，送上我们最真诚的祝福吧！[玫瑰]',
    });

    expect(parsed.body).toBe('这个女人让一半的港台歌星崛起😒');
    expect(parsed.replyToUser).toBeUndefined();
    expect(parsed.quotedSnippet).toBeUndefined();
  });

  it('still strips redundant parent quote even when parent author later changed nickname', () => {
    const raw = '这不是苍老师么么//@⑦べ真的爱你╬:终于要当妈妈了，很开心[微笑][微笑]';
    const parsed = parseFloorReplyContent(raw, {
      parentUserName: '真的爱你LL',
      parentContent: '终于要当妈妈了，很开心[微笑][微笑]',
    });

    expect(parsed.body).toBe('这不是苍老师么么');
    expect(parsed.replyToUser).toBeUndefined();
    expect(parsed.quotedSnippet).toBeUndefined();
  });

  it('preserves replyToUser and compact cleaned snippet when replying to another floor commenter', () => {
    const raw = '确实太经典了[玫瑰]//@小鸟哼哼:中岛美雪养活了半个华语乐坛//@suibcy23:这个女人确实可怕！';
    const parsed = parseFloorReplyContent(raw, {
      pid: '643563599',
      parentUserName: 'suibcy23',
      parentContent: '这个女人确实可怕！',
    });

    expect(parsed.body).toBe('确实太经典了🌹');
    expect(parsed.replyToUser).toBe('小鸟哼哼');
    expect(parsed.quotedSnippet).toBe('中岛美雪养活了半个华语乐坛');
  });

  it('replaces KuGou emoticon codes with crisp emojis while preserving unknown brackets', () => {
    expect(replaceKugouEmoticons('太好听了[玫瑰][微笑][大哭][自定义标签]')).toBe(
      '太好听了🌹😊😭[自定义标签]',
    );
  });

  it('formats timestamps concisely for current vs earlier years', () => {
    const refNow = new Date(2026, 10, 28);
    expect(formatCommentTime('2020-12-28 04:04:59', refNow)).toBe('2020-12-28');
    expect(formatCommentTime('2026-11-27 23:15:08', refNow)).toBe('11-27 23:15');
    expect(formatCommentTime('Just now', refNow)).toBe('Just now');
  });
});

describe('v2.4.7 Poetic Splash Copy & Version Bump', () => {
  it('uses the poetic dual-line splash centerpiece across all 3 locales', () => {
    expect(zhCN['splash.line1']).toBe('让每一段旋律，都拥有自己的空间');
    expect(zhCN['splash.line2']).toBe('让每一种情绪，都能找到共鸣');
    expect(zhTW['splash.line1']).toBe('讓每一段旋律，都擁有自己的空間');
    expect(zhTW['splash.line2']).toBe('讓每一種情緒，都能找到共鳴');
    expect(enUS['splash.line1']).toBe('A sanctuary for every melody');
    expect(enUS['splash.line2']).toBe('A resonance for every emotion');
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.\d+\.\d+$/);
  });
});
