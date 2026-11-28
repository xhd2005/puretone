import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mockCallKugouRoute = vi.fn();
const mockNativeHttpRequest = vi.fn();

vi.mock('@/services/kugou/kugouEngine', async () => {
  const actual = await vi.importActual<typeof import('@/services/kugou/kugouEngine')>('@/services/kugou/kugouEngine');
  return {
    ...actual,
    callKugouRoute: (...args: unknown[]) => mockCallKugouRoute(...args),
  };
});

vi.mock('@/native/echoHttp', async () => {
  const actual = await vi.importActual<typeof import('@/native/echoHttp')>('@/native/echoHttp');
  return {
    ...actual,
    nativeHttpRequest: (...args: unknown[]) => mockNativeHttpRequest(...args),
  };
});

import { echoSystem } from '@/native/echoSystem';
import { pluginRuntime } from '@/services/plugins/pluginRuntime';
import {
  buildMirroredHttpsCandidates,
  computeUtf8Sha256Hex,
  validatePluginManifest,
  validateRegistryIndex,
} from '@/services/plugins/registryClient';
import {
  DEFAULT_PLUGIN_REGISTRY_ID,
  DEFAULT_PLUGIN_REGISTRY_URL,
  MELUNE_EXT_PROTOCOL,
  MELUNE_REGISTRY_PROTOCOL,
} from '@/services/plugins/types';
import { usePluginsStore } from '@/stores/plugins';
import { enUS, zhCN, zhTW } from '@/i18n/messages';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

describe('v2.5.2 Independent Plugin OTA, Consumer/Dev Dual Modes, Curated 5 Plugins & UI Polish', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
    mockCallKugouRoute.mockReset();
    mockNativeHttpRequest.mockReset();
    pluginRuntime.setSafeMode(false);
    await pluginRuntime.unloadAll();
  });

  it('prioritizes real-time mirrors & GitHub Raw ahead of jsDelivr with cache-busting, and forward-compat skips unknown plugin schemas', () => {
    const candidates = buildMirroredHttpsCandidates(DEFAULT_PLUGIN_REGISTRY_URL, { bustCache: true });
    expect(candidates.length).toBeGreaterThanOrEqual(4);
    const rawIdx = candidates.findIndex((c) => c.label === 'GitHub Raw');
    const jsdIdx = candidates.findIndex((c) => c.url.includes('jsdelivr.net'));
    expect(rawIdx).toBeGreaterThanOrEqual(0);
    expect(jsdIdx).toBeGreaterThan(rawIdx);
    expect(candidates[0].url).toContain('?t=');
    expect(candidates[rawIdx].url).toContain('?t=');

    // Forward-compat: an unknown future permission on one plugin must NOT break the whole registry
    const parsed = validateRegistryIndex({
      protocol: MELUNE_REGISTRY_PROTOCOL,
      id: 'compat-test',
      name: 'Compat Registry',
      plugins: [
        {
          protocol: MELUNE_EXT_PROTOCOL,
          id: 'good-sleep',
          name: '助眠定时',
          version: '1.0.0',
          author: 'Hayden',
          description: 'Sleep timer',
          sha256: 'a'.repeat(64),
          permissions: ['storage', 'ui.panel'],
          hostPermissions: ['player.control'],
          featured: true,
          tagline: '定时轻柔停播',
        },
        {
          protocol: MELUNE_EXT_PROTOCOL,
          id: 'future-ext',
          name: '未来扩展',
          version: '9.0.0',
          author: 'Future',
          description: 'Uses unknown permission',
          sha256: 'b'.repeat(64),
          permissions: ['quantum.teleport'],
        },
      ],
    });
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0].id).toBe('good-sleep');
    expect(parsed.plugins[0].permissions).toContain('player.control');
    expect(parsed.plugins[0].featured).toBe(true);
    expect(parsed.plugins[0].tagline).toBe('定时轻柔停播');
  });

  it('supports independent single-plugin & batch OTA updates (semver + same-version SHA hotfix), decoupled from App updates, and persists Developer Mode', async () => {
    const codeV1 = 'module.exports = defineMelunePlugin({ setup(ctx) { ctx.registerPanel({ render: () => ({ sections: [] }), onAction: () => {} }); } });';
    const codeV1Hotfix = 'module.exports = defineMelunePlugin({ setup(ctx) { ctx.log("info", "hotfix"); ctx.registerPanel({ render: () => ({ sections: [] }), onAction: () => {} }); } });';
    const shaV1 = computeUtf8Sha256Hex(codeV1);
    const shaHotfix = computeUtf8Sha256Hex(codeV1Hotfix);

    let remoteCode = codeV1Hotfix;
    let remoteSha = shaHotfix;
    let remoteVersion = '1.0.0';

    mockNativeHttpRequest.mockImplementation(async (opts: { url: string }) => {
      if (opts.url.includes('melune-registry.json')) {
        return {
          status: 200,
          body: JSON.stringify({
            protocol: MELUNE_REGISTRY_PROTOCOL,
            id: DEFAULT_PLUGIN_REGISTRY_ID,
            name: '弥音官方精选源',
            plugins: [
              {
                protocol: MELUNE_EXT_PROTOCOL,
                id: 'ota-ext',
                name: '热更测试',
                version: remoteVersion,
                author: 'Hayden',
                description: 'Independent OTA test',
                downloadUrl: 'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/plugins/ota-ext/index.js',
                sha256: remoteSha,
                permissions: ['storage', 'ui.panel'],
              },
            ],
          }),
          headers: {},
          url: opts.url,
        };
      }
      if (opts.url.includes('ota-ext/index.js')) {
        return { status: 200, body: remoteCode, headers: {}, url: opts.url };
      }
      return { status: 404, body: '', headers: {}, url: opts.url };
    });

    const store = usePluginsStore();
    await store.hydrate('2.5.2');
    expect(store.developerMode).toBe(false);

    // Toggle Developer Mode and verify persistence across re-hydration (App update simulation)
    await store.setDeveloperMode(true);
    await echoSystem.kvSetJson('ext.data.ota-ext:userCfg', { preserved: true });
    store.installed.push({
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'ota-ext',
        name: '热更测试',
        version: '1.0.0',
        author: 'Hayden',
        description: 'v1',
        sha256: shaV1,
        permissions: ['storage', 'ui.panel'],
      }),
      code: codeV1,
      sourceUrl: 'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/plugins/ota-ext/index.js',
      registryUrl: DEFAULT_PLUGIN_REGISTRY_URL,
      enabled: true,
      installedAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
      grantedPermissions: ['storage', 'ui.panel'],
    });
    await store.persistAll();

    // Simulate App upgrade from v2.5.2 -> v2.6.0: installed plugins & developerMode MUST remain 100% untouched!
    setActivePinia(createPinia());
    const upgradedStore = usePluginsStore();
    await upgradedStore.hydrate('2.6.0');
    expect(upgradedStore.developerMode).toBe(true);
    expect(upgradedStore.installed).toHaveLength(1);
    expect(upgradedStore.installed[0].manifest.version).toBe('1.0.0');

    // Same-version SHA-256 hotfix detection via checkSinglePluginUpdate
    const checkHotfix = await upgradedStore.checkSinglePluginUpdate('ota-ext');
    expect(checkHotfix.hasUpdate).toBe(true);
    expect(checkHotfix.update?.isHotfixSameVersion).toBe(true);

    // Batch updateAllAvailablePlugins updates losslessly & preserves ext.data.*
    const batchRes = await upgradedStore.updateAllAvailablePlugins();
    expect(batchRes).toEqual({ updated: 1, failed: 0 });
    expect(upgradedStore.availableUpdatesCount).toBe(0);
    expect(await echoSystem.kvGetJson('ext.data.ota-ext:userCfg', null)).toEqual({ preserved: true });

    // Semver bump 1.0.0 -> 1.1.0 detection
    remoteVersion = '1.1.0';
    const checkSemver = await upgradedStore.checkSinglePluginUpdate('ota-ext');
    expect(checkSemver.hasUpdate).toBe(true);
    expect(checkSemver.update?.isHotfixSameVersion).toBe(false);
    expect(checkSemver.latestVersion).toBe('1.1.0');
  });

  it('verifies all 5 curated plugins (<=4 char names), daily month=YYYY-MM sync, zero-config auto-team & sleep timer pause on track change', async () => {
    const pluginsRepoRoot = path.resolve(process.cwd(), '..', 'melune-plugins');
    const registryPath = path.join(pluginsRepoRoot, 'melune-registry.json');
    if (!fs.existsSync(registryPath)) return;

    const registry = validateRegistryIndex(JSON.parse(fs.readFileSync(registryPath, 'utf8')));
    expect(registry.plugins).toHaveLength(5);

    // All 5 curated plugins must have short <= 4 Chinese-char names (zero truncation on mobile!)
    for (const p of registry.plugins) {
      expect(p.name.length).toBeLessThanOrEqual(4);
      expect(Boolean(p.tagline && p.tagline.length > 0)).toBe(true);
    }

    const pauseSpy = vi.fn(async () => {});
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const receivedMonthParams: Array<Record<string, unknown>> = [];

    mockCallKugouRoute.mockImplementation(async (route: string, params: Record<string, unknown>) => {
      if (route === '/youth/month/vip/record') {
        receivedMonthParams.push(params);
        return {
          status: 200,
          body: {
            status: 1,
            error_code: 0,
            data: {
              list: [{ day: `${ym}-03` }],
              sign_list: [{ receive_day: `${ym}-05` }, `${ym}-07`],
            },
          },
        };
      }
      if (route === '/team/period/info') {
        return {
          status: 200,
          body: {
            status: 1,
            error_code: 0,
            data: {
              current_period_info: {
                id: 310,
                name: '第156期',
                status: 0,
                start_time: '2026-11-25 00:00:00',
                end_time: '2026-12-01 23:59:59',
              },
            },
          },
        };
      }
      if (route === '/team/my/info') {
        return {
          status: 200,
          body: {
            status: 1,
            error_code: 0,
            data: {
              my_create_team_list: [
                {
                  team_code: '9oo04e',
                  member_count: 3,
                  vip_desc: '获得7天VIP',
                  member_list: [
                    { userid: '10086', nick_name: 'Hayden', role: 1 },
                    { userid: '10087', nick_name: 'B', role: 2 },
                    { userid: '10088', nick_name: 'C', role: 2 },
                  ],
                },
              ],
              my_join_team_list: [
                {
                  team_code: 'ws2h1r',
                  member_count: 3,
                  vip_desc: '获得3天VIP',
                  member_list: [
                    { userid: '20001', nick_name: 'Lead', role: 1 },
                    { userid: '10086', nick_name: 'Hayden', role: 2 },
                    { userid: '20002', nick_name: 'D', role: 2 },
                  ],
                },
              ],
            },
          },
        };
      }
      return { status: 200, body: { status: 1, error_code: 0 } };
    });

    const poolUrls: string[] = [];
    mockNativeHttpRequest.mockImplementation(async (opts: { url: string }) => {
      poolUrls.push(opts.url);
      return { status: 200, body: JSON.stringify({ ok: true, token: 'pool_tok' }), headers: {}, url: opts.url };
    });

    pluginRuntime.setHostBridge({
      getAppVersion: () => '2.5.2',
      getActiveAccount: () => ({ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-06-01' }),
      listAccounts: () => [{ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-06-01' }],
      getAuthForUser: () => ({ userid: '10086', token: 'secret_never_exposed' }),
      refreshAccount: async () => {},
      showToast: () => {},
      getCurrentTrack: () => ({ id: 'song-1', hash: 'h1', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 }),
      isPlaying: () => true,
      pausePlayback: pauseSpy,
    });

    const loadReal = async (id: string) => {
      const m = registry.plugins.find((p) => p.id === id)!;
      const code = fs.readFileSync(path.join(pluginsRepoRoot, 'plugins', id, m.entry || 'index.js'), 'utf8');
      expect(
        await pluginRuntime.loadPlugin({
          manifest: m,
          code,
          sourceUrl: m.downloadUrl || '',
          enabled: true,
          installedAt: Date.now(),
          updatedAt: Date.now(),
          grantedPermissions: [...m.permissions],
        }),
      ).toBe(true);
    };

    // 1. 每日签到 v1.2.0: explicit month=YYYY-MM + merges list & sign_list + live badge
    await loadReal('melune-daily-checkin');
    await pluginRuntime.dispatchPluginAction('melune-daily-checkin', 'sync_cloud');
    expect(receivedMonthParams.some((p) => p.month === ym && p.latest_limit === 100)).toBe(true);
    const dailyPanel = await pluginRuntime.renderPluginPanel('melune-daily-checkin');
    const cal = dailyPanel!.sections[1].blocks.find((b) => b.type === 'calendar');
    expect(cal && cal.type === 'calendar').toBe(true);
    if (cal && cal.type === 'calendar') {
      const claimed = cal.cells.filter((c) => c.isClaimed).map((c) => c.key);
      expect(claimed).toContain(`${ym}-03`);
      expect(claimed).toContain(`${ym}-05`);
      expect(claimed).toContain(`${ym}-07`);
    }
    expect(pluginRuntime.getPluginBadge('melune-daily-checkin')?.text).toBeTruthy();

    // 2. 自动组队 v1.2.0: zero-config autoEnabled=true uses built-in pool, renders startTime~endTime & vipDesc & collapsible
    await loadReal('melune-team-vip');
    await pluginRuntime.dispatchPluginAction('melune-team-vip', 'run_now');
    expect(poolUrls.some((u) => u.startsWith('https://echo-team-pool.oneday.vip/v2/snapshot'))).toBe(true);
    const teamPanel = await pluginRuntime.renderPluginPanel('melune-team-vip');
    const hero = teamPanel!.sections[0].blocks.find((b) => b.type === 'hero-stat');
    expect(hero && hero.type === 'hero-stat' ? hero.sub : '').toContain('2026-11-25 00:00:00 ~ 2026-12-01 23:59:59');
    const copyLabels = teamPanel!.sections[1].blocks
      .filter((b) => b.type === 'copy-code')
      .map((b) => (b.type === 'copy-code' ? b.label : ''));
    expect(copyLabels[0]).toContain('获得7天VIP');
    expect(copyLabels[1]).toContain('获得3天VIP');
    expect(teamPanel!.sections[2].blocks[0].type).toBe('collapsible');
    expect(pluginRuntime.getPluginBadge('melune-team-vip')?.text).toContain('第156期');

    // 3. 助眠定时 v1.0.0: countdown badge + end_of_track pauses playback on notifyTrackChange
    await loadReal('melune-sleep-timer');
    await pluginRuntime.dispatchPluginAction('melune-sleep-timer', 'set_minutes', { minutes: 30 });
    expect(pluginRuntime.getPluginBadge('melune-sleep-timer')?.text).toBe('助眠 30m');
    await pluginRuntime.dispatchPluginAction('melune-sleep-timer', 'add_minutes', { minutes: 10 });
    expect(pluginRuntime.getPluginBadge('melune-sleep-timer')?.text).toBe('助眠 40m');

    await pluginRuntime.dispatchPluginAction('melune-sleep-timer', 'set_end_of_track');
    expect(pluginRuntime.getPluginBadge('melune-sleep-timer')?.text).toBe('本曲播完停');
    pluginRuntime.notifyTrackChange({
      id: 'song-2',
      hash: 'h2',
      title: '夜曲',
      artist: '周杰伦',
      album: '十一月的萧邦',
      duration: 226,
      coverUrl: '',
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(pluginRuntime.getPluginBadge('melune-sleep-timer')?.text).toBe('未开启');
  });

  it('enforces UI anchors, zero :global(.dark) / v-html, and complete v2.5.2 trilingual i18n keys', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    const vueFiles = [
      'src/components/MiniPlayerPill.vue',
      'src/views/LibraryView.vue',
      'src/views/HomeView.vue',
      'src/components/AccountVipSheet.vue',
      'src/components/PluginHubTab.vue',
      'src/components/PluginDetailSheet.vue',
      'src/components/PluginInstallModal.vue',
      'src/components/PluginPanelRenderer.vue',
    ];
    for (const file of vueFiles) {
      const src = read(file);
      expect(src).not.toContain(':global(.dark)');
      expect(src).not.toContain('v-html');
    }

    expect(read('src/components/MiniPlayerPill.vue')).toContain('mini-ambient-glow');
    expect(read('src/views/LibraryView.vue')).toContain('data-library-quick-cards');
    expect(read('src/views/HomeView.vue')).toContain('data-home-greeting');
    expect(read('src/views/HomeView.vue')).toContain('data-home-pinned-plugins');
    expect(read('src/components/PluginHubTab.vue')).toContain('data-plugin-spotlight');
    expect(read('src/components/PluginHubTab.vue')).toContain('data-dev-mode-toggle');
    expect(read('src/components/PluginDetailSheet.vue')).toContain('data-plugin-simple-actions');

    const keys = [
      'home.greetingMorning',
      'home.greetingAfternoon',
      'home.greetingEvening',
      'plugins.hubSettings',
      'plugins.devMode',
      'plugins.devModeSub',
      'plugins.updateAllBtn',
      'plugins.featuredTitle',
      'plugins.pinHomeLabel',
      'plugins.pinHomeSub',
      'plugins.checkSingleUpdate',
      'plugins.installUpdateNow',
      'plugins.safeVerifiedPill',
    ] as const;
    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
  });
});
