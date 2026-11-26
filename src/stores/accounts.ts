import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AccountProfile } from '@/types/music';
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

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<AccountProfile[]>([]);
  const activeUserId = ref<string>('');
  const refreshing = ref(false);

  // Interactive KuGou risk-control challenge state
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
    await persist();
  }

  async function refreshAccountProfile(userid?: string) {
    const target = accounts.value.find((a) => a.userid === (userid || activeUserId.value));
    if (!target) return;
    refreshing.value = true;
    try {
      const auth = { token: target.token, userid: target.userid };
      const [detailRes, expiry] = await Promise.all([
        kugouApi.getUserDetail(auth).catch(() => null),
        fetchVipExpiryText(auth).catch(() => ''),
      ]);
      const data = detailRes?.body?.data;
      if (data) {
        if (data.nickname) target.nickname = String(data.nickname);
        if (data.pic) target.avatar = fixCoverUrl(String(data.pic), 240);
        if (data.vip_type !== undefined) target.vipType = Number(data.vip_type);
      }
      if (expiry) {
        target.tvipEndTime = expiry;
        target.vipEndTime = expiry;
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
