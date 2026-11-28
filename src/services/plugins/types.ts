import type { AudioQuality, ParsedLyrics, PinnedSource, Song, UnblockCandidate } from '@/types/music';
import type { NativeHttpRequestOptions, NativeHttpResponse } from '@/native/echoHttp';
import type { HapticStyle } from '@/native/echoSystem';

export const MELUNE_EXT_PROTOCOL = 'melune-ext/v1' as const;
export const MELUNE_REGISTRY_PROTOCOL = 'melune-registry/v1' as const;

export type MelunePermission =
  | 'storage'
  | 'network'
  | 'kugou.api'
  | 'kugou.auth'
  | 'audio.resolver'
  | 'lyric.filter'
  | 'ui.panel'
  | 'lifecycle.launch';

export const ALL_MELUNE_PERMISSIONS: readonly MelunePermission[] = [
  'storage',
  'network',
  'kugou.api',
  'kugou.auth',
  'audio.resolver',
  'lyric.filter',
  'ui.panel',
  'lifecycle.launch',
] as const;

export type MelunePluginCategory = 'audio' | 'lyrics' | 'account' | 'utility';

export interface MelunePluginManifest {
  protocol: typeof MELUNE_EXT_PROTOCOL;
  id: string;
  name: string;
  version: string;
  author: string;
  license?: string;
  description: string;
  icon?: string;
  category?: MelunePluginCategory;
  entry?: string;
  downloadUrl?: string;
  sha256: string;
  minAppVersion?: string;
  homepage?: string;
  permissions: MelunePermission[];
}

export interface MeluneRegistryIndex {
  protocol: typeof MELUNE_REGISTRY_PROTOCOL;
  id: string;
  name: string;
  maintainer?: string;
  description?: string;
  homepage?: string;
  updatedAt?: string;
  plugins: MelunePluginManifest[];
}

export interface SavedPluginRegistry {
  id: string;
  name: string;
  url: string;
  homepage?: string;
  maintainer?: string;
  description?: string;
  updatedAt?: string;
  addedAt: number;
  lastSyncedAt?: number;
  plugins: MelunePluginManifest[];
}

export interface InstalledMelunePlugin {
  manifest: MelunePluginManifest;
  code: string;
  sourceUrl: string;
  registryUrl?: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  grantedPermissions: MelunePermission[];
}

export interface PluginAccountSummary {
  userid: string;
  nickname: string;
  avatar?: string;
  isVip: boolean;
  tvipEndTime?: string;
  vipEndTime?: string;
}

export interface PluginResolvedAudio {
  url: string;
  quality: AudioQuality;
  sourceTag: string;
  headers?: Record<string, string>;
}

export interface MeluneAudioResolverProvider {
  id?: string;
  label?: string;
  searchCandidates: (song: Song, quality: AudioQuality) => Promise<UnblockCandidate[]>;
  resolveCandidate: (
    candidate: UnblockCandidate,
    quality: AudioQuality,
    expectedDurationSec?: number,
  ) => Promise<{ url: string; quality: AudioQuality; headers?: Record<string, string>; sourceTag?: string } | null>;
  resolveFallback: (song: Song, quality: AudioQuality) => Promise<PluginResolvedAudio | null>;
  getPinned?: (song: Song) => Promise<PinnedSource | null>;
  pin?: (
    song: Song,
    candidate: UnblockCandidate,
    resolvedUrl: string,
    headers?: Record<string, string>,
  ) => Promise<void>;
  unpin?: (song: Song) => Promise<void>;
}

export type MeluneLyricFilter = (lyrics: ParsedLyrics, song: Song) => ParsedLyrics | Promise<ParsedLyrics>;

// ---- Declarative Liquid Glass UI Schema (Zero untrusted raw HTML!) ----

export type MelunePanelBlock =
  | {
      type: 'hero-stat';
      label: string;
      value: string;
      unit?: string;
      sub?: string;
      badge?: string;
    }
  | {
      type: 'kv-grid';
      columns?: 2 | 3;
      items: Array<{ label: string; value: string; accent?: boolean; muted?: boolean }>;
    }
  | {
      type: 'notice';
      tone?: 'info' | 'success' | 'warning' | 'error';
      title?: string;
      text: string;
    }
  | {
      type: 'copy-code';
      label: string;
      code: string;
      hint?: string;
    }
  | {
      type: 'button-row';
      buttons: Array<{
        id: string;
        label: string;
        action: string;
        payload?: Record<string, unknown>;
        variant?: 'primary' | 'secondary' | 'danger';
        disabled?: boolean;
        loading?: boolean;
      }>;
    }
  | {
      type: 'toggle';
      id: string;
      label: string;
      sub?: string;
      value: boolean;
      action: string;
    }
  | {
      type: 'text-input';
      id: string;
      label: string;
      placeholder?: string;
      value: string;
      submitLabel?: string;
      action: string;
      hint?: string;
      clearable?: boolean;
    }
  | {
      type: 'steps';
      items: Array<{
        label: string;
        status: 'idle' | 'running' | 'success' | 'already' | 'failed' | 'skipped';
        detail?: string;
      }>;
    }
  | {
      type: 'calendar';
      title: string;
      cells: Array<{
        empty?: boolean;
        key: string;
        day?: number;
        isToday?: boolean;
        isClaimed?: boolean;
        isFailed?: boolean;
        isFuture?: boolean;
      }>;
    }
  | {
      type: 'badge-list';
      title?: string;
      items: Array<{
        label: string;
        active?: boolean;
        action?: string;
        payload?: Record<string, unknown>;
      }>;
    };

export interface MelunePanelSection {
  title?: string;
  blocks: MelunePanelBlock[];
}

export interface MelunePanelView {
  subtitle?: string;
  sections: MelunePanelSection[];
}

export interface MelunePanelProvider {
  render: () => Promise<MelunePanelView> | MelunePanelView;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<void> | void;
}

export interface MelunePluginContext {
  readonly pluginId: string;
  readonly appVersion: string;
  readonly permissions: readonly MelunePermission[];
  readonly storage: {
    get: <T>(key: string, fallback: T) => Promise<T>;
    set: (key: string, value: unknown) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  readonly http: {
    request: (opts: NativeHttpRequestOptions) => Promise<NativeHttpResponse>;
    getText: (
      url: string,
      headers?: Record<string, string>,
      timeoutMs?: number,
    ) => Promise<{ status: number; body: string; headers: Record<string, string>; url: string } | null>;
    getJson: (url: string, headers?: Record<string, string>, timeoutMs?: number) => Promise<any>;
    postJson: (
      url: string,
      body: unknown,
      headers?: Record<string, string>,
      timeoutMs?: number,
    ) => Promise<{ status: number; json: any; body: string }>;
  };
  readonly kugou: {
    callRoute: (
      route: string,
      params?: Record<string, unknown>,
      options?: { userid?: string },
    ) => Promise<{ status: number; body: Record<string, any> }>;
    searchSongs: (keyword: string, page?: number, pagesize?: number) => Promise<{ songs: Song[]; total: number }>;
    getSongUrl: (
      hash: string,
      quality?: string,
      opts?: { albumId?: string; albumAudioId?: number },
    ) => Promise<{ status: number; body: Record<string, any> }>;
    getActiveAccount: () => PluginAccountSummary | null;
    listAccounts: () => PluginAccountSummary[];
    refreshAccount: (userid?: string) => Promise<void>;
  };
  readonly ui: {
    toast: (msg: string, durationMs?: number) => void;
    haptic: (style?: HapticStyle) => void;
    copy: (text: string) => Promise<void>;
    refreshPanel: () => void;
  };
  readonly registerAudioResolver: (provider: MeluneAudioResolverProvider) => void;
  readonly registerLyricFilter: (filter: MeluneLyricFilter) => void;
  readonly registerPanel: (provider: MelunePanelProvider) => void;
  readonly onAppLaunch: (handler: () => Promise<void> | void) => void;
  readonly onAuthLogin: (handler: (userid: string) => Promise<void> | void) => void;
}

export interface MelunePluginDefinition {
  setup: (ctx: MelunePluginContext) => Promise<void> | void;
  teardown?: () => Promise<void> | void;
}

export interface PendingPluginInstallIntent {
  kind: 'registry' | 'plugin';
  registryUrl: string;
  pluginId?: string;
}
