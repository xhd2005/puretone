import type { AudioQuality, ParsedLyrics, PinnedSource, Song, UnblockCandidate } from '@/types/music';
import { nativeHttpRequest, type NativeHttpRequestOptions } from '@/native/echoHttp';
import { echoSystem, type HapticStyle } from '@/native/echoSystem';
import { callKugouRoute, kugouApi } from '@/services/kugou/kugouEngine';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';
import { computeUtf8Sha256Hex } from './registryClient';
import type {
  InstalledMelunePlugin,
  MeluneAudioResolverProvider,
  MeluneLyricFilter,
  MelunePanelProvider,
  MelunePanelView,
  MelunePermission,
  MelunePluginContext,
  MelunePluginDefinition,
  PluginAccountSummary,
  PluginResolvedAudio,
} from './types';

export interface PluginHostBridge {
  getAppVersion: () => string;
  getActiveAccount: () => PluginAccountSummary | null;
  listAccounts: () => PluginAccountSummary[];
  getAuthForUser: (userid?: string) => { token: string; userid: string; t1?: string } | null;
  refreshAccount: (userid?: string) => Promise<void>;
  showToast: (msg: string, durationMs?: number) => void;
}

const DEFAULT_HOST_BRIDGE: PluginHostBridge = {
  getAppVersion: () => FALLBACK_APP_VERSION,
  getActiveAccount: () => null,
  listAccounts: () => [],
  getAuthForUser: () => null,
  refreshAccount: async () => {},
  showToast: () => {},
};

const ALLOWED_KUGOU_PLUGIN_ROUTES = new Set<string>([
  '/youth/day/vip',
  '/youth/day/vip/upgrade',
  '/youth/vip',
  '/youth/listen/song',
  '/youth/month/vip/record',
  '/youth/union/vip',
  '/user/listen/report',
  '/playhistory/upload',
  '/user/vip/detail',
  '/user/batch/union/vipinfo',
  '/v2/batch_union_vipinfo',
  '/team/period/info',
  '/team/my/info',
  '/team/my',
  '/team/join',
  '/team/my/status',
  '/team/history',
  '/search',
  '/privilege/lite',
  '/song/url',
  '/song/url/new',
]);

interface LoadedPluginEntry {
  id: string;
  installed: InstalledMelunePlugin;
  definition: MelunePluginDefinition;
  audioResolvers: MeluneAudioResolverProvider[];
  lyricFilters: MeluneLyricFilter[];
  panelProvider: MelunePanelProvider | null;
  launchHooks: Array<() => Promise<void> | void>;
  authLoginHooks: Array<(userid: string) => Promise<void> | void>;
  lastError: string;
}

class MelunePluginRuntime {
  private host: PluginHostBridge = DEFAULT_HOST_BRIDGE;
  private loaded = new Map<string, LoadedPluginEntry>();
  private safeMode = false;
  private panelListeners = new Set<(pluginId: string) => void>();
  private statusListeners = new Set<() => void>();

  setHostBridge(bridge: PluginHostBridge) {
    this.host = bridge;
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  setSafeMode(enabled: boolean) {
    this.safeMode = Boolean(enabled);
    if (this.safeMode) {
      void this.unloadAll();
    }
    this.emitStatusChange();
  }

  subscribePanelUpdates(cb: (pluginId: string) => void): () => void {
    this.panelListeners.add(cb);
    return () => this.panelListeners.delete(cb);
  }

  subscribeStatus(cb: () => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  private emitPanelUpdate(pluginId: string) {
    for (const cb of this.panelListeners) {
      try {
        cb(pluginId);
      } catch {
        // isolate UI listener errors
      }
    }
  }

  private emitStatusChange() {
    for (const cb of this.statusListeners) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
  }

  private assertPermission(pluginId: string, granted: Set<MelunePermission>, perm: MelunePermission) {
    if (!granted.has(perm)) {
      throw new Error(`插件「${pluginId}」未获得权限：${perm}`);
    }
  }

  private assertSafeHttpUrl(url: string) {
    const trimmed = String(url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new Error('插件网络请求仅允许 http:// 或 https:// 协议');
    }
  }

  private assertSafeStorageKey(key: string): string {
    const clean = String(key || '').trim();
    if (!clean || clean.length > 120 || clean.includes('..')) {
      throw new Error('插件存储键名不合法');
    }
    return clean;
  }

  async loadPlugin(installed: InstalledMelunePlugin): Promise<boolean> {
    const id = installed.manifest.id;
    await this.unloadPlugin(id);

    if (this.safeMode || !installed.enabled) {
      return false;
    }

    // Re-verify code integrity on every load so tampered storage never executes
    const actualSha = computeUtf8Sha256Hex(installed.code);
    if (actualSha !== installed.manifest.sha256.toLowerCase()) {
      this.recordLoadError(installed, '本地插件代码完整性校验失败，已拒绝加载');
      return false;
    }

    const granted = new Set<MelunePermission>(installed.grantedPermissions || installed.manifest.permissions);
    const entry: LoadedPluginEntry = {
      id,
      installed,
      definition: { setup: () => {} },
      audioResolvers: [],
      lyricFilters: [],
      panelProvider: null,
      launchHooks: [],
      authLoginHooks: [],
      lastError: '',
    };

    const storagePrefix = `ext.data.${id}:`;

    const ctx: MelunePluginContext = {
      pluginId: id,
      appVersion: this.host.getAppVersion(),
      permissions: Object.freeze(Array.from(granted)),
      storage: {
        get: async <T>(key: string, fallback: T): Promise<T> => {
          this.assertPermission(id, granted, 'storage');
          const safeKey = this.assertSafeStorageKey(key);
          return echoSystem.kvGetJson<T>(`${storagePrefix}${safeKey}`, fallback);
        },
        set: async (key: string, value: unknown): Promise<void> => {
          this.assertPermission(id, granted, 'storage');
          const safeKey = this.assertSafeStorageKey(key);
          await echoSystem.kvSetJson(`${storagePrefix}${safeKey}`, value);
        },
        remove: async (key: string): Promise<void> => {
          this.assertPermission(id, granted, 'storage');
          const safeKey = this.assertSafeStorageKey(key);
          await echoSystem.kvDelete(`${storagePrefix}${safeKey}`);
        },
      },
      http: {
        request: async (opts: NativeHttpRequestOptions) => {
          this.assertPermission(id, granted, 'network');
          this.assertSafeHttpUrl(opts.url);
          return nativeHttpRequest(opts);
        },
        getText: async (url: string, headers: Record<string, string> = {}, timeoutMs = 6000) => {
          this.assertPermission(id, granted, 'network');
          this.assertSafeHttpUrl(url);
          try {
            const res = await nativeHttpRequest({
              method: 'GET',
              url,
              headers,
              connectTimeoutMs: 4200,
              readTimeoutMs: timeoutMs,
            });
            if (res.status >= 200 && res.status < 400) {
              return { status: res.status, body: res.body || '', headers: res.headers || {}, url: res.url || url };
            }
          } catch {
            // non-fatal
          }
          return null;
        },
        getJson: async (url: string, headers: Record<string, string> = {}, timeoutMs = 6000) => {
          const text = await ctx.http.getText(url, headers, timeoutMs);
          if (!text?.body) return null;
          try {
            return JSON.parse(text.body);
          } catch {
            return null;
          }
        },
        postJson: async (url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 7000) => {
          this.assertPermission(id, granted, 'network');
          this.assertSafeHttpUrl(url);
          const res = await nativeHttpRequest({
            method: 'POST',
            url,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...headers,
            },
            body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
            connectTimeoutMs: 4500,
            readTimeoutMs: timeoutMs,
          });
          let json: any = null;
          try {
            json = res.body ? JSON.parse(res.body) : null;
          } catch {
            json = null;
          }
          return { status: res.status, json, body: res.body || '' };
        },
      },
      kugou: {
        callRoute: async (route: string, params: Record<string, unknown> = {}, options?: { userid?: string }) => {
          this.assertPermission(id, granted, 'kugou.api');
          const normRoute = route.startsWith('/') ? route : `/${route}`;
          if (!ALLOWED_KUGOU_PLUGIN_ROUTES.has(normRoute)) {
            throw new Error(`插件「${id}」无权调用路由：${normRoute}`);
          }
          let authOverride: { token: string; userid: string; t1?: string } | null | undefined;
          if (options?.userid) {
            this.assertPermission(id, granted, 'kugou.auth');
            authOverride = this.host.getAuthForUser(options.userid);
            if (!authOverride) {
              throw new Error(`未找到已登录账号 ${options.userid}`);
            }
          }
          // Strip any accidental token injection from params so host controls auth strictly
          const safeParams = { ...params };
          delete safeParams.token;
          const res = await callKugouRoute(normRoute, safeParams, {
            authOverride,
            skipVerification: false,
          });
          return { status: res.status, body: res.body || {} };
        },
        searchSongs: async (keyword: string, page = 1, pagesize = 12) => {
          this.assertPermission(id, granted, 'kugou.api');
          return kugouApi.searchSongs(keyword, page, pagesize);
        },
        getSongUrl: async (hash: string, quality = '320', opts?: { albumId?: string; albumAudioId?: number }) => {
          this.assertPermission(id, granted, 'kugou.api');
          const res = await kugouApi.getSongUrl(hash, quality, opts);
          return { status: res.status, body: res.body || {} };
        },
        getActiveAccount: () => {
          this.assertPermission(id, granted, 'kugou.auth');
          return this.host.getActiveAccount();
        },
        listAccounts: () => {
          this.assertPermission(id, granted, 'kugou.auth');
          return this.host.listAccounts();
        },
        refreshAccount: async (userid?: string) => {
          this.assertPermission(id, granted, 'kugou.auth');
          await this.host.refreshAccount(userid);
        },
      },
      ui: {
        toast: (msg: string, durationMs?: number) => {
          this.host.showToast(String(msg || ''), durationMs);
        },
        haptic: (style: HapticStyle = 'light') => {
          echoSystem.haptic(style);
        },
        copy: async (text: string) => {
          await echoSystem.copyToClipboard(String(text || ''));
        },
        refreshPanel: () => {
          this.emitPanelUpdate(id);
        },
      },
      registerAudioResolver: (provider: MeluneAudioResolverProvider) => {
        this.assertPermission(id, granted, 'audio.resolver');
        entry.audioResolvers.push(provider);
      },
      registerLyricFilter: (filter: MeluneLyricFilter) => {
        this.assertPermission(id, granted, 'lyric.filter');
        entry.lyricFilters.push(filter);
      },
      registerPanel: (provider: MelunePanelProvider) => {
        this.assertPermission(id, granted, 'ui.panel');
        entry.panelProvider = provider;
      },
      onAppLaunch: (handler: () => Promise<void> | void) => {
        this.assertPermission(id, granted, 'lifecycle.launch');
        entry.launchHooks.push(handler);
      },
      onAuthLogin: (handler: (userid: string) => Promise<void> | void) => {
        this.assertPermission(id, granted, 'lifecycle.launch');
        entry.authLoginHooks.push(handler);
      },
    };

    try {
      const moduleBox: { exports: unknown } = { exports: {} };
      const definePlugin = (def: MelunePluginDefinition): MelunePluginDefinition => def;
      // Strict sandboxed factory: plugin receives ONLY explicit `melune` SDK & `module`/`exports`
      const factory = new Function(
        'module',
        'exports',
        'defineMelunePlugin',
        `"use strict";\n${installed.code}\nreturn module.exports;`,
      );
      const exported = factory(moduleBox, moduleBox.exports, definePlugin) as
        | MelunePluginDefinition
        | { default?: MelunePluginDefinition }
        | ((ctx: MelunePluginContext) => Promise<void> | void);

      let def: MelunePluginDefinition | null = null;
      if (typeof exported === 'function') {
        def = { setup: exported };
      } else if (exported && typeof exported === 'object') {
        if ('setup' in exported && typeof exported.setup === 'function') {
          def = exported as MelunePluginDefinition;
        } else if ('default' in exported && exported.default && typeof exported.default.setup === 'function') {
          def = exported.default;
        }
      }

      if (!def) {
        throw new Error('插件入口未导出有效的 setup(ctx) 函数');
      }

      entry.definition = def;
      await def.setup(ctx);
      this.loaded.set(id, entry);
      this.emitStatusChange();
      this.emitPanelUpdate(id);
      return true;
    } catch (err: any) {
      this.recordLoadError(installed, err?.message || '插件初始化失败');
      return false;
    }
  }

  private recordLoadError(installed: InstalledMelunePlugin, message: string) {
    this.loaded.set(installed.manifest.id, {
      id: installed.manifest.id,
      installed,
      definition: { setup: () => {} },
      audioResolvers: [],
      lyricFilters: [],
      panelProvider: null,
      launchHooks: [],
      authLoginHooks: [],
      lastError: message,
    });
    this.emitStatusChange();
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const existing = this.loaded.get(pluginId);
    if (!existing) return;
    this.loaded.delete(pluginId);
    try {
      await existing.definition.teardown?.();
    } catch {
      // non-fatal teardown error
    }
    this.emitStatusChange();
  }

  async unloadAll(): Promise<void> {
    const ids = Array.from(this.loaded.keys());
    for (const id of ids) {
      await this.unloadPlugin(id);
    }
  }

  getPluginRuntimeStatus(pluginId: string): {
    loaded: boolean;
    hasPanel: boolean;
    hasAudioResolver: boolean;
    hasLyricFilter: boolean;
    lastError: string;
  } {
    const entry = this.loaded.get(pluginId);
    if (!entry) {
      return { loaded: false, hasPanel: false, hasAudioResolver: false, hasLyricFilter: false, lastError: '' };
    }
    return {
      loaded: !entry.lastError,
      hasPanel: Boolean(entry.panelProvider),
      hasAudioResolver: entry.audioResolvers.length > 0,
      hasLyricFilter: entry.lyricFilters.length > 0,
      lastError: entry.lastError,
    };
  }

  // ---- Audio Resolver Host Hooks ----

  hasAudioResolvers(): boolean {
    if (this.safeMode) return false;
    for (const entry of this.loaded.values()) {
      if (!entry.lastError && entry.audioResolvers.length > 0) return true;
    }
    return false;
  }

  private getActiveAudioResolvers(): MeluneAudioResolverProvider[] {
    if (this.safeMode) return [];
    const list: MeluneAudioResolverProvider[] = [];
    for (const entry of this.loaded.values()) {
      if (!entry.lastError) list.push(...entry.audioResolvers);
    }
    return list;
  }

  async getPinnedAudio(song: Song): Promise<PinnedSource | null> {
    for (const resolver of this.getActiveAudioResolvers()) {
      if (!resolver.getPinned) continue;
      try {
        const pin = await resolver.getPinned(song);
        if (pin) return pin;
      } catch {
        // isolate plugin errors
      }
    }
    return null;
  }

  async pinAudioSource(
    song: Song,
    candidate: UnblockCandidate,
    resolvedUrl: string,
    headers?: Record<string, string>,
  ): Promise<void> {
    for (const resolver of this.getActiveAudioResolvers()) {
      if (!resolver.pin) continue;
      try {
        await resolver.pin(song, candidate, resolvedUrl, headers);
        return;
      } catch {
        // continue
      }
    }
  }

  async unpinAudioSource(song: Song): Promise<void> {
    for (const resolver of this.getActiveAudioResolvers()) {
      if (!resolver.unpin) continue;
      try {
        await resolver.unpin(song);
      } catch {
        // ignore
      }
    }
  }

  async scanAudioCandidates(song: Song, quality: AudioQuality): Promise<UnblockCandidate[]> {
    const resolvers = this.getActiveAudioResolvers();
    if (!resolvers.length) return [];
    const settled = await Promise.allSettled(resolvers.map((r) => r.searchCandidates(song, quality)));
    const merged: UnblockCandidate[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled' && Array.isArray(s.value)) {
        merged.push(...s.value);
      }
    }
    return merged.sort((a, b) => b.score - a.score).slice(0, 16);
  }

  async resolveAudioCandidate(
    candidate: UnblockCandidate,
    quality: AudioQuality,
    expectedDurationSec = 0,
  ): Promise<{ url: string; quality: AudioQuality; headers?: Record<string, string>; sourceTag?: string } | null> {
    for (const resolver of this.getActiveAudioResolvers()) {
      try {
        const res = await resolver.resolveCandidate(candidate, quality, expectedDurationSec);
        if (res?.url && /^https?:\/\//i.test(res.url)) return res;
      } catch {
        // try next resolver
      }
    }
    return null;
  }

  async resolveFallbackAudio(song: Song, quality: AudioQuality): Promise<PluginResolvedAudio | null> {
    for (const resolver of this.getActiveAudioResolvers()) {
      try {
        const res = await resolver.resolveFallback(song, quality);
        if (res?.url && /^https?:\/\//i.test(res.url)) return res;
      } catch {
        // isolate resolver errors
      }
    }
    return null;
  }

  // ---- Lyric Filter Host Hooks ----

  async applyLyricFilters(lyrics: ParsedLyrics, song: Song): Promise<ParsedLyrics> {
    if (this.safeMode || !lyrics.lines.length) return lyrics;
    let current = lyrics;
    for (const entry of this.loaded.values()) {
      if (entry.lastError || !entry.lyricFilters.length) continue;
      for (const filter of entry.lyricFilters) {
        try {
          const next = await filter(current, song);
          if (next && Array.isArray(next.lines)) {
            current = next;
          }
        } catch {
          // isolate broken lyric filter
        }
      }
    }
    return current;
  }

  // ---- Declarative UI Panel Host Hooks ----

  async renderPluginPanel(pluginId: string): Promise<MelunePanelView | null> {
    if (this.safeMode) return null;
    const entry = this.loaded.get(pluginId);
    if (!entry || entry.lastError || !entry.panelProvider) return null;
    try {
      return await entry.panelProvider.render();
    } catch (err: any) {
      entry.lastError = err?.message || '面板渲染异常';
      this.emitStatusChange();
      return null;
    }
  }

  async dispatchPluginAction(
    pluginId: string,
    action: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    if (this.safeMode) return;
    const entry = this.loaded.get(pluginId);
    if (!entry || entry.lastError || !entry.panelProvider) return;
    try {
      await entry.panelProvider.onAction(action, payload);
      this.emitPanelUpdate(pluginId);
    } catch (err: any) {
      this.host.showToast(err?.message || '插件执行失败');
    }
  }

  // ---- Lifecycle Host Hooks ----

  async runLaunchHooks(): Promise<void> {
    if (this.safeMode) return;
    for (const entry of this.loaded.values()) {
      if (entry.lastError) continue;
      for (const hook of entry.launchHooks) {
        try {
          await hook();
        } catch {
          // isolate launch hook failure
        }
      }
    }
  }

  async runAuthLoginHooks(userid: string): Promise<void> {
    if (this.safeMode) return;
    for (const entry of this.loaded.values()) {
      if (entry.lastError) continue;
      for (const hook of entry.authLoginHooks) {
        try {
          await hook(userid);
        } catch {
          // isolate auth hook failure
        }
      }
    }
  }
}

export const pluginRuntime = new MelunePluginRuntime();
