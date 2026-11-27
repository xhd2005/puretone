import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AudioQuality } from '@/types/music';
import type { EqPresetId } from '@/native/echoPlayer';
import { echoSystem } from '@/native/echoSystem';
import { echoPlayer } from '@/native/echoPlayer';
import { applyLocaleToDocument, resolveEffectiveLocale } from '@/i18n';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AccentThemeMode = 'dynamic' | 'apple-red';
export type AppLocale = 'system' | 'zh-CN' | 'zh-TW' | 'en';
export type LyricFontSize = 'standard' | 'large' | 'xlarge';
export type TrackTransitionFadeMs = 0 | 1500 | 3000 | 5000;

export interface PersistedSettings {
  appearance: AppearanceMode;
  accentMode: AccentThemeMode;
  locale: AppLocale;
  lyricFontSize: LyricFontSize;
  quality: AudioQuality;
  eqPreset: EqPresetId;
  transitionFadeMs: TrackTransitionFadeMs;
  volumeLeveling: boolean;
  lyricOffsets: Record<string, number>;
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
  locale: 'system',
  lyricFontSize: 'standard',
  quality: 'flac',
  eqPreset: 'flat',
  transitionFadeMs: 1500,
  volumeLeveling: false,
  lyricOffsets: {},
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
  // Default OFF so lock-screen & live media cards stay rock-solid (no OS rate-limit freeze)
  showLockScreenLyrics: false,
};

function sanitizeFadeMs(raw: unknown): TrackTransitionFadeMs {
  const n = Number(raw);
  if (n === 0 || n === 1500 || n === 3000 || n === 5000) return n;
  return DEFAULTS.transitionFadeMs;
}

export const useSettingsStore = defineStore('settings', () => {
  const appearance = ref<AppearanceMode>(DEFAULTS.appearance);
  const accentMode = ref<AccentThemeMode>(DEFAULTS.accentMode);
  const locale = ref<AppLocale>(DEFAULTS.locale);
  const lyricFontSize = ref<LyricFontSize>(DEFAULTS.lyricFontSize);
  const quality = ref<AudioQuality>(DEFAULTS.quality);
  const eqPreset = ref<EqPresetId>(DEFAULTS.eqPreset);
  const transitionFadeMs = ref<TrackTransitionFadeMs>(DEFAULTS.transitionFadeMs);
  const volumeLeveling = ref<boolean>(DEFAULTS.volumeLeveling);
  const lyricOffsets = ref<Record<string, number>>({});
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
  watch(
    locale,
    (loc) => {
      applyLocaleToDocument(resolveEffectiveLocale(loc));
    },
    { immediate: true },
  );
  watch(eqPreset, (preset) => {
    void echoPlayer.setEqPreset(preset);
  });
  watch(transitionFadeMs, (ms) => {
    void echoPlayer.setTransitionFadeMs(ms);
  });
  watch(volumeLeveling, (enabled) => {
    void echoPlayer.setVolumeLeveling(enabled);
  });
  watch(showLockScreenLyrics, (enabled) => {
    if (!enabled) void echoPlayer.setLiveLyric('');
  });

  function getLyricOffset(trackKey: string): number {
    if (!trackKey) return 0;
    return Number(lyricOffsets.value[trackKey] || 0);
  }

  function adjustLyricOffset(trackKey: string, deltaMs: number): number {
    if (!trackKey) return 0;
    const prev = getLyricOffset(trackKey);
    const next = Math.max(-10000, Math.min(10000, Math.round((prev + deltaMs) / 100) * 100));
    const copy = { ...lyricOffsets.value };
    if (next === 0) {
      delete copy[trackKey];
    } else {
      copy[trackKey] = next;
    }
    // Cap persisted track offsets at 200 entries
    const keys = Object.keys(copy);
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) {
        delete copy[k];
      }
    }
    lyricOffsets.value = copy;
    return next;
  }

  function resetLyricOffset(trackKey: string): void {
    if (!trackKey || lyricOffsets.value[trackKey] === undefined) return;
    const copy = { ...lyricOffsets.value };
    delete copy[trackKey];
    lyricOffsets.value = copy;
  }

  let hydrated = false;

  async function hydrate() {
    const saved = await echoSystem.kvGetJson<Partial<PersistedSettings>>(STORAGE_KEY, {});
    appearance.value = saved.appearance ?? DEFAULTS.appearance;
    accentMode.value = saved.accentMode ?? DEFAULTS.accentMode;
    locale.value = saved.locale ?? DEFAULTS.locale;
    lyricFontSize.value = saved.lyricFontSize ?? DEFAULTS.lyricFontSize;
    quality.value = saved.quality ?? DEFAULTS.quality;
    eqPreset.value = saved.eqPreset ?? DEFAULTS.eqPreset;
    transitionFadeMs.value = sanitizeFadeMs(saved.transitionFadeMs);
    volumeLeveling.value = saved.volumeLeveling ?? DEFAULTS.volumeLeveling;
    lyricOffsets.value =
      saved.lyricOffsets && typeof saved.lyricOffsets === 'object' ? { ...saved.lyricOffsets } : {};
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
    applyLocaleToDocument(resolveEffectiveLocale(locale.value));
    void echoPlayer.setEqPreset(eqPreset.value);
    void echoPlayer.setTransitionFadeMs(transitionFadeMs.value);
    void echoPlayer.setVolumeLeveling(volumeLeveling.value);
  }

  async function persist() {
    if (!hydrated) return;
    await echoSystem.kvSetJson(STORAGE_KEY, exportSnapshot());
  }

  watch(
    [
      appearance,
      accentMode,
      locale,
      lyricFontSize,
      quality,
      eqPreset,
      transitionFadeMs,
      volumeLeveling,
      lyricOffsets,
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
      locale: locale.value,
      lyricFontSize: lyricFontSize.value,
      quality: quality.value,
      eqPreset: eqPreset.value,
      transitionFadeMs: transitionFadeMs.value,
      volumeLeveling: volumeLeveling.value,
      lyricOffsets: { ...lyricOffsets.value },
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
    if (saved.locale) locale.value = saved.locale;
    if (saved.lyricFontSize) lyricFontSize.value = saved.lyricFontSize;
    if (saved.quality) quality.value = saved.quality;
    if (saved.eqPreset) eqPreset.value = saved.eqPreset;
    if (saved.transitionFadeMs !== undefined) transitionFadeMs.value = sanitizeFadeMs(saved.transitionFadeMs);
    if (typeof saved.volumeLeveling === 'boolean') volumeLeveling.value = saved.volumeLeveling;
    if (saved.lyricOffsets && typeof saved.lyricOffsets === 'object') {
      lyricOffsets.value = { ...saved.lyricOffsets };
    }
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
    applyLocaleToDocument(resolveEffectiveLocale(locale.value));
    void echoPlayer.setEqPreset(eqPreset.value);
    void echoPlayer.setTransitionFadeMs(transitionFadeMs.value);
    void echoPlayer.setVolumeLeveling(volumeLeveling.value);
    await echoSystem.kvSetJson(STORAGE_KEY, exportSnapshot());
  }

  return {
    appearance,
    accentMode,
    locale,
    lyricFontSize,
    quality,
    eqPreset,
    transitionFadeMs,
    volumeLeveling,
    lyricOffsets,
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
    getLyricOffset,
    adjustLyricOffset,
    resetLyricOffset,
    hydrate,
    setDailyReminder,
    exportSnapshot,
    importSnapshot,
  };
});
