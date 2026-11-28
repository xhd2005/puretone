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
export type UpdateMirrorMode = 'auto' | 'direct';
export type AudioCacheLimitMb = 500 | 1024 | 2048 | 4096 | 0;

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
  showTranslation: boolean;
  showCoverLyricsPreview: boolean;
  showLockScreenLyrics: boolean;
  autoCheckUpdate: boolean;
  audioCacheMaxMb: AudioCacheLimitMb;
  updateMirrorMode: UpdateMirrorMode;
  customUpdateMirror: string;
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
  showTranslation: true,
  showCoverLyricsPreview: true,
  showLockScreenLyrics: false,
  autoCheckUpdate: true,
  audioCacheMaxMb: 2048,
  updateMirrorMode: 'auto',
  customUpdateMirror: '',
};

function sanitizeQuality(raw: unknown): AudioQuality {
  if (raw === '128' || raw === '320' || raw === 'flac' || raw === 'high') return raw;
  return DEFAULTS.quality;
}

function sanitizeFadeMs(raw: unknown): TrackTransitionFadeMs {
  const n = Number(raw);
  if (n === 0 || n === 1500 || n === 3000 || n === 5000) return n;
  return DEFAULTS.transitionFadeMs;
}

function sanitizeMirrorMode(raw: unknown): UpdateMirrorMode {
  return raw === 'direct' ? 'direct' : 'auto';
}

export function sanitizeAudioCacheLimitMb(raw: unknown): AudioCacheLimitMb {
  const n = Number(raw);
  if (n === 0 || n === 500 || n === 1024 || n === 2048 || n === 4096) return n;
  return DEFAULTS.audioCacheMaxMb;
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
  const showTranslation = ref<boolean>(DEFAULTS.showTranslation);
  const showCoverLyricsPreview = ref<boolean>(DEFAULTS.showCoverLyricsPreview);
  const showLockScreenLyrics = ref<boolean>(DEFAULTS.showLockScreenLyrics);
  const autoCheckUpdate = ref<boolean>(DEFAULTS.autoCheckUpdate);
  const audioCacheMaxMb = ref<AudioCacheLimitMb>(DEFAULTS.audioCacheMaxMb);
  const updateMirrorMode = ref<UpdateMirrorMode>(DEFAULTS.updateMirrorMode);
  const customUpdateMirror = ref<string>(DEFAULTS.customUpdateMirror);

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
  watch(audioCacheMaxMb, (mb) => {
    void echoPlayer.setAudioCacheMaxMb(sanitizeAudioCacheLimitMb(mb));
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
    quality.value = sanitizeQuality(saved.quality);
    eqPreset.value = saved.eqPreset ?? DEFAULTS.eqPreset;
    transitionFadeMs.value = sanitizeFadeMs(saved.transitionFadeMs);
    volumeLeveling.value = saved.volumeLeveling ?? DEFAULTS.volumeLeveling;
    lyricOffsets.value =
      saved.lyricOffsets && typeof saved.lyricOffsets === 'object' ? { ...saved.lyricOffsets } : {};
    showTranslation.value = saved.showTranslation ?? DEFAULTS.showTranslation;
    showCoverLyricsPreview.value = saved.showCoverLyricsPreview ?? DEFAULTS.showCoverLyricsPreview;
    showLockScreenLyrics.value = saved.showLockScreenLyrics ?? DEFAULTS.showLockScreenLyrics;
    autoCheckUpdate.value = saved.autoCheckUpdate ?? DEFAULTS.autoCheckUpdate;
    audioCacheMaxMb.value = sanitizeAudioCacheLimitMb(saved.audioCacheMaxMb);
    updateMirrorMode.value = sanitizeMirrorMode(saved.updateMirrorMode);
    customUpdateMirror.value = typeof saved.customUpdateMirror === 'string' ? saved.customUpdateMirror.trim() : '';
    hydrated = true;
    applyThemeClass();
    applyLocaleToDocument(resolveEffectiveLocale(locale.value));
    void echoPlayer.setEqPreset(eqPreset.value);
    void echoPlayer.setTransitionFadeMs(transitionFadeMs.value);
    void echoPlayer.setVolumeLeveling(volumeLeveling.value);
    void echoPlayer.setAudioCacheMaxMb(audioCacheMaxMb.value);
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
      showTranslation,
      showCoverLyricsPreview,
      showLockScreenLyrics,
      autoCheckUpdate,
      audioCacheMaxMb,
      updateMirrorMode,
      customUpdateMirror,
    ],
    () => {
      void persist();
    },
    { deep: true },
  );

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
      showTranslation: showTranslation.value,
      showCoverLyricsPreview: showCoverLyricsPreview.value,
      showLockScreenLyrics: showLockScreenLyrics.value,
      autoCheckUpdate: autoCheckUpdate.value,
      audioCacheMaxMb: sanitizeAudioCacheLimitMb(audioCacheMaxMb.value),
      updateMirrorMode: updateMirrorMode.value,
      customUpdateMirror: customUpdateMirror.value.trim(),
    };
  }

  async function importSnapshot(saved: Partial<PersistedSettings>) {
    if (saved.appearance) appearance.value = saved.appearance;
    if (saved.accentMode) accentMode.value = saved.accentMode;
    if (saved.locale) locale.value = saved.locale;
    if (saved.lyricFontSize) lyricFontSize.value = saved.lyricFontSize;
    if (saved.quality) quality.value = sanitizeQuality(saved.quality);
    if (saved.eqPreset) eqPreset.value = saved.eqPreset;
    if (saved.transitionFadeMs !== undefined) transitionFadeMs.value = sanitizeFadeMs(saved.transitionFadeMs);
    if (typeof saved.volumeLeveling === 'boolean') volumeLeveling.value = saved.volumeLeveling;
    if (saved.lyricOffsets && typeof saved.lyricOffsets === 'object') {
      lyricOffsets.value = { ...saved.lyricOffsets };
    }
    if (typeof saved.showTranslation === 'boolean') showTranslation.value = saved.showTranslation;
    if (typeof saved.showCoverLyricsPreview === 'boolean') showCoverLyricsPreview.value = saved.showCoverLyricsPreview;
    if (typeof saved.showLockScreenLyrics === 'boolean') showLockScreenLyrics.value = saved.showLockScreenLyrics;
    if (typeof saved.autoCheckUpdate === 'boolean') autoCheckUpdate.value = saved.autoCheckUpdate;
    if (saved.audioCacheMaxMb !== undefined) {
      audioCacheMaxMb.value = sanitizeAudioCacheLimitMb(saved.audioCacheMaxMb);
    }
    if (saved.updateMirrorMode !== undefined) updateMirrorMode.value = sanitizeMirrorMode(saved.updateMirrorMode);
    if (typeof saved.customUpdateMirror === 'string') customUpdateMirror.value = saved.customUpdateMirror.trim();
    applyThemeClass();
    applyLocaleToDocument(resolveEffectiveLocale(locale.value));
    void echoPlayer.setEqPreset(eqPreset.value);
    void echoPlayer.setTransitionFadeMs(transitionFadeMs.value);
    void echoPlayer.setVolumeLeveling(volumeLeveling.value);
    void echoPlayer.setAudioCacheMaxMb(audioCacheMaxMb.value);
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
    showTranslation,
    showCoverLyricsPreview,
    showLockScreenLyrics,
    autoCheckUpdate,
    audioCacheMaxMb,
    updateMirrorMode,
    customUpdateMirror,
    isDark,
    applyThemeClass,
    getLyricOffset,
    adjustLyricOffset,
    resetLyricOffset,
    hydrate,
    exportSnapshot,
    importSnapshot,
  };
});
