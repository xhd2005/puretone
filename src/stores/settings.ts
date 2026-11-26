import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import { echoSystem } from '@/native/echoSystem';
import { echoPlayer } from '@/native/echoPlayer';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AccentThemeMode = 'dynamic' | 'apple-red';

export interface PersistedSettings {
  appearance: AppearanceMode;
  accentMode: AccentThemeMode;
  quality: AudioQuality;
  eqPreset: EqPresetId;
  enableUnblock: boolean;
  unblockPlatforms: string[];
  autoClaimOnLaunch: boolean;
  autoClaimAllAccounts: boolean;
  enableConceptTasks: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderHour: number;
  dailyReminderMinute: number;
  showTranslation: boolean;
  showCoverLyricsPreview: boolean;
  showLockScreenLyrics: boolean;
}

const STORAGE_KEY = 'settings.v1';

const DEFAULTS: PersistedSettings = {
  appearance: 'system',
  accentMode: 'dynamic',
  quality: 'flac',
  eqPreset: 'flat',
  enableUnblock: true,
  unblockPlatforms: ['kuwo', 'kugou', 'joox', 'bilibili'],
  autoClaimOnLaunch: true,
  autoClaimAllAccounts: true,
  enableConceptTasks: true,
  dailyReminderEnabled: false,
  dailyReminderHour: 9,
  dailyReminderMinute: 0,
  showTranslation: true,
  showCoverLyricsPreview: true,
  showLockScreenLyrics: true,
};

export const useSettingsStore = defineStore('settings', () => {
  const appearance = ref<AppearanceMode>(DEFAULTS.appearance);
  const accentMode = ref<AccentThemeMode>(DEFAULTS.accentMode);
  const quality = ref<AudioQuality>(DEFAULTS.quality);
  const eqPreset = ref<EqPresetId>(DEFAULTS.eqPreset);
  const enableUnblock = ref<boolean>(DEFAULTS.enableUnblock);
  const unblockPlatforms = ref<string[]>([...DEFAULTS.unblockPlatforms]);
  const autoClaimOnLaunch = ref<boolean>(DEFAULTS.autoClaimOnLaunch);
  const autoClaimAllAccounts = ref<boolean>(DEFAULTS.autoClaimAllAccounts);
  const enableConceptTasks = ref<boolean>(DEFAULTS.enableConceptTasks);
  const dailyReminderEnabled = ref<boolean>(DEFAULTS.dailyReminderEnabled);
  const dailyReminderHour = ref<number>(DEFAULTS.dailyReminderHour);
  const dailyReminderMinute = ref<number>(DEFAULTS.dailyReminderMinute);
  const showTranslation = ref<boolean>(DEFAULTS.showTranslation);
  const showCoverLyricsPreview = ref<boolean>(DEFAULTS.showCoverLyricsPreview);
  const showLockScreenLyrics = ref<boolean>(DEFAULTS.showLockScreenLyrics);

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
  watch(eqPreset, (preset) => {
    void echoPlayer.setEqPreset(preset);
  });
  watch(showLockScreenLyrics, (enabled) => {
    if (!enabled) void echoPlayer.setLiveLyric('');
  });

  let hydrated = false;

  async function hydrate() {
    const saved = await echoSystem.kvGetJson<Partial<PersistedSettings>>(STORAGE_KEY, {});
    appearance.value = saved.appearance ?? DEFAULTS.appearance;
    accentMode.value = saved.accentMode ?? DEFAULTS.accentMode;
    quality.value = saved.quality ?? DEFAULTS.quality;
    eqPreset.value = saved.eqPreset ?? DEFAULTS.eqPreset;
    enableUnblock.value = saved.enableUnblock ?? DEFAULTS.enableUnblock;
    unblockPlatforms.value =
      Array.isArray(saved.unblockPlatforms) && saved.unblockPlatforms.length
        ? saved.unblockPlatforms
        : [...DEFAULTS.unblockPlatforms];
    autoClaimOnLaunch.value = saved.autoClaimOnLaunch ?? DEFAULTS.autoClaimOnLaunch;
    autoClaimAllAccounts.value = saved.autoClaimAllAccounts ?? DEFAULTS.autoClaimAllAccounts;
    enableConceptTasks.value = saved.enableConceptTasks ?? DEFAULTS.enableConceptTasks;
    dailyReminderEnabled.value = saved.dailyReminderEnabled ?? DEFAULTS.dailyReminderEnabled;
    dailyReminderHour.value = saved.dailyReminderHour ?? DEFAULTS.dailyReminderHour;
    dailyReminderMinute.value = saved.dailyReminderMinute ?? DEFAULTS.dailyReminderMinute;
    showTranslation.value = saved.showTranslation ?? DEFAULTS.showTranslation;
    showCoverLyricsPreview.value = saved.showCoverLyricsPreview ?? DEFAULTS.showCoverLyricsPreview;
    showLockScreenLyrics.value = saved.showLockScreenLyrics ?? DEFAULTS.showLockScreenLyrics;
    hydrated = true;
    applyThemeClass();
    void echoPlayer.setEqPreset(eqPreset.value);
  }

  async function persist() {
    if (!hydrated) return;
    const payload: PersistedSettings = {
      appearance: appearance.value,
      accentMode: accentMode.value,
      quality: quality.value,
      eqPreset: eqPreset.value,
      enableUnblock: enableUnblock.value,
      unblockPlatforms: unblockPlatforms.value,
      autoClaimOnLaunch: autoClaimOnLaunch.value,
      autoClaimAllAccounts: autoClaimAllAccounts.value,
      enableConceptTasks: enableConceptTasks.value,
      dailyReminderEnabled: dailyReminderEnabled.value,
      dailyReminderHour: dailyReminderHour.value,
      dailyReminderMinute: dailyReminderMinute.value,
      showTranslation: showTranslation.value,
      showCoverLyricsPreview: showCoverLyricsPreview.value,
      showLockScreenLyrics: showLockScreenLyrics.value,
    };
    await echoSystem.kvSetJson(STORAGE_KEY, payload);
  }

  watch(
    [
      appearance,
      accentMode,
      quality,
      eqPreset,
      enableUnblock,
      unblockPlatforms,
      autoClaimOnLaunch,
      autoClaimAllAccounts,
      enableConceptTasks,
      dailyReminderEnabled,
      dailyReminderHour,
      dailyReminderMinute,
      showTranslation,
      showCoverLyricsPreview,
      showLockScreenLyrics,
    ],
    () => {
      void persist();
    },
    { deep: true },
  );

  async function setDailyReminder(
    enabled: boolean,
    hour = dailyReminderHour.value,
    minute = dailyReminderMinute.value,
  ): Promise<boolean> {
    dailyReminderHour.value = hour;
    dailyReminderMinute.value = minute;
    if (enabled) {
      const ok = await echoSystem.scheduleDailyReminder(hour, minute);
      dailyReminderEnabled.value = ok;
      return ok;
    }
    await echoSystem.cancelDailyReminder();
    dailyReminderEnabled.value = false;
    return true;
  }

  function exportSnapshot(): PersistedSettings {
    return {
      appearance: appearance.value,
      accentMode: accentMode.value,
      quality: quality.value,
      eqPreset: eqPreset.value,
      enableUnblock: enableUnblock.value,
      unblockPlatforms: [...unblockPlatforms.value],
      autoClaimOnLaunch: autoClaimOnLaunch.value,
      autoClaimAllAccounts: autoClaimAllAccounts.value,
      enableConceptTasks: enableConceptTasks.value,
      dailyReminderEnabled: dailyReminderEnabled.value,
      dailyReminderHour: dailyReminderHour.value,
      dailyReminderMinute: dailyReminderMinute.value,
      showTranslation: showTranslation.value,
      showCoverLyricsPreview: showCoverLyricsPreview.value,
      showLockScreenLyrics: showLockScreenLyrics.value,
    };
  }

  async function importSnapshot(saved: Partial<PersistedSettings>) {
    if (saved.appearance) appearance.value = saved.appearance;
    if (saved.accentMode) accentMode.value = saved.accentMode;
    if (saved.quality) quality.value = saved.quality;
    if (saved.eqPreset) eqPreset.value = saved.eqPreset;
    if (typeof saved.enableUnblock === 'boolean') enableUnblock.value = saved.enableUnblock;
    if (Array.isArray(saved.unblockPlatforms) && saved.unblockPlatforms.length) {
      unblockPlatforms.value = [...saved.unblockPlatforms];
    }
    if (typeof saved.autoClaimOnLaunch === 'boolean') autoClaimOnLaunch.value = saved.autoClaimOnLaunch;
    if (typeof saved.autoClaimAllAccounts === 'boolean') autoClaimAllAccounts.value = saved.autoClaimAllAccounts;
    if (typeof saved.enableConceptTasks === 'boolean') enableConceptTasks.value = saved.enableConceptTasks;
    if (typeof saved.showTranslation === 'boolean') showTranslation.value = saved.showTranslation;
    if (typeof saved.showCoverLyricsPreview === 'boolean') showCoverLyricsPreview.value = saved.showCoverLyricsPreview;
    if (typeof saved.showLockScreenLyrics === 'boolean') showLockScreenLyrics.value = saved.showLockScreenLyrics;
    applyThemeClass();
    void echoPlayer.setEqPreset(eqPreset.value);
    await echoSystem.kvSetJson(STORAGE_KEY, exportSnapshot());
  }

  return {
    appearance,
    accentMode,
    quality,
    eqPreset,
    enableUnblock,
    unblockPlatforms,
    autoClaimOnLaunch,
    autoClaimAllAccounts,
    enableConceptTasks,
    dailyReminderEnabled,
    dailyReminderHour,
    dailyReminderMinute,
    showTranslation,
    showCoverLyricsPreview,
    showLockScreenLyrics,
    isDark,
    applyThemeClass,
    hydrate,
    setDailyReminder,
    exportSnapshot,
    importSnapshot,
  };
});
