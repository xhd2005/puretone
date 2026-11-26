import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AudioQuality } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';

export type AppearanceMode = 'system' | 'light' | 'dark';

interface PersistedSettings {
  appearance: AppearanceMode;
  quality: AudioQuality;
  enableUnblock: boolean;
  unblockPlatforms: string[];
  autoClaimOnLaunch: boolean;
  autoClaimAllAccounts: boolean;
  enableConceptTasks: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderHour: number;
  dailyReminderMinute: number;
  showTranslation: boolean;
}

const STORAGE_KEY = 'settings.v1';

const DEFAULTS: PersistedSettings = {
  appearance: 'system',
  quality: 'flac',
  enableUnblock: true,
  unblockPlatforms: ['kuwo', 'kugou', 'joox', 'bilibili'],
  autoClaimOnLaunch: true,
  autoClaimAllAccounts: true,
  enableConceptTasks: true,
  dailyReminderEnabled: false,
  dailyReminderHour: 9,
  dailyReminderMinute: 0,
  showTranslation: true,
};

export const useSettingsStore = defineStore('settings', () => {
  const appearance = ref<AppearanceMode>(DEFAULTS.appearance);
  const quality = ref<AudioQuality>(DEFAULTS.quality);
  const enableUnblock = ref<boolean>(DEFAULTS.enableUnblock);
  const unblockPlatforms = ref<string[]>([...DEFAULTS.unblockPlatforms]);
  const autoClaimOnLaunch = ref<boolean>(DEFAULTS.autoClaimOnLaunch);
  const autoClaimAllAccounts = ref<boolean>(DEFAULTS.autoClaimAllAccounts);
  const enableConceptTasks = ref<boolean>(DEFAULTS.enableConceptTasks);
  const dailyReminderEnabled = ref<boolean>(DEFAULTS.dailyReminderEnabled);
  const dailyReminderHour = ref<number>(DEFAULTS.dailyReminderHour);
  const dailyReminderMinute = ref<number>(DEFAULTS.dailyReminderMinute);
  const showTranslation = ref<boolean>(DEFAULTS.showTranslation);

  const systemPrefersDark = ref<boolean>(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );

  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', (ev) => {
      systemPrefersDark.value = ev.matches;
    });
  }

  const isDark = computed(() => {
    if (appearance.value === 'dark') return true;
    if (appearance.value === 'light') return false;
    return systemPrefersDark.value;
  });

  function applyThemeClass(forceDarkStatusBar = false) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark.value);
    void echoSystem.setStatusBarStyle(!isDark.value && !forceDarkStatusBar);
  }

  watch(isDark, () => applyThemeClass(), { immediate: true });

  let hydrated = false;

  async function hydrate() {
    const saved = await echoSystem.kvGetJson<Partial<PersistedSettings>>(STORAGE_KEY, {});
    appearance.value = saved.appearance ?? DEFAULTS.appearance;
    quality.value = saved.quality ?? DEFAULTS.quality;
    enableUnblock.value = saved.enableUnblock ?? DEFAULTS.enableUnblock;
    unblockPlatforms.value = Array.isArray(saved.unblockPlatforms) && saved.unblockPlatforms.length
      ? saved.unblockPlatforms
      : [...DEFAULTS.unblockPlatforms];
    autoClaimOnLaunch.value = saved.autoClaimOnLaunch ?? DEFAULTS.autoClaimOnLaunch;
    autoClaimAllAccounts.value = saved.autoClaimAllAccounts ?? DEFAULTS.autoClaimAllAccounts;
    enableConceptTasks.value = saved.enableConceptTasks ?? DEFAULTS.enableConceptTasks;
    dailyReminderEnabled.value = saved.dailyReminderEnabled ?? DEFAULTS.dailyReminderEnabled;
    dailyReminderHour.value = saved.dailyReminderHour ?? DEFAULTS.dailyReminderHour;
    dailyReminderMinute.value = saved.dailyReminderMinute ?? DEFAULTS.dailyReminderMinute;
    showTranslation.value = saved.showTranslation ?? DEFAULTS.showTranslation;
    hydrated = true;
    applyThemeClass();
  }

  async function persist() {
    if (!hydrated) return;
    const payload: PersistedSettings = {
      appearance: appearance.value,
      quality: quality.value,
      enableUnblock: enableUnblock.value,
      unblockPlatforms: unblockPlatforms.value,
      autoClaimOnLaunch: autoClaimOnLaunch.value,
      autoClaimAllAccounts: autoClaimAllAccounts.value,
      enableConceptTasks: enableConceptTasks.value,
      dailyReminderEnabled: dailyReminderEnabled.value,
      dailyReminderHour: dailyReminderHour.value,
      dailyReminderMinute: dailyReminderMinute.value,
      showTranslation: showTranslation.value,
    };
    await echoSystem.kvSetJson(STORAGE_KEY, payload);
  }

  watch(
    [
      appearance,
      quality,
      enableUnblock,
      unblockPlatforms,
      autoClaimOnLaunch,
      autoClaimAllAccounts,
      enableConceptTasks,
      dailyReminderEnabled,
      dailyReminderHour,
      dailyReminderMinute,
      showTranslation,
    ],
    () => {
      void persist();
    },
    { deep: true },
  );

  async function setDailyReminder(enabled: boolean, hour = dailyReminderHour.value, minute = dailyReminderMinute.value): Promise<boolean> {
    dailyReminderHour.value = hour;
    dailyReminderMinute.value = minute;
    if (enabled) {
      const ok = await echoSystem.scheduleDailyReminder(hour, minute);
      dailyReminderEnabled.value = ok;
      return ok;
    } else {
      await echoSystem.cancelDailyReminder();
      dailyReminderEnabled.value = false;
      return true;
    }
  }

  return {
    appearance,
    quality,
    enableUnblock,
    unblockPlatforms,
    autoClaimOnLaunch,
    autoClaimAllAccounts,
    enableConceptTasks,
    dailyReminderEnabled,
    dailyReminderHour,
    dailyReminderMinute,
    showTranslation,
    isDark,
    applyThemeClass,
    hydrate,
    setDailyReminder,
  };
});
