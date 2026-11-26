import { describe, expect, it } from 'vitest';
import { computeDetentOffsetPx } from '@/composables/useDraggableSheet';
import { build24HourSeries, buildLast7DaysSeries, createEmptyHourlyBuckets } from '@/stores/stats';
import { buildPureToneBackupJson, parsePureToneBackupJson } from '@/services/backup/backupService';
import type { PersistedSettings } from '@/stores/settings';

describe('computeDetentOffsetPx (120fps pure GPU sheet drag)', () => {
  it('computes exact detent vertical offsets without modifying height', () => {
    const detents = [0.6, 0.92];
    const vh = 1000;
    // Full detent (index 1 -> 920px) sits flush at Y = 0
    expect(computeDetentOffsetPx(detents, 1, vh, 0)).toBe(0);
    // Half detent (index 0 -> 600px) shifts downward by 320px purely via translate3d
    expect(computeDetentOffsetPx(detents, 0, vh, 0)).toBe(320);
    // Dragging downward 100px from full detent yields +100px
    expect(computeDetentOffsetPx(detents, 1, vh, 100)).toBe(100);
    // Pulling upward past max detent applies gentle 0.16 rubber-band damping
    expect(computeDetentOffsetPx(detents, 1, vh, -100)).toBe(-16);
  });

  it('handles single-detent sheets cleanly', () => {
    expect(computeDetentOffsetPx([], 0, 900, 80)).toBe(80);
    expect(computeDetentOffsetPx([], 0, 900, -50)).toBe(-8);
  });
});

describe('Listening stats Screen Time chart builders', () => {
  it('builds 7 consecutive calendar days with accurate daily average and max peak', () => {
    const refDate = new Date(2026, 10, 27); // 2026-11-27
    const series = buildLast7DaysSeries(
      {
        '2026-11-25': { seconds: 1800, plays: 8 }, // 30m
        '2026-11-27': { seconds: 3600, plays: 15 }, // 60m
      },
      refDate,
    );
    expect(series.days).toHaveLength(7);
    expect(series.days[6].dateKey).toBe('2026-11-27');
    expect(series.days[6].isToday).toBe(true);
    expect(series.days[6].shortLabel).toBe('今日');
    expect(series.days[6].minutes).toBe(60);
    expect(series.days[4].minutes).toBe(30);
    expect(series.totalMinutes).toBe(90);
    expect(series.totalPlays).toBe(23);
    expect(series.avgMinutes).toBe(Math.round(90 / 7));
    expect(series.maxMinutes).toBe(60);
  });

  it('builds 24-hour distribution and detects peak listening hour', () => {
    const hourly = createEmptyHourlyBuckets();
    hourly[9] = { seconds: 900, plays: 4 }; // 15m
    hourly[22] = { seconds: 2400, plays: 10 }; // 40m
    const series = build24HourSeries(hourly);
    expect(series.hours).toHaveLength(24);
    expect(series.peakHour).toBe(22);
    expect(series.totalMinutes).toBe(55);
    expect(series.totalPlays).toBe(14);
    expect(series.maxMinutes).toBe(40);
  });
});

describe('PureTone local JSON backup serializer & validator', () => {
  it('round-trips stats, settings, and pinned sources while never including tokens', () => {
    const settings: Partial<PersistedSettings> = {
      quality: 'flac',
      eqPreset: 'vocal',
      appearance: 'dark',
    };
    const json = buildPureToneBackupJson({
      stats: { totalPlays: 42, totalSeconds: 9000 },
      settings,
      pinnedSources: {
        'hash:abc': {
          trackKey: 'hash:abc',
          channel: 'external',
          sourcePlatform: 'kuwo',
          externalId: '12345',
          title: '晴天',
          artist: '周杰伦',
          quality: '320',
          urlCachedAt: 1700000000000,
        },
      },
    });

    expect(json).not.toContain('token');
    expect(json).not.toContain('cookie');

    const restored = parsePureToneBackupJson(json);
    expect(restored.app).toBe('PureTone');
    expect(restored.stats.totalPlays).toBe(42);
    expect(restored.settings.eqPreset).toBe('vocal');
    expect(restored.pinnedSources['hash:abc']?.sourcePlatform).toBe('kuwo');
  });

  it('rejects malformed or non-PureTone JSON gracefully', () => {
    expect(() => parsePureToneBackupJson('')).toThrow();
    expect(() => parsePureToneBackupJson('{bad json')).toThrow();
    expect(() => parsePureToneBackupJson('{"app":"OtherApp"}')).toThrow();
  });
});
