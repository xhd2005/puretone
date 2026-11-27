import { computed } from 'vue';
import { useSettingsStore, type AppLocale } from '@/stores/settings';
import { MESSAGES, type EffectiveLocale, type I18nKey } from './messages';

export type { EffectiveLocale, I18nKey };

export function resolveEffectiveLocale(pref: AppLocale, systemLang?: string): EffectiveLocale {
  if (pref === 'zh-CN' || pref === 'zh-TW' || pref === 'en') return pref;
  const raw = (
    systemLang ?? (typeof navigator !== 'undefined' ? navigator.language || navigator.languages?.[0] || 'zh-CN' : 'zh-CN')
  )
    .toLowerCase()
    .trim();
  if (raw.startsWith('zh')) {
    if (raw.includes('tw') || raw.includes('hk') || raw.includes('mo') || raw.includes('hant')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }
  return 'en';
}

export function applyLocaleToDocument(locale: EffectiveLocale): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const langTag = locale === 'zh-TW' ? 'zh-Hant' : locale === 'en' ? 'en' : 'zh-Hans';
  html.setAttribute('lang', langTag);
  html.setAttribute('data-locale', locale);
}

export function translateKey(
  locale: EffectiveLocale,
  key: I18nKey,
  params?: Record<string, string | number>,
): string {
  const dict = MESSAGES[locale] || MESSAGES['zh-CN'];
  let text = dict[key] ?? MESSAGES['zh-CN'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

export function useI18n() {
  const settings = useSettingsStore();

  const effectiveLocale = computed<EffectiveLocale>(() => resolveEffectiveLocale(settings.locale));

  function t(key: I18nKey, params?: Record<string, string | number>): string {
    return translateKey(effectiveLocale.value, key, params);
  }

  return {
    effectiveLocale,
    t,
  };
}
