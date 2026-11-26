import { echoSystem } from '@/native/echoSystem';
import type { PersistedListeningStatsV2 } from '@/stores/stats';
import type { PersistedSettings } from '@/stores/settings';
import type { PinnedSource } from '@/types/music';

const PINNED_STORAGE_KEY = 'unblock.pinned.v2';

export interface PureToneBackupPayload {
  app: 'PureTone';
  schemaVersion: 1;
  exportedAt: string;
  /** Strictly excludes account cookies / tokens for privacy safety */
  stats: Partial<PersistedListeningStatsV2>;
  settings: Partial<PersistedSettings>;
  pinnedSources: Record<string, PinnedSource>;
}

/**
 * Pure serializer producing a clean, token-free PureTone JSON backup.
 */
export function buildPureToneBackupJson(input: {
  stats: Partial<PersistedListeningStatsV2>;
  settings: Partial<PersistedSettings>;
  pinnedSources: Record<string, PinnedSource>;
}): string {
  const payload: PureToneBackupPayload = {
    app: 'PureTone',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    stats: input.stats,
    settings: input.settings,
    pinnedSources: input.pinnedSources,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Pure parser & validator for imported PureTone backup JSON.
 */
export function parsePureToneBackupJson(raw: string): PureToneBackupPayload {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    throw new Error('请粘贴有效的 PureTone 备份 JSON 内容');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('JSON 格式错误，请检查是否完整复制');
  }
  if (!parsed || typeof parsed !== 'object' || parsed.app !== 'PureTone') {
    throw new Error('非 PureTone 备份格式（缺少 app: "PureTone" 标识）');
  }
  const stats = parsed.stats && typeof parsed.stats === 'object' ? parsed.stats : {};
  const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  const pinnedSources =
    parsed.pinnedSources && typeof parsed.pinnedSources === 'object' ? parsed.pinnedSources : {};
  return {
    app: 'PureTone',
    schemaVersion: 1,
    exportedAt: String(parsed.exportedAt || ''),
    stats,
    settings,
    pinnedSources,
  };
}

export async function exportLocalBackupJson(
  statsSnapshot: Partial<PersistedListeningStatsV2>,
  settingsSnapshot: Partial<PersistedSettings>,
): Promise<string> {
  const pinnedSources = await echoSystem.kvGetJson<Record<string, PinnedSource>>(PINNED_STORAGE_KEY, {});
  return buildPureToneBackupJson({
    stats: statsSnapshot,
    settings: settingsSnapshot,
    pinnedSources,
  });
}

export async function restoreLocalBackupJson(
  raw: string,
  appliers: {
    applyStats: (s: Partial<PersistedListeningStatsV2>) => Promise<void>;
    applySettings: (s: Partial<PersistedSettings>) => Promise<void>;
  },
): Promise<{ pinnedCount: number; totalPlays: number }> {
  const backup = parsePureToneBackupJson(raw);
  await appliers.applyStats(backup.stats);
  await appliers.applySettings(backup.settings);
  const pinnedKeys = Object.keys(backup.pinnedSources);
  if (pinnedKeys.length > 0) {
    const existing = await echoSystem.kvGetJson<Record<string, PinnedSource>>(PINNED_STORAGE_KEY, {});
    await echoSystem.kvSetJson(PINNED_STORAGE_KEY, { ...existing, ...backup.pinnedSources });
  }
  return {
    pinnedCount: pinnedKeys.length,
    totalPlays: Number(backup.stats.totalPlays || 0),
  };
}
