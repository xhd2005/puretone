import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AccountProfile, VipTierStatus } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import {
  fixCoverUrl,
  kugouApi,
  setActiveKugouAuth,
  setKugouVerificationHandler,
  type VerificationChallenge,
} from '@/services/kugou/kugouEngine';
import { fetchVipExpiryText } from '@/services/vip/vipClaimEngine';

const STORAGE_KEY = 'accounts.v1';

interface PersistedAccounts {
  accounts: AccountProfile[];
  activeUserId: string;
}

function isFutureDate(dateStr?: string): boolean {
  if (!dateStr) return false;
  const ts = Date.parse(String(dateStr).replace(/-/g, '/'));
  return !Number.isNaN(ts) && ts > Date.now();
}

function parseVipTiers(vipData: Record<string, any> | null, fallbackListenExpiry: string) {
  const busiList: any[] = Array.isArray(vipData?.busi_vip) ? vipData!.busi_vip : [];

  const findTier = (pred: (item: any) => boolean): VipTierStatus => {
    const matched = busiList.find(pred);
    if (!matched) return { active: false };
    const end = String(matched.vip_end_time || matched.end_time || '').trim();
    const active = Number(matched.is_vip) === 1 || isFutureDate(end);
    return { active, endTime: end || undefined };
  };

  let svip = findTier((b) => /svip|super/i.test(String(b?.product_type || b?.busi_type || '')));
  if (!svip.active && vipData?.su_vip_end_time) {
    const end = String(vipData.su_vip_end_time).trim();
    if (isFutureDate(end)) svip = { active: true, endTime: end };
  }

  let luxuryVip = findTier((b) => /^vip$/i.test(String(b?.product_type || '')) || /luxury|music/i.test(String(b?.busi_type || '')));
  if (!luxuryVip.active && vipData?.vip_end_time && Number(vipData?.vip_type) === 6) {
    const end = String(vipData.vip_end_time).trim();
    if (isFutureDate(end)) luxuryVip = { active: true, endTime: end };
  }

  let conceptVip = findTier((b) => /concept|youth/i.test(String(b?.busi_type || b?.product_type || '')));
  if (!conceptVip.active && vipData?.m_end_time) {
    const end = String(vipData.m_end_time).trim();
    if (isFutureDate(end)) conceptVip = { active: true, endTime: end };
  }

  let listenVip = findTier((b) => /tvip|roam|listen|changting/i.test(String(b?.product_type || b?.busi_type || '')));
  const listenFallback = String(vipData?.tvip_end_time || vipData?.roam_end_time || fallbackListenExpiry || '').trim();
  if ((!listenVip.active || !listenVip.endTime) && isFutureDate(listenFallback)) {
    listenVip = { active: true, endTime: listenFallback };
  }

  return { svip, luxuryVip, conceptVip, listenVip };
}

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<AccountProfile[]>([]);
  const activeUserId = ref<string>('');
  const refreshing = ref(false);

  const pendingChallenge = ref<VerificationChallenge | null>(null);
  let challengeResolver: ((ok: boolean) => void) | null = null;

  const activeAccount = computed<AccountProfile | null>(
    () => accounts.value.find((a) => a.userid === activeUserId.value) || accounts.value[0] || null,
  );
  const isLoggedIn = computed(() => Boolean(activeAccount.value?.token));

  function syncActiveAuth() {
    const acc = activeAccount.value;
    setActiveKugouAuth(acc ? { token: acc.token, userid: acc.userid, t1: acc.t1 } : null);
  }

  async function persist() {
    await echoSystem.kvSetJson(STORAGE_KEY, {
      accounts: accounts.value,
      activeUserId: activeUserId.value,
    });
  }

  async function hydrate() {
    const saved = await echoSystem.kvGetJson<PersistedAccounts>(STORAGE_KEY, {
      accounts: [],
      activeUserId: '',
    });
    accounts.value = Array.isArray(saved.accounts) ? saved.accounts : [];
    activeUserId.value = saved.activeUserId || accounts.value[0]?.userid || '';
    syncActiveAuth();

    setKugouVerificationHandler((challenge) => {
      return new Promise<boolean>((resolve) => {
        pendingChallenge.value = challenge;
        challengeResolver = resolve;
      });
    });

    if (activeAccount.value) {
      void refreshAccountProfile(activeAccount.value.userid);
    }
  }

  function resolveVerification(passed: boolean) {
    const fn = challengeResolver;
    challengeResolver = null;
    pendingChallenge.value = null;
    fn?.(passed);
  }

  async function addOrUpdateAccount(profile: AccountProfile) {
    const idx = accounts.value.findIndex((a) => a.userid === profile.userid);
    if (idx >= 0) {
      accounts.value[idx] = { ...accounts.value[idx], ...profile, lastUsedAt: Date.now() };
    } else {
      accounts.value.unshift({ ...profile, addedAt: Date.now(), lastUsedAt: Date.now() });
    }
    activeUserId.value = profile.userid;
    syncActiveAuth();
    await persist();
    void refreshAccountProfile(profile.userid);
  }

  async function switchAccount(userid: string) {
    const target = accounts.value.find((a) => a.userid === userid);
    if (!target) return;
    target.lastUsedAt = Date.now();
    activeUserId.value = target.userid;
    syncActiveAuth();
    await persist();
    void refreshAccountProfile(userid);
  }

  async function removeAccount(userid: string) {
    accounts.value = accounts.value.filter((a) => a.userid !== userid);
    if (activeUserId.value === userid) {
      activeUserId.value = accounts.value[0]?.userid || '';
    }
    syncActiveAuth();
    await persist();
  }

  async function updateVipExpiry(userid: string, expiryText: string) {
    const acc = accounts.value.find((a) => a.userid === userid);
    if (!acc || !expiryText) return;
    acc.tvipEndTime = expiryText;
    acc.vipEndTime = expiryText;
    acc.isVip = true;
    if (acc.vipTiers) {
      acc.vipTiers.listenVip = { active: true, endTime: expiryText };
    }
    await persist();
  }

  async function refreshAccountProfile(userid?: string) {
    const target = accounts.value.find((a) => a.userid === (userid || activeUserId.value));
    if (!target) return;
    refreshing.value = true;
    try {
      const auth = { token: target.token, userid: target.userid };
      const [detailRes, vipRes, expiry] = await Promise.all([
        kugouApi.getUserDetail(auth).catch(() => null),
        kugouApi.getUserVipDetail(auth).catch(() => null),
        fetchVipExpiryText(auth).catch(() => ''),
      ]);

      const data = detailRes?.body?.data;
      if (data && typeof data === 'object') {
        if (data.nickname) target.nickname = String(data.nickname);
        if (data.pic) target.avatar = fixCoverUrl(String(data.pic), 240);
        if (data.vip_type !== undefined) target.vipType = Number(data.vip_type);
        if (data.p_grade !== undefined) target.pGrade = Number(data.p_grade);
        if (data.friends !== undefined) target.friends = Number(data.friends);
        if (data.follows !== undefined) target.follows = Number(data.follows);
        if (data.fans !== undefined) target.fans = Number(data.fans);
        if (data.n_visitors !== undefined || data.visitors !== undefined) {
          target.visitors = Number(data.n_visitors ?? data.visitors ?? 0);
        }
        if (data.gender !== undefined) target.gender = Number(data.gender);
        if (data.province) target.province = String(data.province);
        if (data.city) target.city = String(data.city);
        if (data.rtime) target.registerTime = Number(data.rtime);
        if (data.duration !== undefined) target.listenDurationMin = Number(data.duration);
      }

      const vipData = vipRes?.body?.data ?? null;
      const tiers = parseVipTiers(vipData, expiry || target.tvipEndTime || '');
      target.vipTiers = tiers;

      const bestListenExpiry = expiry || tiers.listenVip.endTime || '';
      if (bestListenExpiry) {
        target.tvipEndTime = bestListenExpiry;
        target.vipEndTime = bestListenExpiry;
        target.isVip = true;
      }
      await persist();
    } finally {
      refreshing.value = false;
    }
  }

  return {
    accounts,
    activeUserId,
    activeAccount,
    isLoggedIn,
    refreshing,
    pendingChallenge,
    hydrate,
    resolveVerification,
    addOrUpdateAccount,
    switchAccount,
    removeAccount,
    updateVipExpiry,
    refreshAccountProfile,
  };
});
