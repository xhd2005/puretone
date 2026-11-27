import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { zhCN, zhTW, enUS } from '@/i18n/messages';
import { sanitizeIslandOffsetYDp, useSettingsStore } from '@/stores/settings';
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
    expect(shouldPromptAutoUpdate({ hasUpdate: false, latestVersion: '2.4.8' }, '')).toBe(false);
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

    // Simulate a very recent check 5 seconds ago — silent check MUST still run!
    await echoSystem.kvSetJson('update.lastCheckAt.v1', Date.now() - 5000);

    const firstPrompt = await checkForAppUpdate({ silent: true, currentVersion: '2.4.8' });
    expect(firstPrompt?.hasUpdate).toBe(true);
    expect(firstPrompt?.latestVersion).toBe('2.5.0');

    // Simulating "Later" does NOT call skipUpdateVersion -> next cold start still prompts
    const secondPrompt = await checkForAppUpdate({ silent: true, currentVersion: '2.4.8' });
    expect(secondPrompt?.hasUpdate).toBe(true);

    // Simulating "Ignore v2.5.0" suppresses silent auto-prompt, while manual check still shows it
    await skipUpdateVersion('2.5.0');
    const suppressedSilent = await checkForAppUpdate({ silent: true, currentVersion: '2.4.8' });
    expect(suppressedSilent).toBeNull();

    const manualCheck = await checkForAppUpdate({ silent: false, currentVersion: '2.4.8' });
    expect(manualCheck?.hasUpdate).toBe(true);
    expect(manualCheck?.latestVersion).toBe('2.5.0');
  });
});

describe('v2.4.8 Settings Store (Auto-Update + Melune Dynamic Island)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('initializes sensible defaults and clamps island vertical offset safely', () => {
    const settings = useSettingsStore();
    expect(settings.autoCheckUpdate).toBe(true);
    expect(settings.dynamicIslandEnabled).toBe(false);
    expect(settings.dynamicIslandShowLyric).toBe(false);
    expect(settings.dynamicIslandOffsetYDp).toBe(4);

    expect(sanitizeIslandOffsetYDp(-40)).toBe(-8);
    expect(sanitizeIslandOffsetYDp(80)).toBe(28);
    expect(sanitizeIslandOffsetYDp(10.4)).toBe(10);
    expect(sanitizeIslandOffsetYDp('invalid')).toBe(4);
  });

  it('round-trips autoCheckUpdate and Dynamic Island settings in JSON snapshots', async () => {
    const settings = useSettingsStore();
    await settings.importSnapshot({
      autoCheckUpdate: false,
      dynamicIslandEnabled: true,
      dynamicIslandShowLyric: true,
      dynamicIslandOffsetYDp: 14,
    });

    const snap = settings.exportSnapshot();
    expect(snap.autoCheckUpdate).toBe(false);
    expect(snap.dynamicIslandEnabled).toBe(true);
    expect(snap.dynamicIslandShowLyric).toBe(true);
    expect(snap.dynamicIslandOffsetYDp).toBe(14);
  });
});

describe('v2.4.8 Trilingual i18n Keys & Version Bump', () => {
  it('provides complete zh-CN, zh-TW, and en copy for all new v2.4.8 keys', () => {
    const keys = [
      'settings.autoCheckUpdate',
      'settings.autoCheckUpdateSub',
      'settings.dynamicIsland',
      'settings.dynamicIslandSub',
      'settings.dynamicIslandLyric',
      'settings.dynamicIslandOffset',
      'settings.dynamicIslandPreview',
      'settings.oemIslandToggle',
      'update.ignoreVersion',
      'update.newBadge',
    ] as const;

    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
    expect(FALLBACK_APP_VERSION).toBe('2.4.8');
  });
});
