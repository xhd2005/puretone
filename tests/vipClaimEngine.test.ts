import { describe, expect, it, vi } from 'vitest';
import {
  buildMonthCalendar,
  calcStreakDays,
  executeFullVipClaim,
  type VipClaimDeps,
} from '@/services/vip/vipClaimEngine';

function createMockDeps(overrides: Partial<VipClaimDeps> = {}): VipClaimDeps {
  return {
    claimDayVip: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    upgradeDayVip: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    claimConceptAd: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    reportListeningEvent: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    uploadPlayHistory: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    reportListenTime: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    reportYouthListenSong: vi.fn().mockRejectedValue(new Error('ERR_EMPTY_RESPONSE')),
    getBatchUnionVipInfo: vi.fn().mockResolvedValue({
      status: 200,
      body: {
        data: {
          busi_vip: {
            '10086': [{ product_type: 'tvip', is_vip: 1, vip_end_time: '2026-12-10 23:59:59' }],
          },
        },
      },
    }),
    getUserVipDetail: vi.fn().mockResolvedValue({ status: 200, body: {} }),
    getMonthVipRecord: vi.fn().mockResolvedValue({ status: 200, body: { data: { list: [] } } }),
    ...overrides,
  };
}

describe('Daily VIP 4-step claim engine', () => {
  it('completes all 4 steps and ignores legacy /youth/listen/song ERR_EMPTY_RESPONSE', async () => {
    const deps = createMockDeps();
    const res = await executeFullVipClaim(
      { userid: '10086', token: 'tok_abc' },
      { today: '2026-11-26', mixsongid: 123456, deps },
    );

    expect(res.ok).toBe(true);
    expect(res.alreadyClaimed).toBe(false);
    expect(res.expiryText).toBe('2026-12-10 23:59:59');
    expect(res.steps).toEqual({
      baseVip: 'success',
      upgrade: 'success',
      conceptAd: 'success',
      conceptListen: 'success',
    });
  });

  it('recognizes 131001 already claimed and 297001/297002 privilege already upgraded', async () => {
    const deps = createMockDeps({
      claimDayVip: vi.fn().mockRejectedValue({ response: { body: { error_code: 131001 } } }),
      upgradeDayVip: vi.fn().mockResolvedValue({ status: 200, body: { status: 0, error_code: 297001 } }),
    });

    const res = await executeFullVipClaim(
      { userid: '10086', token: 'tok_abc' },
      { today: '2026-11-26', deps },
    );

    expect(res.ok).toBe(true);
    expect(res.alreadyClaimed).toBe(true);
    expect(res.steps.baseVip).toBe('already');
    expect(res.steps.upgrade).toBe('already');
  });

  it('falls back across the 4 listen-checkin channels when channel 1 & 2 fail', async () => {
    const deps = createMockDeps({
      reportListeningEvent: vi.fn().mockRejectedValue(new Error('CSCC failed')),
      uploadPlayHistory: vi.fn().mockResolvedValue({ status: 200, body: { status: 0, error_code: 500 } }),
      reportListenTime: vi.fn().mockResolvedValue({ status: 200, body: { status: 1, error_code: 0 } }),
    });

    const res = await executeFullVipClaim(
      { userid: '10086', token: 'tok_abc' },
      { today: '2026-11-26', deps },
    );

    expect(res.steps.conceptListen).toBe('success');
    expect(res.details.conceptListen).toContain('听歌时长上报');
  });

  it('builds month calendar grid and computes consecutive streak days accurately', () => {
    const claimed = new Set(['2026-11-24', '2026-11-25', '2026-11-26']);
    const failed = new Set(['2026-11-20']);
    const base = new Date(2026, 10, 26); // Nov 26, 2026

    const cal = buildMonthCalendar(claimed, failed, base);
    expect(cal.claimedInMonth).toBe(3);
    expect(cal.daysInMonth).toBe(30);
    expect(cal.cells.find((c) => c.dateStr === '2026-11-26')?.isToday).toBe(true);
    expect(cal.cells.find((c) => c.dateStr === '2026-11-20')?.isFailed).toBe(true);

    expect(calcStreakDays(claimed, base)).toBe(3);
  });
});
