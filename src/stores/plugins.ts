import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { echoSystem } from '@/native/echoSystem';
import { compareSemver, FALLBACK_APP_VERSION } from '@/services/update/updateService';
import { useAccountsStore } from './accounts';
import { usePlayerStore } from './player';
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
  type MelunePanelBadge,
  type MelunePluginManifest,
  type SavedPluginRegistry,
} from '@/services/plugins/types';

const REGISTRIES_KEY = 'plugins.registries.v1';
const INSTALLED_KEY = 'plugins.installed.v1';
const SAFE_MODE_KEY = 'plugins.safemode.v1';
const META_KEY = 'plugins.meta.v1';
const DEFAULT_STALE_TTL_MS = 15 * 60_000;

interface PluginsMetaRecord {
  defaultRegistryDismissed?: boolean;
  pinnedIds?: string[];
  developerMode?: boolean;
  lastAutoSyncAt?: number;
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
  isHotfixSameVersion: boolean;
}

export function isDefaultRegistryEntry(reg: Pick<SavedPluginRegistry, 'id' | 'url'>): boolean {
  return reg.id === DEFAULT_PLUGIN_REGISTRY_ID || reg.url === DEFAULT_PLUGIN_REGISTRY_URL;
}

export const usePluginsStore = defineStore('plugins', () => {
  const registries = ref<SavedPluginRegistry[]>([]);
  const installed = ref<InstalledMelunePlugin[]>([]);
  const safeMode = ref(false);
  const developerMode = ref(false);
  const busy = ref(false);
  const syncingRegistryUrl = ref('');
  const checkingSinglePluginId = ref('');
  const updatingAll = ref(false);
  const installingId = ref('');
  const activePanelPluginId = ref('');
  const detailPluginId = ref('');
  const pendingReview = ref<PluginInstallReview | null>(null);
  const defaultRegistryDismissed = ref(false);
  const defaultLoading = ref(false);
  const defaultLoadError = ref('');
  const pinnedIds = ref<string[]>([]);
  const lastAutoSyncAt = ref(0);
  const runtimeTick = ref(0);

  let hydrated = false;
  let unsubStatus: (() => void) | null = null;
  let unsubPanel: (() => void) | null = null;
  let appVersionCache = FALLBACK_APP_VERSION;
  let defaultFetchPromise: Promise<boolean> | null = null;
  let staleSyncPromise: Promise<void> | null = null;

  function bindHostBridge() {
    const accounts = useAccountsStore();
    const player = usePlayerStore();
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
      getCurrentTrack: () => {
        const s = player.currentSong;
        if (!s) return null;
        return {
          id: s.id,
          hash: s.hash,
          title: s.title,
          artist: s.artist,
          album: s.album,
          duration: s.duration,
        };
      },
      isPlaying: () => Boolean(player.isPlaying),
      pausePlayback: async () => {
        await player.togglePlay(false);
      },
    });
  }

  async function persistMeta() {
    const record: PluginsMetaRecord = {
      defaultRegistryDismissed: defaultRegistryDismissed.value,
      pinnedIds: [...pinnedIds.value],
      developerMode: developerMode.value,
      lastAutoSyncAt: lastAutoSyncAt.value,
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

  function isAppVersionCompatible(manifest: Pick<MelunePluginManifest, 'minAppVersion'>): boolean {
    if (!manifest.minAppVersion) return true;
    return compareSemver(appVersionCache, manifest.minAppVersion) >= 0;
  }

  /**
   * Independent OTA update detector:
   * Detects BOTH semantic version upgrades AND same-version SHA-256 hotfix updates.
   */
  function getAvailableUpdate(pluginId: string): PluginUpdateCandidate | null {
    const local = installed.value.find((p) => p.manifest.id === pluginId);
    if (!local) return null;
    let best: PluginUpdateCandidate | null = null;
    for (const reg of registries.value) {
      const candidate = reg.plugins.find((p) => p.id === pluginId);
      if (!candidate) continue;
      const cmp = compareSemver(candidate.version, local.manifest.version);
      const hotfixSameVersion =
        cmp === 0 && candidate.sha256.toLowerCase() !== local.manifest.sha256.toLowerCase();
      if (cmp > 0 || hotfixSameVersion) {
        if (
          !best ||
          compareSemver(candidate.version, best.manifest.version) > 0 ||
          (compareSemver(candidate.version, best.manifest.version) === 0 && !best.isHotfixSameVersion)
        ) {
          best = {
            manifest: candidate,
            registryUrl: reg.url,
            registryName: reg.name,
            isHotfixSameVersion: hotfixSameVersion,
          };
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

  async function setDeveloperMode(enabled: boolean) {
    developerMode.value = Boolean(enabled);
    await persistMeta();
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
    if (!unsubPanel) {
      unsubPanel = pluginRuntime.subscribePanelUpdates(() => {
        runtimeTick.value += 1;
      });
    }

    const [savedRegs, savedInstalled, savedSafe, savedMeta] = await Promise.all([
      echoSystem.kvGetJson<SavedPluginRegistry[]>(REGISTRIES_KEY, []),
      echoSystem.kvGetJson<InstalledMelunePlugin[]>(INSTALLED_KEY, []),
      echoSystem.kvGetJson<{ enabled?: boolean }>(SAFE_MODE_KEY, { enabled: false }),
      echoSystem.kvGetJson<PluginsMetaRecord>(META_KEY, {}),
    ]);

    // Strictly decoupled from App updates: NEVER overwrite or reset user's installed plugins or data!
    registries.value = Array.isArray(savedRegs) ? savedRegs : [];
    installed.value = Array.isArray(savedInstalled) ? savedInstalled : [];
    safeMode.value = Boolean(savedSafe?.enabled);
    defaultRegistryDismissed.value = Boolean(savedMeta?.defaultRegistryDismissed);
    developerMode.value = Boolean(savedMeta?.developerMode);
    lastAutoSyncAt.value = Number(savedMeta?.lastAutoSyncAt || 0);
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
        lastAutoSyncAt.value = Date.now();
        await persistMeta();
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

  /**
   * Silent independent OTA index check when opening the Plugins tab:
   * Refreshes cached registries if stale (>= 15 min), completely independent of App APK updates.
   */
  async function syncRegistriesIfStale(ttlMs = DEFAULT_STALE_TTL_MS): Promise<boolean> {
    if (!hasDefaultRegistry.value && !defaultRegistryDismissed.value) {
      return ensureDefaultRegistryLoaded();
    }
    if (!registries.value.length) return false;
    if (Date.now() - lastAutoSyncAt.value < ttlMs) return false;
    if (staleSyncPromise) {
      await staleSyncPromise;
      return true;
    }
    staleSyncPromise = (async () => {
      try {
        await refreshAllRegistries();
        lastAutoSyncAt.value = Date.now();
        await persistMeta();
      } finally {
        staleSyncPromise = null;
      }
    })();
    await staleSyncPromise;
    return true;
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
    if (syncedCount > 0) {
      lastAutoSyncAt.value = Date.now();
      await persistMeta();
    }
    return { syncedCount, updatesCount: availableUpdatesCount.value };
  }

  /**
   * Checks ONLY a single installed plugin against its own remote registry for independent OTA update.
   */
  async function checkSinglePluginUpdate(pluginId: string): Promise<{
    hasUpdate: boolean;
    update: PluginUpdateCandidate | null;
    latestVersion: string;
  }> {
    const local = getInstalledPlugin(pluginId);
    if (!local) {
      return { hasUpdate: false, update: null, latestVersion: '' };
    }
    checkingSinglePluginId.value = pluginId;
    try {
      const targetUrl = local.registryUrl || DEFAULT_PLUGIN_REGISTRY_URL;
      await addOrRefreshRegistry(targetUrl);
      const update = getAvailableUpdate(pluginId);
      return {
        hasUpdate: Boolean(update),
        update,
        latestVersion: update?.manifest.version || local.manifest.version,
      };
    } finally {
      checkingSinglePluginId.value = '';
    }
  }

  async function installVerifiedManifest(
    manifest: MelunePluginManifest,
    registryUrl?: string,
    options: { silentToast?: boolean; isUpdate?: boolean } = {},
  ): Promise<boolean> {
    const ui = useUiStore();
    if (!isAppVersionCompatible(manifest)) {
      if (!options.silentToast) {
        ui.showToast(`「${manifest.name}」需要弥音 v${manifest.minAppVersion} 及以上版本`, 3400);
      }
      return false;
    }
    installingId.value = manifest.id;
    try {
      const bundle = await downloadAndVerifyPluginBundle(manifest, registryUrl);
      const now = Date.now();
      const existingIdx = installed.value.findIndex((p) => p.manifest.id === manifest.id);
      const existing = existingIdx >= 0 ? installed.value[existingIdx] : null;
      const record: InstalledMelunePlugin = {
        manifest: { ...manifest, sha256: bundle.sha256 },
        code: bundle.code,
        sourceUrl: bundle.sourceUrl,
        registryUrl: registryUrl || existing?.registryUrl,
        enabled: existing ? existing.enabled : true,
        installedAt: existing ? existing.installedAt : now,
        updatedAt: now,
        grantedPermissions: [...manifest.permissions],
      };

      // Lossless upgrade: strictly preserves ext.data.<id>:* storage & user's enabled/pinned state!
      if (existingIdx >= 0) {
        installed.value.splice(existingIdx, 1, record);
      } else {
        installed.value.unshift(record);
      }
      await echoSystem.kvSetJson(INSTALLED_KEY, installed.value);

      if (!safeMode.value && record.enabled) {
        bindHostBridge();
        const ok = await pluginRuntime.loadPlugin(record);
        if (!ok) {
          const st = pluginRuntime.getPluginRuntimeStatus(record.manifest.id);
          if (!options.silentToast) {
            ui.showToast(st.lastError || '插件已更新，但初始化异常', 3200);
          }
          return false;
        }
      }
      if (!options.silentToast) {
        echoSystem.haptic('success');
        ui.showToast(`${options.isUpdate ? '已独立热更新' : '已安装'}「${record.manifest.name}」`);
      }
      return true;
    } catch (err: any) {
      if (!options.silentToast) {
        ui.showToast(err?.message || '插件安装失败', 3400);
      }
      return false;
    } finally {
      installingId.value = '';
      runtimeTick.value += 1;
    }
  }

  async function updateAllAvailablePlugins(): Promise<{ updated: number; failed: number }> {
    if (updatingAll.value) return { updated: 0, failed: 0 };
    updatingAll.value = true;
    let updated = 0;
    let failed = 0;
    try {
      const snapshot = [...installed.value];
      for (const item of snapshot) {
        const up = getAvailableUpdate(item.manifest.id);
        if (!up) continue;
        const ok = await installVerifiedManifest(up.manifest, up.registryUrl, {
          silentToast: true,
          isUpdate: true,
        });
        if (ok) updated += 1;
        else failed += 1;
      }
      if (updated > 0) {
        echoSystem.haptic('success');
        useUiStore().showToast(
          failed > 0 ? `已热更新 ${updated} 款插件（${failed} 款失败）` : `已无损热更新 ${updated} 款插件`,
        );
      }
      return { updated, failed };
    } finally {
      updatingAll.value = false;
      runtimeTick.value += 1;
    }
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
    const ok = await installVerifiedManifest(req.manifest, req.registryUrl, {
      isUpdate: req.isUpdate,
    });
    if (ok) pendingReview.value = null;
    return ok;
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

  function getBadge(pluginId: string): MelunePanelBadge | null {
    void runtimeTick.value;
    return pluginRuntime.getPluginBadge(pluginId);
  }

  return {
    registries,
    installed,
    safeMode,
    developerMode,
    busy,
    syncingRegistryUrl,
    checkingSinglePluginId,
    updatingAll,
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
    syncRegistriesIfStale,
    restoreDefaultRegistry,
    refreshAllRegistries,
    checkSinglePluginUpdate,
    updateAllAvailablePlugins,
    isAppVersionCompatible,
    setSafeMode,
    setDeveloperMode,
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
    getBadge,
  };
});
