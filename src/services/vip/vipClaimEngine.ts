import type { AccountProfile, VipStepDetails, VipStepState, VipStepStatus } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocalDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatSecondsDate(sec: number): string {
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '';
  return formatLocalDate(d);
}

const VIP_ERROR_HINTS: Record<number, string> = {
  131001: '今日已领取，明天再来',
  20018: '登录已过期，请重新登录',
  297001: '今日特权已升级',
  297002: '当前已享高阶特权，无需重复升级',
};

const ALREADY_CODES = new Set([131001, 297001, 297002]);
const ALREADY_RE = /已领取|已升级|无需升级|已完成|已是|已经|重复|上限|次数已用完/i;

function extractBody(resOrErr: any): Record<string, any> | null {
  if (!resOrErr || typeof resOrErr !== 'object') return null;
  if (resOrErr.response?.body && typeof resOrErr.response.body === 'object') return resOrErr.response.body;
  if (resOrErr.response?.data && typeof resOrErr.response.data === 'object') return resOrErr.response.data;
  if (resOrErr.body && typeof resOrErr.body === 'object') return resOrErr.body;
  return resOrErr;
}

export function isAlreadySatisfied(resOrErr: any): boolean {
  const body = extractBody(resOrErr);
  const code = Number(body?.error_code ?? body?.errcode ?? body?.code);
  if (Number.isFinite(code) && ALREADY_CODES.has(code)) return true;
  const msg = String(body?.error_msg ?? body?.msg ?? body?.errmsg ?? (resOrErr instanceof Error ? resOrErr.message : '')).trim();
  return Boolean(msg && ALREADY_RE.test(msg));
}

export function evaluateVipResponse(res: any, fallback: string): { ok: boolean; already: boolean; detail: string } {
  if (!res || typeof res !== 'object') return { ok: false, already: false, detail: `${fallback}（无响应）` };
  const body = extractBody(res) || {};
  const codeRaw = body.error_code ?? body.errcode ?? body.code;
  const codeNum = codeRaw !== undefined && codeRaw !== null && codeRaw !== '' ? Number(codeRaw) : null;
  const statusVal = body.status;
  const msg = String(body.error_msg ?? body.msg ?? body.errmsg ?? '').trim();

  if (isAlreadySatisfied(res)) {
    return { ok: true, already: true, detail: msg || VIP_ERROR_HINTS[codeNum || 0] || '今日已完成' };
  }
  if (statusVal === 0 || (codeNum !== null && Number.isFinite(codeNum) && codeNum !== 0 && codeNum !== 200)) {
    const hint = codeNum !== null ? VIP_ERROR_HINTS[codeNum] : '';
    return { ok: false, already: false, detail: msg || hint || (codeNum !== null ? `${fallback}（错误码 ${codeNum}）` : fallback) };
  }
  if (statusVal === 1 || codeNum === 0 || Number(res.status) === 200) {
    return { ok: true, already: false, detail: msg || '' };
  }
  return { ok: false, already: false, detail: msg || fallback };
}

export function getVipErrorMsg(err: any, fallback: string): string {
  const body = extractBody(err);
  const msg = body?.error_msg ?? body?.msg ?? body?.errmsg ?? body?.data?.msg;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  const code = Number(body?.error_code ?? body?.errcode ?? body?.code);
  if (Number.isFinite(code) && code !== 0 && code !== 200) {
    return VIP_ERROR_HINTS[code] || `${fallback}（错误码 ${code}）`;
  }
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return `${fallback}，请稍后重试`;
}

export interface MonthCalendarCell {
  empty: boolean;
  key: string;
  day?: number;
  dateStr?: string;
  isToday?: boolean;
  isClaimed?: boolean;
  isFailed?: boolean;
  isFuture?: boolean;
}

export interface MonthCalendarData {
  year: number;
  month: number;
  monthLabel: string;
  claimedInMonth: number;
  daysInMonth: number;
  cells: MonthCalendarCell[];
}

export function buildMonthCalendar(
  claimedDates: Set<string>,
  failedDates: Set<string>,
  baseDate = new Date(),
): MonthCalendarData {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const todayDay = baseDate.getDate();
  const todayStr = formatLocalDate(baseDate);
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;

  const cells: MonthCalendarCell[] = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ empty: true, key: `pad-${i}` });
  }
  let claimedInMonth = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
    const isClaimed = claimedDates.has(dateStr);
    const isFailed = !isClaimed && failedDates.has(dateStr);
    if (isClaimed) claimedInMonth += 1;
    cells.push({
      empty: false,
      key: dateStr,
      day,
      dateStr,
      isToday: dateStr === todayStr,
      isClaimed,
      isFailed,
      isFuture: day > todayDay,
    });
  }
  return {
    year,
    month: month + 1,
    monthLabel: `${year}年${pad(month + 1)}月`,
    claimedInMonth,
    daysInMonth,
    cells,
  };
}

export function calcStreakDays(claimedDates: Set<string>, baseDate = new Date()): number {
  let streak = 0;
  const cursor = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  if (!claimedDates.has(formatLocalDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (claimedDates.has(formatLocalDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface VipClaimDeps {
  claimDayVip: (day: string, auth: { token: string; userid: string }) => Promise<any>;
  upgradeDayVip: (auth: { token: string; userid: string }) => Promise<any>;
  claimConceptAd: (auth: { token: string; userid: string }) => Promise<any>;
  reportListeningEvent: (
    payload: { event: 'start' | 'end'; mixsongid: number; duration: number },
    auth: { token: string; userid: string },
  ) => Promise<any>;
  uploadPlayHistory: (mxid: number, auth: { token: string; userid: string }) => Promise<any>;
  reportListenTime: (payload: { d_sec: number; diff_sec: number }, auth: { token: string; userid: string }) => Promise<any>;
  reportYouthListenSong: (mixsongid: number, auth: { token: string; userid: string }) => Promise<any>;
  getBatchUnionVipInfo: (userid: string, auth: { token: string; userid: string }) => Promise<any>;
  getUserVipDetail: (auth: { token: string; userid: string }) => Promise<any>;
  getMonthVipRecord: (auth: { token: string; userid: string }) => Promise<any>;
}

export const defaultVipDeps: VipClaimDeps = {
  claimDayVip: kugouApi.claimDayVip,
  upgradeDayVip: kugouApi.upgradeDayVip,
  claimConceptAd: kugouApi.claimConceptAd,
  reportListeningEvent: kugouApi.reportListeningEvent,
  uploadPlayHistory: kugouApi.uploadPlayHistory,
  reportListenTime: kugouApi.reportListenTime,
  reportYouthListenSong: kugouApi.reportYouthListenSong,
  getBatchUnionVipInfo: kugouApi.getBatchUnionVipInfo,
  getUserVipDetail: kugouApi.getUserVipDetail,
  getMonthVipRecord: kugouApi.getMonthVipRecord,
};

export type VipStepKey = keyof VipStepState;

export interface SingleStepResult {
  ok: boolean;
  already: boolean;
  status: VipStepStatus;
  detail: string;
}

export interface FullClaimResult {
  ok: boolean;
  alreadyClaimed: boolean;
  userId: string;
  claimDate: string;
  expiryText: string;
  steps: VipStepState;
  details: VipStepDetails;
  error: string;
}

export async function runStepBaseVip(
  auth: { token: string; userid: string },
  today: string,
  deps: VipClaimDeps = defaultVipDeps,
): Promise<SingleStepResult> {
  try {
    const res = await deps.claimDayVip(today, auth);
    const ev = evaluateVipResponse(res, '基础畅听 VIP 领取未成功');
    if (ev.already) return { ok: true, already: true, status: 'already', detail: ev.detail || '今日已领取' };
    if (ev.ok) return { ok: true, already: false, status: 'success', detail: ev.detail || '已领取 1 天畅听 VIP' };
    return { ok: false, already: false, status: 'failed', detail: ev.detail };
  } catch (err) {
    if (isAlreadySatisfied(err)) {
      return { ok: true, already: true, status: 'already', detail: getVipErrorMsg(err, '今日已领取') };
    }
    return { ok: false, already: false, status: 'failed', detail: getVipErrorMsg(err, '领取畅听 VIP 失败') };
  }
}

export async function runStepUpgrade(
  auth: { token: string; userid: string },
  deps: VipClaimDeps = defaultVipDeps,
): Promise<SingleStepResult> {
  try {
    const res = await deps.upgradeDayVip(auth);
    const ev = evaluateVipResponse(res, '特权升级未成功');
    if (ev.already) return { ok: true, already: true, status: 'already', detail: ev.detail || '今日已升级' };
    if (ev.ok) return { ok: true, already: false, status: 'success', detail: ev.detail || '特权已升级' };
    return { ok: false, already: false, status: 'failed', detail: ev.detail };
  } catch (err) {
    if (isAlreadySatisfied(err)) {
      return { ok: true, already: true, status: 'already', detail: getVipErrorMsg(err, '今日特权已升级') };
    }
    return { ok: false, already: false, status: 'failed', detail: getVipErrorMsg(err, '特权升级失败') };
  }
}

export async function runStepConceptAd(
  auth: { token: string; userid: string },
  deps: VipClaimDeps = defaultVipDeps,
): Promise<SingleStepResult> {
  try {
    const res = await deps.claimConceptAd(auth);
    const ev = evaluateVipResponse(res, '广告打卡未成功');
    if (ev.already) return { ok: true, already: true, status: 'already', detail: ev.detail || '今日广告打卡已完成' };
    if (ev.ok) return { ok: true, already: false, status: 'success', detail: ev.detail || '广告打卡已完成' };
    return { ok: false, already: false, status: 'failed', detail: ev.detail };
  } catch (err) {
    if (isAlreadySatisfied(err)) {
      return { ok: true, already: true, status: 'already', detail: getVipErrorMsg(err, '今日广告打卡已完成') };
    }
    return { ok: false, already: false, status: 'failed', detail: getVipErrorMsg(err, '广告打卡失败') };
  }
}

/**
 * 4-channel official listen-checkin chain (ported from daily-vip-claim v2.5.2)
 * 1. reportListeningEvent (start -> end)
 * 2. uploadPlayHistory
 * 3. reportListenTime (grade info)
 * 4. legacy /youth/listen/song (non-blocking, ignores ERR_EMPTY_RESPONSE)
 */
export async function runStepConceptListen(
  auth: { token: string; userid: string },
  mixsongid = 666075191,
  deps: VipClaimDeps = defaultVipDeps,
): Promise<SingleStepResult> {
  const safeId = Number.isFinite(mixsongid) && mixsongid > 0 ? mixsongid : 666075191;
  let lastDetail = '听歌上报接口暂不可用';
  let succeededChannel = '';
  let already = false;

  // Channel 1: official start + end event pair
  try {
    await deps.reportListeningEvent({ event: 'start', mixsongid: safeId, duration: 0 }, auth).catch(() => null);
    const endRes = await deps.reportListeningEvent({ event: 'end', mixsongid: safeId, duration: 180000 }, auth);
    const ev = evaluateVipResponse(endRes, '听歌事件上报未成功');
    if (ev.already) {
      already = true;
      succeededChannel = ev.detail || '今日听歌打卡已完成';
    } else if (ev.ok) {
      succeededChannel = '已通过听歌事件上报完成';
    } else {
      lastDetail = ev.detail;
    }
  } catch (e) {
    if (isAlreadySatisfied(e)) {
      already = true;
      succeededChannel = getVipErrorMsg(e, '今日听歌打卡已完成');
    } else {
      lastDetail = getVipErrorMsg(e, '听歌事件上报失败');
    }
  }

  // Channel 2: playhistory upload
  if (!succeededChannel) {
    try {
      const histRes = await deps.uploadPlayHistory(safeId, auth);
      const ev = evaluateVipResponse(histRes, '播放历史上报未成功');
      if (ev.already) {
        already = true;
        succeededChannel = ev.detail || '今日听歌打卡已完成';
      } else if (ev.ok) {
        succeededChannel = '已通过播放历史上报完成';
      } else {
        lastDetail = ev.detail;
      }
    } catch (e) {
      if (isAlreadySatisfied(e)) {
        already = true;
        succeededChannel = getVipErrorMsg(e, '今日听歌打卡已完成');
      } else {
        lastDetail = getVipErrorMsg(e, '播放历史上报失败');
      }
    }
  }

  // Channel 3: listen grade duration report
  if (!succeededChannel) {
    try {
      const gradeRes = await deps.reportListenTime({ d_sec: 0, diff_sec: 180 }, auth);
      const ev = evaluateVipResponse(gradeRes, '听歌时长上报未成功');
      if (ev.already) {
        already = true;
        succeededChannel = ev.detail || '今日听歌打卡已完成';
      } else if (ev.ok) {
        succeededChannel = '已通过听歌时长上报完成';
      } else {
        lastDetail = ev.detail;
      }
    } catch (e) {
      if (isAlreadySatisfied(e)) {
        already = true;
        succeededChannel = getVipErrorMsg(e, '今日听歌打卡已完成');
      } else {
        lastDetail = getVipErrorMsg(e, '听歌时长上报失败');
      }
    }
  }

  // Channel 4: silent legacy endpoint
  try {
    const legacyRes = await deps.reportYouthListenSong(safeId, auth);
    if (!succeededChannel) {
      const ev = evaluateVipResponse(legacyRes, '听歌打卡未成功');
      if (ev.already) {
        already = true;
        succeededChannel = ev.detail || '今日听歌打卡已完成';
      } else if (ev.ok) {
        succeededChannel = '听歌打卡已完成';
      }
    }
  } catch {
    // ignore ERR_EMPTY_RESPONSE
  }

  if (succeededChannel) {
    return { ok: true, already, status: already ? 'already' : 'success', detail: succeededChannel };
  }
  return { ok: false, already: false, status: 'failed', detail: lastDetail };
}

export async function fetchVipExpiryText(
  auth: { token: string; userid: string },
  deps: VipClaimDeps = defaultVipDeps,
): Promise<string> {
  try {
    const unionRes = await deps.getBatchUnionVipInfo(auth.userid, auth);
    const busiVip = unionRes?.body?.data?.busi_vip;
    if (busiVip && typeof busiVip === 'object') {
      const arr = busiVip[auth.userid] || busiVip[Number(auth.userid)];
      if (Array.isArray(arr)) {
        const tvip = arr.find(
          (v: any) => v && (v.product_type === 'tvip' || v.busi_type === 'concept') && Number(v.is_vip) === 1,
        );
        if (tvip?.vip_end_time) return String(tvip.vip_end_time);
      }
    }
  } catch {
    // fallback
  }
  try {
    const vipRes = await deps.getUserVipDetail(auth);
    const list = vipRes?.body?.data?.busi_vip;
    if (Array.isArray(list)) {
      const tvip = list.find((v: any) => v?.product_type === 'tvip' && v?.vip_end_time);
      if (tvip?.vip_end_time) return String(tvip.vip_end_time);
      const anyVip = list.find((v: any) => Number(v?.is_vip) === 1 && v?.vip_end_time);
      if (anyVip?.vip_end_time) return String(anyVip.vip_end_time);
    }
  } catch {
    // ignore
  }
  return '';
}

export async function fetchMonthClaimDates(
  auth: { token: string; userid: string },
  deps: VipClaimDeps = defaultVipDeps,
): Promise<string[]> {
  try {
    const res = await deps.getMonthVipRecord(auth);
    const list = res?.body?.data?.list ?? res?.body?.data?.records ?? [];
    if (!Array.isArray(list)) return [];
    const dates: string[] = [];
    for (const item of list) {
      const raw = item?.day ?? item?.receive_day ?? item?.date ?? item?.time;
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        dates.push(raw.slice(0, 10));
      } else if (typeof raw === 'number' && raw > 1e9) {
        const fmt = formatSecondsDate(raw > 1e12 ? raw / 1000 : raw);
        if (fmt) dates.push(fmt);
      }
    }
    return Array.from(new Set(dates));
  } catch {
    return [];
  }
}

export async function executeFullVipClaim(
  account: Pick<AccountProfile, 'userid' | 'token'>,
  options: {
    enableConceptTasks?: boolean;
    mixsongid?: number;
    today?: string;
    onStep?: (step: VipStepKey, status: VipStepStatus, detail: string) => void;
    deps?: VipClaimDeps;
  } = {},
): Promise<FullClaimResult> {
  const deps = options.deps ?? defaultVipDeps;
  const today = options.today || formatLocalDate();
  const enableConcept = options.enableConceptTasks !== false;
  const auth = { token: account.token, userid: account.userid };

  const steps: VipStepState = {
    baseVip: 'idle',
    upgrade: 'idle',
    conceptAd: enableConcept ? 'idle' : 'skipped',
    conceptListen: enableConcept ? 'idle' : 'skipped',
  };
  const details: VipStepDetails = {
    baseVip: '',
    upgrade: '',
    conceptAd: '',
    conceptListen: '',
  };

  // Step 1: Base VIP
  steps.baseVip = 'running';
  options.onStep?.('baseVip', 'running', '正在领取基础畅听 VIP…');
  const s1 = await runStepBaseVip(auth, today, deps);
  steps.baseVip = s1.status;
  details.baseVip = s1.detail;
  options.onStep?.('baseVip', s1.status, s1.detail);

  // Step 2: Privilege upgrade
  steps.upgrade = 'running';
  options.onStep?.('upgrade', 'running', '正在检查特权升级…');
  const s2 = await runStepUpgrade(auth, deps);
  steps.upgrade = s2.status;
  details.upgrade = s2.detail;
  options.onStep?.('upgrade', s2.status, s2.detail);

  // Step 3 & 4: Concept edition tasks
  if (enableConcept) {
    steps.conceptAd = 'running';
    options.onStep?.('conceptAd', 'running', '正在执行概念版广告打卡…');
    const s3 = await runStepConceptAd(auth, deps);
    steps.conceptAd = s3.status;
    details.conceptAd = s3.detail;
    options.onStep?.('conceptAd', s3.status, s3.detail);

    steps.conceptListen = 'running';
    options.onStep?.('conceptListen', 'running', '正在上报听歌打卡…');
    const s4 = await runStepConceptListen(auth, options.mixsongid, deps);
    steps.conceptListen = s4.status;
    details.conceptListen = s4.detail;
    options.onStep?.('conceptListen', s4.status, s4.detail);
  }

  const expiryText = await fetchVipExpiryText(auth, deps);
  const ok = s1.ok || s2.ok || (enableConcept && (steps.conceptAd === 'success' || steps.conceptAd === 'already'));
  const error = ok ? '' : s1.detail || '签到未成功';

  return {
    ok,
    alreadyClaimed: s1.already,
    userId: account.userid,
    claimDate: today,
    expiryText,
    steps,
    details,
    error,
  };
}
