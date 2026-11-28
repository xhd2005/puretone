import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { echoSystem } from '@/native/echoSystem';
import { compareSemver, FALLBACK_APP_VERSION } from '@/services/update/updateService';
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
import {
  DEFAULT_PLUGIN_REGISTRY_ID,
  DEFAULT_PLUGIN_REGISTRY_URL,
  type InstalledMelunePlugin,
  type MelunePluginManifest,
  type SavedPluginRegistry,
} from '@/services/plugins/types';

const REGISTRIES_KEY = 'plugins.registries.v1';
const INSTALLED_KEY = 'plugins.installed.v1';
const SAFE_MODE_KEY = 'plugins.safemode.v1';
const META_KEY = 'plugins.meta.v1';

interface PluginsMetaRecord {
  defaultRegistryDismissed?: boolean;
  pinnedIds?: string[];
}

export interface PluginInstallReview {
  manifest: MelunePluginManifest;
  registryUrl?: string;
  registryName?: string;
  isUpdate: boolean;
}

export interface PluginUpdateCandidate {
  manifest: MelunePluginManifest;
  registryUrl: string;
  registryName: string;
}

export function isDefaultRegistryEntry(reg: Pick<SavedPluginRegistry, 'id' | 'url'>): boolean {
  return reg.id === DEFAULT_PLUGIN_REGISTRY_ID || reg.url === DEFAULT_PLUGIN_REGISTRY_URL;
}

export const usePluginsStore = defineStore('plugins', () => {
  const registries = ref<SavedPluginRegistry[]>([]);
  const installed = ref<InstalledMelunePlugin[]>([]);
  const safeMode = ref(false);
  const busy = ref(false);
  const syncingRegistryUrl = ref('');
  const installingId = ref('');
  const activePanelPluginId = ref('');
  const detailPluginId = ref('');
  const pendingReview = ref<PluginInstallReview | null>(null);
  const defaultRegistryDismissed = ref(false);
  const defaultLoading = ref(false);
  const defaultLoadError = ref('');
  const pinnedIds = ref<string[]>([]);
  const runtimeTick = ref(0);

  let hydrated = false;
  let unsubStatus: (() => void) | null = null;
  let appVersionCache = FALLBACK_APP_VERSION;
  let defaultFetchPromise: Promise<boolean> | null = null;

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

  async function persistMeta() {
    const record: PluginsMetaRecord = {
      defaultRegistryDismissed: defaultRegistryDismissed.value,
      pinnedIds: [...pinnedIds.value],
    };
    await echoSystem.kvSetJson(META_KEY, record);
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

  const hasDefaultRegistry = computed(() => registries.value.some((r) => isDefaultRegistryEntry(r)));

  const detailPlugin = computed(() => {
    if (!detailPluginId.value) return null;
    return installed.value.find((p) => p.manifest.id === detailPluginId.value) || null;
  });

  function getAvailableUpdate(pluginId: string): PluginUpdateCandidate | null {
    const local = installed.value.find((p) => p.manifest.id === pluginId);
    if (!local) return null;
    let best: PluginUpdateCandidate | null = null;
    for (const reg of registries.value) {
      const candidate = reg.plugins.find((p) => p.id === pluginId);
      if (!candidate) continue;
      if (compareSemver(candidate.version, local.manifest.version) > 0) {
        if (!best || compareSemver(candidate.version, best.manifest.version) > 0) {
          best = { manifest: candidate, registryUrl: reg.url, registryName: reg.name };
        }
      }
    }
    return best;
  }

  const availableUpdatesCount = computed(() => {
    void runtimeTick.value;
    let count = 0;
    for (const item of installed.value) {
      if (getAvailableUpdate(item.manifest.id)) count += 1;
    }
    return count;
  });

  const pinnedPanelPlugins = computed(() => {
    void runtimeTick.value;
    if (safeMode.value || !pinnedIds.value.length) return [];
    const out: InstalledMelunePlugin[] = [];
    for (const id of pinnedIds.value) {
      const item = installed.value.find((p) => p.manifest.id === id && p.enabled);
      if (item) out.push(item);
    }
    return out;
  });

  function isPinned(pluginId: string): boolean {
    return pinnedIds.value.includes(pluginId);
  }

  async function togglePinPlugin(pluginId: string): Promise<boolean> {
    const idx = pinnedIds.value.indexOf(pluginId);
    let nextPinned = false;
    if (idx >= 0) {
      pinnedIds.value.splice(idx, 1);
      nextPinned = false;
    } else {
      pinnedIds.value.push(pluginId);
      nextPinned = true;
    }
    await persistMeta();
    return nextPinned;
  }

  async function persistAll() {
    await Promise.all([
      echoSystem.kvSetJson(REGISTRIES_KEY, registries.value),
      echoSystem.kvSetJson(INSTALLED_KEY, installed.value),
      echoSystem.kvSetJson(SAFE_MODE_KEY, { enabled: safeMode.value }),
      persistMeta(),
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

    const [savedRegs, savedInstalled, savedSafe, savedMeta] = await Promise.all([
      echoSystem.kvGetJson<SavedPluginRegistry[]>(REGISTRIES_KEY, []),
      echoSystem.kvGetJson<InstalledMelunePlugin[]>(INSTALLED_KEY, []),
      echoSystem.kvGetJson<{ enabled?: boolean }>(SAFE_MODE_KEY, { enabled: false }),
      echoSystem.kvGetJson<PluginsMetaRecord>(META_KEY, {}),
    ]);

    registries.value = Array.isArray(savedRegs) ? savedRegs : [];
    installed.value = Array.isArray(savedInstalled) ? savedInstalled : [];
    safeMode.value = Boolean(savedSafe?.enabled);
    defaultRegistryDismissed.value = Boolean(savedMeta?.defaultRegistryDismissed);
    pinnedIds.value = Array.isArray(savedMeta?.pinnedIds)
      ? savedMeta.pinnedIds.filter((id) => typeof id === 'string' && installed.value.some((p) => p.manifest.id === id))
      : [];
    pluginRuntime.setSafeMode(safeMode.value);

    // Strictly local hydration: ZERO network fetches on cold start!
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

  /**
   * On-demand official registry bootstrap:
   * Called ONLY when the user opens the "扩展插件" tab.
   * Never fires at cold start, never auto-installs any plugin, respects user dismissal.
   */
  async function ensureDefaultRegistryLoaded(): Promise<boolean> {
    if (defaultRegistryDismissed.value || hasDefaultRegistry.value) {
      return false;
    }
    if (defaultFetchPromise) return defaultFetchPromise;

    defaultLoading.value = true;
    defaultLoadError.value = '';
    defaultFetchPromise = (async () => {
      try {
        await addOrRefreshRegistry(DEFAULT_PLUGIN_REGISTRY_URL);
        defaultLoadError.value = '';
        return true;
      } catch (err: any) {
        defaultLoadError.value = err?.message || '无法连接官方扩展源，请稍后重试';
        return false;
      } finally {
        defaultLoading.value = false;
        defaultFetchPromise = null;
      }
    })();
    return defaultFetchPromise;
  }

  async function restoreDefaultRegistry(): Promise<SavedPluginRegistry> {
    defaultRegistryDismissed.value = false;
    defaultLoadError.value = '';
    await persistMeta();
    return addOrRefreshRegistry(DEFAULT_PLUGIN_REGISTRY_URL);
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
      if (isDefaultRegistryEntry(entry) && defaultRegistryDismissed.value) {
        defaultRegistryDismissed.value = false;
        await persistMeta();
      }
      await echoSystem.kvSetJson(REGISTRIES_KEY, registries.value);
      runtimeTick.value += 1;
      return entry;
    } finally {
      syncingRegistryUrl.value = '';
      busy.value = false;
    }
  }

  async function refreshAllRegistries(): Promise<{ syncedCount: number; updatesCount: number }> {
    if (!registries.value.length) {
      if (!defaultRegistryDismissed.value) {
        await ensureDefaultRegistryLoaded();
      }
      return { syncedCount: registries.value.length, updatesCount: availableUpdatesCount.value };
    }
    const urls = registries.value.map((r) => r.url);
    let syncedCount = 0;
    for (const url of urls) {
      try {
        await addOrRefreshRegistry(url);
        syncedCount += 1;
      } catch {
        // continue syncing other registries
      }
    }
    return { syncedCount, updatesCount: availableUpdatesCount.value };
  }

  async function removeRegistry(url: string) {
    const target = registries.value.find((r) => r.url === url);
    if (target && isDefaultRegistryEntry(target)) {
      defaultRegistryDismissed.value = true;
      await persistMeta();
    }
    registries.value = registries.value.filter((r) => r.url !== url);
    await echoSystem.kvSetJson(REGISTRIES_KEY, registries.value);
    runtimeTick.value += 1;
  }

  function getInstalledPlugin(id: string): InstalledMelunePlugin | undefined {
    return installed.value.find((p) => p.manifest.id === id);
  }

  function openPluginDetail(pluginId: string) {
    if (!getInstalledPlugin(pluginId)) return;
    detailPluginId.value = pluginId;
  }

  function closePluginDetail() {
    detailPluginId.value = '';
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

      // Lossless upgrade: only replaces manifest/code, strictly preserving ext.data.<id>:* storage!
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
      ui.showToast(`${req.isUpdate ? '已无损更新' : '已安全安装'}「${record.manifest.name}」`);
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

  async function clearPluginStorage(pluginId: string): Promise<number> {
    const removed = await pluginRuntime.clearPluginData(pluginId);
    runtimeTick.value += 1;
    return removed;
  }

  async function uninstallPlugin(pluginId: string) {
    await pluginRuntime.unloadPlugin(pluginId);
    installed.value = installed.value.filter((p) => p.manifest.id !== pluginId);
    if (activePanelPluginId.value === pluginId) {
      activePanelPluginId.value = '';
    }
    if (detailPluginId.value === pluginId) {
      detailPluginId.value = '';
    }
    if (pinnedIds.value.includes(pluginId)) {
      pinnedIds.value = pinnedIds.value.filter((id) => id !== pluginId);
      await persistMeta();
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

  function getDiagnostics(pluginId: string) {
    void runtimeTick.value;
    return pluginRuntime.getPluginDiagnostics(pluginId);
  }

  return {
    registries,
    installed,
    safeMode,
    busy,
    syncingRegistryUrl,
    installingId,
    activePanelPluginId,
    detailPluginId,
    detailPlugin,
    pendingReview,
    defaultRegistryDismissed,
    defaultLoading,
    defaultLoadError,
    pinnedIds,
    pinnedPanelPlugins,
    hasDefaultRegistry,
    enabledCount,
    hasAudioResolverPlugin,
    availableUpdatesCount,
    hydrate,
    persistAll,
    ensureDefaultRegistryLoaded,
    restoreDefaultRegistry,
    refreshAllRegistries,
    setSafeMode,
    addOrRefreshRegistry,
    removeRegistry,
    getInstalledPlugin,
    getAvailableUpdate,
    openPluginDetail,
    closePluginDetail,
    isPinned,
    togglePinPlugin,
    requestInstallReview,
    cancelInstallReview,
    confirmPendingInstall,
    togglePluginEnabled,
    clearPluginStorage,
    uninstallPlugin,
    handleDeepLinkUri,
    copyShareLink,
    runLaunchHooks,
    notifyAuthLogin,
    getStatus,
    getDiagnostics,
  };
});
