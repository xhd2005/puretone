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
import { computeUtf8Sha256Hex, validatePluginManifest } from '@/services/plugins/registryClient';
import {
  DEFAULT_PLUGIN_REGISTRY_ID,
  DEFAULT_PLUGIN_REGISTRY_URL,
  MELUNE_EXT_PROTOCOL,
  MELUNE_REGISTRY_PROTOCOL,
  type InstalledMelunePlugin,
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

describe('v2.5.1 Unified Plugin UI, On-Demand Default Registry, Diagnostics & Real v1.1.0 Plugin E2E', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
    mockCallKugouRoute.mockReset();
    mockNativeHttpRequest.mockReset();
    pluginRuntime.setSafeMode(false);
    await pluginRuntime.unloadAll();
  });

  it('hoists .ios-switch globally, enforces zero :global(.dark) / v-html, and ships complete docs & trilingual READMEs', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

    const globalCss = read('src/styles/apple-music.css');
    expect(globalCss).toContain('.ios-switch');
    expect(globalCss).toContain('.ios-switch:checked');

    const accountSheet = read('src/components/AccountVipSheet.vue');
    expect(accountSheet.slice(accountSheet.indexOf('<style'))).not.toContain('.ios-switch');
    expect(accountSheet).toContain('data-pinned-plugin-bar');
    expect(accountSheet).toContain(':visible="ui.accountSheetOpen && activeTab === \'plugins\'"');

    const detailSheet = read('src/components/PluginDetailSheet.vue');
    expect(detailSheet).toContain('data-plugin-detail-sheet');
    expect(detailSheet).not.toContain('v-html');
    expect(detailSheet).not.toContain(':global(.dark)');

    const appVue = read('src/App.vue');
    expect(appVue).toContain('<PluginDetailSheet />');
    expect(appVue).toContain('plugins.closePluginDetail()');

    const spec = read('docs/PLUGIN_SPEC.md');
    expect(spec).toContain('melune-ext/v1');
    expect(spec).toContain('melune-plugin.json');
    expect(spec).toContain('SHA-256');
    expect(spec).toContain('/user/grade/info');

    const readmeZh = read('README.md');
    const readmeEn = read('README.en.md');
    const readmeTw = read('README.zh-TW.md');
    expect(readmeZh).toContain('docs/PLUGIN_SPEC.md');
    expect(readmeEn).toContain('docs/PLUGIN_SPEC.md');
    expect(readmeTw).toContain('docs/PLUGIN_SPEC.md');
    expect(readmeEn).not.toContain('Built-in 4-channel concurrent candidate scoring');
    expect(readmeTw).not.toContain('內建 4 通道併發原唱候選');

    const v251Keys = [
      'plugins.tabInstalled',
      'plugins.tabStore',
      'plugins.manageSources',
      'plugins.restoreDefaultSource',
      'plugins.detailTabPanel',
      'plugins.detailTabDiagnostics',
      'plugins.pinnedQuickBar',
      'plugins.clearData',
    ] as const;
    for (const k of v251Keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
  });

  it('loads default official registry strictly on-demand, respects dismissal/restore, detects semver updates & preserves data', async () => {
    const sampleCodeV1 = 'module.exports = defineMelunePlugin({ setup(ctx) { ctx.registerPanel({ render: () => ({ sections: [] }), onAction: () => {} }); } });';
    const sampleCodeV2 = 'module.exports = defineMelunePlugin({ setup(ctx) { ctx.log("info", "v1.1.0"); ctx.registerPanel({ render: () => ({ sections: [] }), onAction: () => {} }); } });';
    const shaV1 = computeUtf8Sha256Hex(sampleCodeV1);
    const shaV2 = computeUtf8Sha256Hex(sampleCodeV2);

    const mockRegistryBody = JSON.stringify({
      protocol: MELUNE_REGISTRY_PROTOCOL,
      id: DEFAULT_PLUGIN_REGISTRY_ID,
      name: '弥音 · MELUNE 官方社区扩展源',
      maintainer: 'Hayden Xue (@xhd2005)',
      plugins: [
        {
          protocol: MELUNE_EXT_PROTOCOL,
          id: 'demo-ext',
          name: '演示扩展',
          version: '1.1.0',
          author: 'Hayden',
          category: 'utility',
          description: '演示无损升级',
          downloadUrl: 'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/plugins/demo-ext/index.js',
          sha256: shaV2,
          permissions: ['storage', 'ui.panel'],
        },
      ],
    });

    mockNativeHttpRequest.mockImplementation(async (opts: { url: string }) => {
      if (opts.url.includes('melune-registry.json')) {
        return { status: 200, body: mockRegistryBody, headers: {}, url: opts.url };
      }
      if (opts.url.includes('demo-ext/index.js')) {
        return { status: 200, body: sampleCodeV2, headers: {}, url: opts.url };
      }
      return { status: 404, body: '', headers: {}, url: opts.url };
    });

    const store = usePluginsStore();
    // 1. Cold-start hydrate MUST NOT hit the network
    await store.hydrate('2.5.1');
    expect(mockNativeHttpRequest).not.toHaveBeenCalled();
    expect(store.registries).toHaveLength(0);
    expect(store.installed).toHaveLength(0);

    // 2. First open of Plugins tab fetches default registry on demand, never auto-installs
    const loaded = await store.ensureDefaultRegistryLoaded();
    expect(loaded).toBe(true);
    expect(store.hasDefaultRegistry).toBe(true);
    expect(store.installed).toHaveLength(0);

    // 3. Removing default registry marks dismissed so re-opening tab won't re-add it
    await store.removeRegistry(DEFAULT_PLUGIN_REGISTRY_URL);
    expect(store.hasDefaultRegistry).toBe(false);
    expect(store.defaultRegistryDismissed).toBe(true);
    expect(await store.ensureDefaultRegistryLoaded()).toBe(false);
    expect(store.hasDefaultRegistry).toBe(false);

    // 4. User explicitly restores default official registry
    await store.restoreDefaultRegistry();
    expect(store.hasDefaultRegistry).toBe(true);
    expect(store.defaultRegistryDismissed).toBe(false);

    // 5. Seed local v1.0.0 + isolated plugin data -> detect semver update -> lossless upgrade preserves data!
    await echoSystem.kvSetJson('ext.data.demo-ext:prefs', { kept: 42 });
    store.installed.push({
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'demo-ext',
        name: '演示扩展',
        version: '1.0.0',
        author: 'Hayden',
        description: 'v1',
        sha256: shaV1,
        permissions: ['storage', 'ui.panel'],
      }),
      code: sampleCodeV1,
      sourceUrl: 'https://example.com/v1.js',
      registryUrl: DEFAULT_PLUGIN_REGISTRY_URL,
      enabled: true,
      installedAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      grantedPermissions: ['storage', 'ui.panel'],
    });

    expect(store.availableUpdatesCount).toBe(1);
    const up = store.getAvailableUpdate('demo-ext');
    expect(up?.manifest.version).toBe('1.1.0');

    store.requestInstallReview(up!.manifest, up!.registryUrl, up!.registryName);
    expect(await store.confirmPendingInstall()).toBe(true);
    expect(store.availableUpdatesCount).toBe(0);
    expect(await echoSystem.kvGetJson('ext.data.demo-ext:prefs', null)).toEqual({ kept: 42 });

    // 6. Pinned quick shortcuts persist and clear on uninstall
    expect(await store.togglePinPlugin('demo-ext')).toBe(true);
    expect(store.pinnedPanelPlugins.map((p) => p.manifest.id)).toEqual(['demo-ext']);
    await store.uninstallPlugin('demo-ext');
    expect(store.pinnedPanelPlugins).toHaveLength(0);
  });

  it('caps sandbox logs at 20 entries and clears ONLY scoped ext.data.<id>:* storage without touching accounts', async () => {
    const code = `
      module.exports = defineMelunePlugin({
        async setup(ctx) {
          for (let i = 1; i <= 25; i += 1) {
            ctx.log('info', 'log-entry-' + i);
          }
          await ctx.storage.set('k1', { v: 1 });
          await ctx.storage.set('k2', { v: 2 });
        },
      });
    `;
    const installed: InstalledMelunePlugin = {
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'diag-ext',
        name: 'DiagExt',
        version: '1.0.0',
        author: 'Tester',
        description: 'Diagnostics test',
        sha256: computeUtf8Sha256Hex(code),
        permissions: ['storage'],
      }),
      code,
      sourceUrl: 'https://example.com/diag.js',
      enabled: true,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      grantedPermissions: ['storage'],
    };

    await echoSystem.kvSetJson('accounts.v1', [{ userid: '999', token: 'secret' }]);
    await echoSystem.kvSetJson('ext.data.other-ext:k1', { safe: true });

    expect(await pluginRuntime.loadPlugin(installed)).toBe(true);
    const diag = pluginRuntime.getPluginDiagnostics('diag-ext');
    expect(diag.loaded).toBe(true);
    expect(diag.logs.length).toBeLessThanOrEqual(20);
    expect(diag.logs.some((l) => l.message.includes('log-entry-25'))).toBe(true);

    // Guard against unsafe prefix wipes
    await expect(echoSystem.kvDeleteByPrefix('')).rejects.toThrow();
    await expect(echoSystem.kvDeleteByPrefix('accounts.')).rejects.toThrow();

    // Scoped wipe deletes only diag-ext keys, preserving accounts.v1 and other-ext
    const removed = await pluginRuntime.clearPluginData('diag-ext');
    expect(removed).toBe(2);
    expect(await echoSystem.kvGetJson('accounts.v1', [])).toEqual([{ userid: '999', token: 'secret' }]);
    expect(await echoSystem.kvGetJson('ext.data.other-ext:k1', null)).toEqual({ safe: true });
  });

  it('runs real melune-daily-checkin v1.1.0 E2E: handles rejected 131001/297001 as already-done & hydrates cloud calendar', async () => {
    const pluginsRepoRoot = path.resolve(process.cwd(), '..', 'melune-plugins');
    const dailyPath = path.join(pluginsRepoRoot, 'plugins', 'melune-daily-checkin', 'index.js');
    if (!fs.existsSync(dailyPath)) return;

    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginsRepoRoot, 'plugins', 'melune-daily-checkin', 'melune-plugin.json'), 'utf8'),
    );
    const code = fs.readFileSync(dailyPath, 'utf8');

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cloudDay1 = `${ym}-01`;
    const cloudDay2 = `${ym}-02`;

    // Simulate real KuGouMusicApi behavior: REJECTS with plain `{ status: 502, body: { error_code: 131001 } }`!
    mockCallKugouRoute.mockImplementation(async (route: string) => {
      if (route === '/youth/day/vip') {
        throw { status: 502, body: { status: 0, error_code: 131001, error_msg: '今日已领取' } };
      }
      if (route === '/youth/day/vip/upgrade') {
        throw { status: 502, body: { status: 0, error_code: 297001, error_msg: '今日特权已升级' } };
      }
      if (route === '/youth/month/vip/record') {
        return {
          status: 200,
          body: { status: 1, error_code: 0, data: { list: [{ day: cloudDay1 }, { day: cloudDay2 }] } },
        };
      }
      if (route === '/user/batch/union/vipinfo') {
        return {
          status: 200,
          body: {
            status: 1,
            data: { busi_vip: { '10086': [{ product_type: 'tvip', is_vip: 1, vip_end_time: '2027-06-01 00:00:00' }] } },
          },
        };
      }
      return { status: 200, body: { status: 1, error_code: 0 } };
    });

    pluginRuntime.setHostBridge({
      getAppVersion: () => '2.5.1',
      getActiveAccount: () => ({ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-06-01' }),
      listAccounts: () => [{ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-06-01' }],
      getAuthForUser: () => ({ userid: '10086', token: 'mock_token' }),
      refreshAccount: async () => {},
      showToast: () => {},
    });

    expect(
      await pluginRuntime.loadPlugin({
        manifest: validatePluginManifest(manifest),
        code,
        sourceUrl: 'https://example.com/daily.js',
        enabled: true,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        grantedPermissions: [...manifest.permissions],
      }),
    ).toBe(true);

    await pluginRuntime.dispatchPluginAction('melune-daily-checkin', 'claim_active');
    const panel = await pluginRuntime.renderPluginPanel('melune-daily-checkin');
    expect(panel).not.toBeNull();

    const stepsBlock = panel!.sections[0].blocks.find((b) => b.type === 'steps');
    expect(stepsBlock && stepsBlock.type === 'steps' ? stepsBlock.items[0].status : '').toBe('already');
    expect(stepsBlock && stepsBlock.type === 'steps' ? stepsBlock.items[1].status : '').toBe('already');

    const noticeBlock = panel!.sections[0].blocks.find((b) => b.type === 'notice');
    expect(noticeBlock && noticeBlock.type === 'notice' ? noticeBlock.tone : '').toBe('success');

    const calBlock = panel!.sections[1].blocks.find((b) => b.type === 'calendar');
    expect(calBlock && calBlock.type === 'calendar').toBe(true);
    if (calBlock && calBlock.type === 'calendar') {
      const claimedKeys = calBlock.cells.filter((c) => c.isClaimed).map((c) => c.key);
      expect(claimedKeys).toContain(cloudDay1);
      expect(claimedKeys).toContain(cloudDay2);
      expect(calBlock.cells.some((c) => c.isFailed)).toBe(false);
    }
  });

  it('runs real melune-team-vip v1.1.0 E2E: zero pool calls when OFF, full (1)->(8) automatic join flow when ON', async () => {
    const pluginsRepoRoot = path.resolve(process.cwd(), '..', 'melune-plugins');
    const teamPath = path.join(pluginsRepoRoot, 'plugins', 'melune-team-vip', 'index.js');
    if (!fs.existsSync(teamPath)) return;

    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginsRepoRoot, 'plugins', 'melune-team-vip', 'melune-plugin.json'), 'utf8'),
    );
    const code = fs.readFileSync(teamPath, 'utf8');

    let hasCreated = false;
    let hasJoined = false;
    mockCallKugouRoute.mockImplementation(async (route: string, params: Record<string, unknown>) => {
      if (route === '/team/period/info') {
        return {
          status: 200,
          body: {
            status: 1,
            error_code: 0,
            data: {
              current_period_info: {
                id: 99,
                name: '第 99 期组队领 VIP',
                status: 0,
                team_member_count: 3,
                end_time: '2026-12-31',
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
              my_create_team_list: hasCreated
                ? [{ team_code: 'MYOWN123', member_count: 1, member_list: [{ userid: '10086', nick_name: 'Hayden', role: 1 }] }]
                : [],
              my_join_team_list: hasJoined
                ? [{ team_code: 'PARTNER88', member_count: 2, member_list: [{ userid: '20001', nick_name: 'Alice', role: 1 }, { userid: '10086', nick_name: 'Hayden', role: 2 }] }]
                : [],
            },
          },
        };
      }
      if (route === '/team/my') {
        hasCreated = true;
        return { status: 200, body: { status: 1, error_code: 0, data: { team_code: 'MYOWN123' } } };
      }
      if (route === '/team/join' && params.team_code === 'PARTNER88') {
        hasJoined = true;
        return { status: 200, body: { status: 1, error_code: 0 } };
      }
      return { status: 200, body: { status: 1, error_code: 0 } };
    });

    const poolCalls: string[] = [];
    mockNativeHttpRequest.mockImplementation(async (opts: { url: string }) => {
      poolCalls.push(opts.url);
      if (opts.url.endsWith('/v2/snapshot')) {
        return { status: 200, body: JSON.stringify({ ok: true, token: 'tok_abc' }), headers: {}, url: opts.url };
      }
      if (opts.url.endsWith('/v2/join')) {
        return {
          status: 200,
          body: JSON.stringify({ ok: true, lease_id: 'lease_1', code: 'PARTNER88' }),
          headers: {},
          url: opts.url,
        };
      }
      if (opts.url.endsWith('/v2/join/result')) {
        return { status: 200, body: JSON.stringify({ ok: true }), headers: {}, url: opts.url };
      }
      return { status: 404, body: '{}', headers: {}, url: opts.url };
    });

    pluginRuntime.setHostBridge({
      getAppVersion: () => '2.5.1',
      getActiveAccount: () => ({ userid: '10086', nickname: 'Hayden', isVip: true }),
      listAccounts: () => [{ userid: '10086', nickname: 'Hayden', isVip: true }],
      getAuthForUser: () => ({ userid: '10086', token: 'mock_token' }),
      refreshAccount: async () => {},
      showToast: () => {},
    });

    expect(
      await pluginRuntime.loadPlugin({
        manifest: validatePluginManifest(manifest),
        code,
        sourceUrl: 'https://example.com/team.js',
        enabled: true,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        grantedPermissions: [...manifest.permissions],
      }),
    ).toBe(true);

    // 1. Default OFF mode: manual refresh touches ONLY KuGou, ZERO pool calls!
    await pluginRuntime.dispatchPluginAction('melune-team-vip', 'run_now');
    expect(poolCalls).toHaveLength(0);

    // 2. Configure v2 pool URL and toggle autoEnabled ON -> full (1)->(8) runs automatically!
    await pluginRuntime.dispatchPluginAction('melune-team-vip', 'save_pool_url', {
      value: 'https://pool.example.test',
    });
    await pluginRuntime.dispatchPluginAction('melune-team-vip', 'toggle_auto', {
      id: 'autoEnabled',
      value: true,
    });

    expect(hasCreated).toBe(true);
    expect(hasJoined).toBe(true);
    expect(poolCalls).toEqual([
      'https://pool.example.test/v2/snapshot',
      'https://pool.example.test/v2/join',
      'https://pool.example.test/v2/join/result',
      'https://pool.example.test/v2/snapshot',
    ]);

    const panel = await pluginRuntime.renderPluginPanel('melune-team-vip');
    const kv = panel!.sections[1].blocks.find((b) => b.type === 'kv-grid');
    expect(kv && kv.type === 'kv-grid' ? kv.items[0].value : '').toContain('MYOWN123');
    expect(kv && kv.type === 'kv-grid' ? kv.items[1].value : '').toContain('PARTNER88');

    await pluginRuntime.unloadPlugin('melune-team-vip');
  });
});
