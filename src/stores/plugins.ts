import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { echoSystem } from '@/native/echoSystem';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';
import { useAccountsStore } from './accounts';
import { useUiStore } from './ui';
import {
  buildMelunePluginShareLink,
  normalizeRegistryUrl,
  parseMeluneExtensionDeepLink,
} from '@/services/plugins/deepLink';
import {
  downloadAndVerifyPluginBundle,
  fetchPluginRegistry,
  validatePluginManifest,
} from '@/services/plugins/registryClient';
import { pluginRuntime } from '@/services/plugins/pluginRuntime';
import type {
  InstalledMelunePlugin,
  MelunePluginManifest,
  SavedPluginRegistry,
} from '@/services/plugins/types';

const REGISTRIES_KEY = 'plugins.registries.v1';
const INSTALLED_KEY = 'plugins.installed.v1';
const SAFE_MODE_KEY = 'plugins.safemode.v1';

export interface PluginInstallReview {
  manifest: MelunePluginManifest;
  registryUrl?: string;
  registryName?: string;
  isUpdate: boolean;
}

export const usePluginsStore = defineStore('plugins', () => {
  const registries = ref<SavedPluginRegistry[]>([]);
  const installed = ref<InstalledMelunePlugin[]>([]);
  const safeMode = ref(false);
  const busy = ref(false);
  const syncingRegistryUrl = ref('');
  const installingId = ref('');
  const activePanelPluginId = ref('');
  const pendingReview = ref<PluginInstallReview | null>(null);
  const runtimeTick = ref(0);

  let hydrated = false;
  let unsubStatus: (() => void) | null = null;
  let appVersionCache = FALLBACK_APP_VERSION;

  function bindHostBridge() {
    const accounts = useAccountsStore();
    const ui = useUiStore();

    pluginRuntime.setHostBridge({
      getAppVersion: () => appVersionCache,
      getActiveAccount: () => {
        const a = accounts.activeAccount;
        if (!a) return null;
        return {
          userid: a.userid,
          nickname: a.nickname,
          avatar: a.avatar,
          isVip: Boolean(a.isVip || a.tvipEndTime),
          tvipEndTime: a.tvipEndTime,
          vipEndTime: a.vipEndTime,
        };
      },
      listAccounts: () =>
        accounts.accounts.map((a) => ({
          userid: a.userid,
          nickname: a.nickname,
          avatar: a.avatar,
          isVip: Boolean(a.isVip || a.tvipEndTime),
          tvipEndTime: a.tvipEndTime,
          vipEndTime: a.vipEndTime,
        })),
      getAuthForUser: (userid?: string) => {
        const target = userid
          ? accounts.accounts.find((a) => a.userid === String(userid))
          : accounts.activeAccount;
        if (!target?.token) return null;
        return { token: target.token, userid: target.userid, t1: target.t1 };
      },
      refreshAccount: async (userid?: string) => {
        const targetId = userid || accounts.activeAccount?.userid;
        if (targetId) {
          await accounts.refreshAccountProfile(targetId);
        }
      },
      showToast: (msg: string, durationMs?: number) => {
        ui.showToast(msg, durationMs);
      },
    });
  }

  const enabledCount = computed(() => {
    void runtimeTick.value;
    if (safeMode.value) return 0;
    return installed.value.filter((p) => p.enabled).length;
  });

  const hasAudioResolverPlugin = computed(() => {
    void runtimeTick.value;
    return pluginRuntime.hasAudioResolvers();
  });

  async function persistAll() {
    await Promise.all([
      echoSystem.kvSetJson(REGISTRIES_KEY, registries.value),
      echoSystem.kvSetJson(INSTALLED_KEY, installed.value),
      echoSystem.kvSetJson(SAFE_MODE_KEY, { enabled: safeMode.value }),
    ]);
  }

  async function hydrate(appVersion = FALLBACK_APP_VERSION) {
    appVersionCache = appVersion || FALLBACK_APP_VERSION;
    bindHostBridge();
    if (!unsubStatus) {
      unsubStatus = pluginRuntime.subscribeStatus(() => {
        runtimeTick.value += 1;
      });
    }

    const [savedRegs, savedInstalled, savedSafe] = await Promise.all([
      echoSystem.kvGetJson<SavedPluginRegistry[]>(REGISTRIES_KEY, []),
      echoSystem.kvGetJson<InstalledMelunePlugin[]>(INSTALLED_KEY, []),
      echoSystem.kvGetJson<{ enabled?: boolean }>(SAFE_MODE_KEY, { enabled: false }),
    ]);

    registries.value = Array.isArray(savedRegs) ? savedRegs : [];
    installed.value = Array.isArray(savedInstalled) ? savedInstalled : [];
    safeMode.value = Boolean(savedSafe?.enabled);
    pluginRuntime.setSafeMode(safeMode.value);

    if (!safeMode.value) {
      for (const item of installed.value) {
        if (item.enabled) {
          await pluginRuntime.loadPlugin(item);
        }
      }
    }
    hydrated = true;
    runtimeTick.value += 1;
  }

  async function setSafeMode(enabled: boolean) {
    safeMode.value = Boolean(enabled);
    pluginRuntime.setSafeMode(safeMode.value);
    if (!safeMode.value) {
      bindHostBridge();
      for (const item of installed.value) {
        if (item.enabled) {
          await pluginRuntime.loadPlugin(item);
        }
      }
    }
    await echoSystem.kvSetJson(SAFE_MODE_KEY, { enabled: safeMode.value });
    runtimeTick.value += 1;
  }

  async function addOrRefreshRegistry(rawUrl: string): Promise<SavedPluginRegistry> {
    const normalized = normalizeRegistryUrl(rawUrl);
    if (!normalized) {
      throw new Error('请输入有效的 HTTPS 插件源地址或 owner/repo');
    }
    syncingRegistryUrl.value = normalized;
    busy.value = true;
    try {
      const { registry, normalizedUrl } = await fetchPluginRegistry(normalized);
      const now = Date.now();
      const idx = registries.value.findIndex((r) => r.url === normalizedUrl || r.id === registry.id);
      const entry: SavedPluginRegistry = {
        id: registry.id,
        name: registry.name,
        url: normalizedUrl,
        homepage: registry.homepage,
        maintainer: registry.maintainer,
        description: registry.description,
        updatedAt: registry.updatedAt,
        addedAt: idx >= 0 ? registries.value[idx].addedAt : now,
        lastSyncedAt: now,
        plugins: registry.plugins,
      };
      if (idx >= 0) {
        registries.value.splice(idx, 1, entry);
      } else {
        registries.value.unshift(entry);
      }
      await echoSystem.kvSetJson(REGISTRIES_KEY, registries.value);
      return entry;
    } finally {
      syncingRegistryUrl.value = '';
      busy.value = false;
    }
  }

  async function removeRegistry(url: string) {
    registries.value = registries.value.filter((r) => r.url !== url);
    await echoSystem.kvSetJson(REGISTRIES_KEY, registries.value);
  }

  function getInstalledPlugin(id: string): InstalledMelunePlugin | undefined {
    return installed.value.find((p) => p.manifest.id === id);
  }

  function requestInstallReview(manifest: MelunePluginManifest, registryUrl?: string, registryName?: string) {
    const validated = validatePluginManifest(manifest);
    const existing = getInstalledPlugin(validated.id);
    pendingReview.value = {
      manifest: validated,
      registryUrl,
      registryName,
      isUpdate: Boolean(existing),
    };
  }

  function cancelInstallReview() {
    pendingReview.value = null;
  }

  async function confirmPendingInstall(): Promise<boolean> {
    const req = pendingReview.value;
    if (!req) return false;
    const ui = useUiStore();
    installingId.value = req.manifest.id;
    try {
      const bundle = await downloadAndVerifyPluginBundle(req.manifest, req.registryUrl);
      const now = Date.now();
      const existingIdx = installed.value.findIndex((p) => p.manifest.id === req.manifest.id);
      const record: InstalledMelunePlugin = {
        manifest: { ...req.manifest, sha256: bundle.sha256 },
        code: bundle.code,
        sourceUrl: bundle.sourceUrl,
        registryUrl: req.registryUrl,
        enabled: true,
        installedAt: existingIdx >= 0 ? installed.value[existingIdx].installedAt : now,
        updatedAt: now,
        grantedPermissions: [...req.manifest.permissions],
      };

      if (existingIdx >= 0) {
        installed.value.splice(existingIdx, 1, record);
      } else {
        installed.value.unshift(record);
      }
      await echoSystem.kvSetJson(INSTALLED_KEY, installed.value);
      pendingReview.value = null;

      if (!safeMode.value) {
        bindHostBridge();
        const ok = await pluginRuntime.loadPlugin(record);
        if (!ok) {
          const st = pluginRuntime.getPluginRuntimeStatus(record.manifest.id);
          ui.showToast(st.lastError || '插件已安装，但初始化异常', 3200);
          return false;
        }
      }
      echoSystem.haptic('success');
      ui.showToast(`${req.isUpdate ? '已更新' : '已安全安装'}「${record.manifest.name}」（SHA-256 校验通过）`);
      return true;
    } catch (err: any) {
      ui.showToast(err?.message || '插件安装失败', 3400);
      return false;
    } finally {
      installingId.value = '';
      runtimeTick.value += 1;
    }
  }

  async function togglePluginEnabled(pluginId: string) {
    const idx = installed.value.findIndex((p) => p.manifest.id === pluginId);
    if (idx < 0) return;
    const target = installed.value[idx];
    const nextEnabled = !target.enabled;
    const updated: InstalledMelunePlugin = { ...target, enabled: nextEnabled };
    installed.value.splice(idx, 1, updated);
    await echoSystem.kvSetJson(INSTALLED_KEY, installed.value);

    if (nextEnabled && !safeMode.value) {
      bindHostBridge();
      await pluginRuntime.loadPlugin(updated);
    } else {
      await pluginRuntime.unloadPlugin(pluginId);
    }
    runtimeTick.value += 1;
  }

  async function uninstallPlugin(pluginId: string) {
    await pluginRuntime.unloadPlugin(pluginId);
    installed.value = installed.value.filter((p) => p.manifest.id !== pluginId);
    if (activePanelPluginId.value === pluginId) {
      activePanelPluginId.value = '';
    }
    await echoSystem.kvSetJson(INSTALLED_KEY, installed.value);
    runtimeTick.value += 1;
  }

  async function handleDeepLinkUri(rawUri: string): Promise<boolean> {
    const intent = parseMeluneExtensionDeepLink(rawUri);
    if (!intent) return false;
    const ui = useUiStore();
    ui.openAccountSheet('plugins');
    try {
      const saved = await addOrRefreshRegistry(intent.registryUrl);
      if (intent.pluginId) {
        const target = saved.plugins.find((p) => p.id === intent.pluginId);
        if (target) {
          requestInstallReview(target, saved.url, saved.name);
        } else {
          ui.showToast(`源「${saved.name}」中未找到插件 ${intent.pluginId}`, 3000);
        }
      } else {
        ui.showToast(`已导入插件源「${saved.name}」（${saved.plugins.length} 款扩展）`);
      }
      return true;
    } catch (err: any) {
      ui.showToast(err?.message || '解析扩展链接失败', 3200);
      return false;
    }
  }

  async function copyShareLink(registryUrl: string, pluginId?: string) {
    const link = buildMelunePluginShareLink(registryUrl, pluginId);
    if (!link) return;
    await echoSystem.copyToClipboard(link);
    echoSystem.haptic('success');
    useUiStore().showToast('已复制 melune:// 扩展分享链接');
  }

  async function runLaunchHooks() {
    if (!hydrated || safeMode.value) return;
    await pluginRuntime.runLaunchHooks();
  }

  async function notifyAuthLogin(userid: string) {
    if (!hydrated || safeMode.value) return;
    await pluginRuntime.runAuthLoginHooks(userid);
  }

  function getStatus(pluginId: string) {
    void runtimeTick.value;
    return pluginRuntime.getPluginRuntimeStatus(pluginId);
  }

  return {
    registries,
    installed,
    safeMode,
    busy,
    syncingRegistryUrl,
    installingId,
    activePanelPluginId,
    pendingReview,
    enabledCount,
    hasAudioResolverPlugin,
    hydrate,
    persistAll,
    setSafeMode,
    addOrRefreshRegistry,
    removeRegistry,
    getInstalledPlugin,
    requestInstallReview,
    cancelInstallReview,
    confirmPendingInstall,
    togglePluginEnabled,
    uninstallPlugin,
    handleDeepLinkUri,
    copyShareLink,
    runLaunchHooks,
    notifyAuthLogin,
    getStatus,
  };
});
