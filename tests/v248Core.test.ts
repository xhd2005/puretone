import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { zhCN, zhTW, enUS } from '@/i18n/messages';
import { useSettingsStore } from '@/stores/settings';
import {
  checkForAppUpdate,
  clearSkippedUpdateVersion,
  FALLBACK_APP_VERSION,
  shouldPromptAutoUpdate,
  skipUpdateVersion,
} from '@/services/update/updateService';
import { echoSystem } from '@/native/echoSystem';

vi.mock('@/native/echoHttp', () => ({
  nativeHttpRequest: vi.fn(),
}));

import { nativeHttpRequest } from '@/native/echoHttp';

const mockNativeHttp = vi.mocked(nativeHttpRequest);

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('v2.4.8 Cold-Start Auto-Update & Skip Semantics', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', createMemoryStorage());
    await clearSkippedUpdateVersion();
    await echoSystem.kvDelete('update.lastCheckAt.v1');
  });

  it('prompts auto-update whenever a newer version exists unless explicitly ignored', () => {
    expect(shouldPromptAutoUpdate({ hasUpdate: true, latestVersion: '2.5.0' }, '')).toBe(true);
    expect(shouldPromptAutoUpdate({ hasUpdate: true, latestVersion: '2.5.0' }, '2.4.9')).toBe(true);
    expect(shouldPromptAutoUpdate({ hasUpdate: true, latestVersion: '2.5.0' }, '2.5.0')).toBe(false);
    expect(shouldPromptAutoUpdate({ hasUpdate: false, latestVersion: '2.4.9' }, '')).toBe(false);
  });

  it('checks every cold launch without 12h silent cooldown, and respects Ignore vs Later', async () => {
    const manifestPayload = JSON.stringify({
      version: '2.5.0',
      title: 'MELUNE v2.5.0',
      releaseNotes: '- Test release',
      apkFileName: 'MELUNE-v2.5.0-release.apk',
    });
    mockNativeHttp.mockResolvedValue({
      status: 200,
      url: 'https://example.com/latest.json',
      headers: {},
      setCookies: [],
      body: manifestPayload,
      bodyEncoding: 'utf8',
    });

    await echoSystem.kvSetJson('update.lastCheckAt.v1', Date.now() - 5000);

    const firstPrompt = await checkForAppUpdate({ silent: true, currentVersion: '2.4.9' });
    expect(firstPrompt?.hasUpdate).toBe(true);
    expect(firstPrompt?.latestVersion).toBe('2.5.0');

    const secondPrompt = await checkForAppUpdate({ silent: true, currentVersion: '2.4.9' });
    expect(secondPrompt?.hasUpdate).toBe(true);

    await skipUpdateVersion('2.5.0');
    const suppressedSilent = await checkForAppUpdate({ silent: true, currentVersion: '2.4.9' });
    expect(suppressedSilent).toBeNull();

    const manualCheck = await checkForAppUpdate({ silent: false, currentVersion: '2.4.9' });
    expect(manualCheck?.hasUpdate).toBe(true);
    expect(manualCheck?.latestVersion).toBe('2.5.0');
  });
});

describe('v2.4.8 Auto-Update Settings & Trilingual Keys', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('defaults autoCheckUpdate to true and persists across snapshots', async () => {
    const settings = useSettingsStore();
    expect(settings.autoCheckUpdate).toBe(true);
    await settings.importSnapshot({ autoCheckUpdate: false });
    expect(settings.exportSnapshot().autoCheckUpdate).toBe(false);
  });

  it('provides complete zh-CN, zh-TW, and en copy for update & OEM note keys', () => {
    const keys = [
      'settings.autoCheckUpdate',
      'settings.autoCheckUpdateSub',
      'settings.oemIslandToggle',
      'update.ignoreVersion',
      'update.newBadge',
    ] as const;

    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.4\.\d+$/);
  });
});
