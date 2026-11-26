import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AccountProfile, VipLedgerEntry, VipStepDetails, VipStepState } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import {
  buildMonthCalendar,
  calcStreakDays,
  executeFullVipClaim,
  fetchMonthClaimDates,
  fetchVipExpiryText,
  formatLocalDate,
  runStepBaseVip,
  runStepConceptAd,
  runStepConceptListen,
  runStepUpgrade,
  type MonthCalendarData,
  type VipStepKey,
} from '@/services/vip/vipClaimEngine';
import { useAccountsStore } from './accounts';
import { useSettingsStore } from './settings';
import { useUiStore } from './ui';

const LEDGER_STORAGE_KEY = 'vip.ledger.v1';
const MONTH_CACHE_KEY = 'vip.monthDates.v1';

function emptySteps(enableConcept = true): VipStepState {
  return {
    baseVip: 'idle',
    upgrade: 'idle',
    conceptAd: enableConcept ? 'idle' : 'skipped',
    conceptListen: enableConcept ? 'idle' : 'skipped',
  };
}

function emptyDetails(): VipStepDetails {
  return { baseVip: '', upgrade: '', conceptAd: '', conceptListen: '' };
}

export const useVipStore = defineStore('vip', () => {
  const ledger = ref<VipLedgerEntry[]>([]);
  const monthDatesByUser = ref<Record<string, string[]>>({});
  const stepsDate = ref<string>(formatLocalDate());
  const stepsByUser = ref<Record<string, VipStepState>>({});
  const detailsByUser = ref<Record<string, VipStepDetails>>({});

  const isClaiming = ref(false);
  const isBatchClaiming = ref(false);
  const batchProgressText = ref('');

  const accountsStore = useAccountsStore();
  const settingsStore = useSettingsStore();

  function ensureTodaySteps(userId: string) {
    const today = formatLocalDate();
    if (stepsDate.value !== today) {
      stepsDate.value = today;
      stepsByUser.value = {};
      detailsByUser.value = {};
    }
    if (!stepsByUser.value[userId]) {
      stepsByUser.value[userId] = emptySteps(settingsStore.enableConceptTasks);
    }
    if (!detailsByUser.value[userId]) {
      detailsByUser.value[userId] = emptyDetails();
    }
  }

  const activeUserId = computed(() => accountsStore.activeAccount?.userid || '');

  const currentSteps = computed<VipStepState>(() => {
    const uid = activeUserId.value;
    if (!uid) return emptySteps(settingsStore.enableConceptTasks);
    return stepsByUser.value[uid] || emptySteps(settingsStore.enableConceptTasks);
  });

  const currentDetails = computed<VipStepDetails>(() => {
    const uid = activeUserId.value;
    if (!uid) return emptyDetails();
    return detailsByUser.value[uid] || emptyDetails();
  });

  function getClaimedDatesSet(userId: string): Set<string> {
    const set = new Set<string>(monthDatesByUser.value[userId] || []);
    for (const item of ledger.value) {
      if (item.userId === userId && item.status === 'success') {
        set.add(item.claimDate);
      }
    }
    return set;
  }

  function getFailedDatesSet(userId: string): Set<string> {
    const set = new Set<string>();
    for (const item of ledger.value) {
      if (item.userId === userId && item.status === 'failed') {
        set.add(item.claimDate);
      }
    }
    return set;
  }

  function isAccountClaimedToday(userId: string): boolean {
    const today = formatLocalDate();
    return getClaimedDatesSet(userId).has(today);
  }

  const claimedToday = computed(() => {
    const uid = activeUserId.value;
    if (!uid) return false;
    return isAccountClaimedToday(uid);
  });

  const needsAttentionDot = computed(() => {
    if (!accountsStore.isLoggedIn) return false;
    if (settingsStore.autoClaimAllAccounts && accountsStore.accounts.length > 1) {
      return accountsStore.accounts.some((a) => !isAccountClaimedToday(a.userid));
    }
    return !claimedToday.value;
  });

  const currentCalendar = computed<MonthCalendarData>(() => {
    const uid = activeUserId.value;
    return buildMonthCalendar(getClaimedDatesSet(uid), getFailedDatesSet(uid));
  });

  const currentStreakDays = computed(() => {
    const uid = activeUserId.value;
    return uid ? calcStreakDays(getClaimedDatesSet(uid)) : 0;
  });

  const currentLogs = computed(() => {
    const uid = activeUserId.value;
    return ledger.value.filter((l) => !uid || l.userId === uid).slice(0, 40);
  });

  const vipRemainingDays = computed<number | null>(() => {
    const endStr = accountsStore.activeAccount?.tvipEndTime || accountsStore.activeAccount?.vipEndTime;
    if (!endStr) return null;
    const ts = Date.parse(endStr.replace(/-/g, '/'));
    if (Number.isNaN(ts)) return null;
    const diff = Math.ceil((ts - Date.now()) / (24 * 3600 * 1000));
    return Math.max(0, diff);
  });

  async function persist() {
    await Promise.all([
      echoSystem.kvSetJson(LEDGER_STORAGE_KEY, ledger.value.slice(0, 200)),
      echoSystem.kvSetJson(MONTH_CACHE_KEY, monthDatesByUser.value),
    ]);
  }

  async function hydrate() {
    const [savedLedger, savedMonths] = await Promise.all([
      echoSystem.kvGetJson<VipLedgerEntry[]>(LEDGER_STORAGE_KEY, []),
      echoSystem.kvGetJson<Record<string, string[]>>(MONTH_CACHE_KEY, {}),
    ]);
    ledger.value = Array.isArray(savedLedger) ? savedLedger : [];
    monthDatesByUser.value = savedMonths && typeof savedMonths === 'object' ? savedMonths : {};
  }

  async function syncMonthRecords(account?: AccountProfile | null) {
    const acc = account || accountsStore.activeAccount;
    if (!acc) return;
    const dates = await fetchMonthClaimDates({ token: acc.token, userid: acc.userid });
    if (dates.length > 0) {
      const merged = Array.from(new Set([...(monthDatesByUser.value[acc.userid] || []), ...dates]));
      monthDatesByUser.value[acc.userid] = merged;
      await persist();
    }
  }

  function recordLedger(entry: Omit<VipLedgerEntry, 'id'>) {
    const existingIdx = ledger.value.findIndex(
      (e) => e.userId === entry.userId && e.claimDate === entry.claimDate,
    );
    const full: VipLedgerEntry = {
      ...entry,
      id: `${entry.userId}:${entry.claimDate}`,
    };
    if (existingIdx >= 0) {
      ledger.value[existingIdx] = full;
    } else {
      ledger.value.unshift(full);
    }
  }

  async function claimAccount(account?: AccountProfile | null, { silent = false, mixsongid }: { silent?: boolean; mixsongid?: number } = {}) {
    const acc = account || accountsStore.activeAccount;
    if (!acc) return null;
    if (isClaiming.value) return null;

    isClaiming.value = true;
    ensureTodaySteps(acc.userid);
    const ui = useUiStore();

    try {
      const result = await executeFullVipClaim(acc, {
        enableConceptTasks: settingsStore.enableConceptTasks,
        mixsongid,
        onStep: (step, status, detail) => {
          ensureTodaySteps(acc.userid);
          stepsByUser.value[acc.userid][step] = status;
          detailsByUser.value[acc.userid][step] = detail;
        },
      });

      if (result.expiryText) {
        await accountsStore.updateVipExpiry(acc.userid, result.expiryText);
      }

      if (result.ok) {
        const list = monthDatesByUser.value[acc.userid] || [];
        if (!list.includes(result.claimDate)) {
          monthDatesByUser.value[acc.userid] = [...list, result.claimDate];
        }
      }

      recordLedger({
        userId: acc.userid,
        claimDate: result.claimDate,
        claimedAt: Date.now(),
        expiryText: result.expiryText,
        upgradeSuccess: result.steps.upgrade === 'success' || result.steps.upgrade === 'already',
        conceptSuccess:
          result.steps.conceptAd === 'success' ||
          result.steps.conceptAd === 'already' ||
          result.steps.conceptListen === 'success' ||
          result.steps.conceptListen === 'already',
        status: result.ok ? 'success' : 'failed',
        message: result.ok
          ? result.alreadyClaimed
            ? '今日已领 · 已同步'
            : '每日四步签到成功'
          : result.error,
      });

      await persist();
      void syncMonthRecords(acc);

      if (!silent) {
        ui.showToast(
          result.ok
            ? result.alreadyClaimed
              ? `${acc.nickname} 今日已领取`
              : `${acc.nickname} 畅听 VIP +1 天`
            : result.error || '签到未成功',
        );
      }
      return result;
    } finally {
      isClaiming.value = false;
    }
  }

  async function retrySingleStep(step: VipStepKey, mixsongid?: number) {
    const acc = accountsStore.activeAccount;
    if (!acc || isClaiming.value) return;
    isClaiming.value = true;
    ensureTodaySteps(acc.userid);
    const auth = { token: acc.token, userid: acc.userid };
    const today = formatLocalDate();
    const ui = useUiStore();

    try {
      stepsByUser.value[acc.userid][step] = 'running';
      let res;
      if (step === 'baseVip') res = await runStepBaseVip(auth, today);
      else if (step === 'upgrade') res = await runStepUpgrade(auth);
      else if (step === 'conceptAd') res = await runStepConceptAd(auth);
      else res = await runStepConceptListen(auth, mixsongid);

      stepsByUser.value[acc.userid][step] = res.status;
      detailsByUser.value[acc.userid][step] = res.detail;

      if (res.ok) {
        const expiry = await fetchVipExpiryText(auth);
        if (expiry) await accountsStore.updateVipExpiry(acc.userid, expiry);
        ui.showToast(res.detail || '重试成功');
      } else {
        ui.showToast(res.detail || '重试未成功');
      }
    } finally {
      isClaiming.value = false;
    }
  }

  async function claimAllAccounts(silent = false) {
    if (isBatchClaiming.value || accountsStore.accounts.length === 0) return;
    isBatchClaiming.value = true;
    const ui = useUiStore();
    let okCount = 0;

    try {
      const list = [...accountsStore.accounts];
      for (let i = 0; i < list.length; i += 1) {
        const acc = list[i];
        batchProgressText.value = `正在签到 (${i + 1}/${list.length}) ${acc.nickname}`;
        const res = await claimAccount(acc, { silent: true });
        if (res?.ok) okCount += 1;
      }
      if (!silent) {
        ui.showToast(`已完成 ${okCount}/${list.length} 个账号今日签到`);
      }
    } finally {
      batchProgressText.value = '';
      isBatchClaiming.value = false;
    }
  }

  async function maybeAutoClaimOnLaunch(forceFromReminder = false) {
    if (!accountsStore.isLoggedIn) return;
    if (!forceFromReminder && !settingsStore.autoClaimOnLaunch) return;

    if (settingsStore.autoClaimAllAccounts && accountsStore.accounts.length > 1) {
      const hasUnclaimed = accountsStore.accounts.some((a) => !isAccountClaimedToday(a.userid));
      if (hasUnclaimed || forceFromReminder) {
        await claimAllAccounts(!forceFromReminder);
      }
    } else if (accountsStore.activeAccount) {
      const uid = accountsStore.activeAccount.userid;
      if (!isAccountClaimedToday(uid) || forceFromReminder) {
        await claimAccount(accountsStore.activeAccount, { silent: !forceFromReminder });
      }
    }
  }

  return {
    ledger,
    monthDatesByUser,
    isClaiming,
    isBatchClaiming,
    batchProgressText,
    currentSteps,
    currentDetails,
    claimedToday,
    needsAttentionDot,
    currentCalendar,
    currentStreakDays,
    currentLogs,
    vipRemainingDays,
    isAccountClaimedToday,
    hydrate,
    syncMonthRecords,
    claimAccount,
    retrySingleStep,
    claimAllAccounts,
    maybeAutoClaimOnLaunch,
  };
});
