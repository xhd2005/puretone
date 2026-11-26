import type { AudioQuality, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { extractUrlsFromPayload, getPinnedSource, getTrackKey, resolveUnblockedUrl } from './unblockEngine';

export interface ResolvedStream {
  url: string;
  quality: AudioQuality;
  sourceTag: string;
  isUnblocked: boolean;
  headers?: Record<string, string>;
}

interface CachedStreamEntry {
  stream: ResolvedStream;
  quality: AudioQuality;
  cachedAt: number;
}

const PREFETCH_TTL_MS = 14 * 60 * 1000;
const resolvedCache = new Map<string, CachedStreamEntry>();

export function getCachedResolvedStream(song: Song, quality: AudioQuality): ResolvedStream | null {
  const key = getTrackKey(song);
  const entry = resolvedCache.get(key);
  if (!entry) return null;
  if (entry.quality !== quality || Date.now() - entry.cachedAt > PREFETCH_TTL_MS) {
    resolvedCache.delete(key);
    return null;
  }
  return entry.stream;
}

export function setCachedResolvedStream(song: Song, quality: AudioQuality, stream: ResolvedStream): void {
  const key = getTrackKey(song);
  resolvedCache.set(key, { stream, quality, cachedAt: Date.now() });
  if (resolvedCache.size > 40) {
    const firstKey = resolvedCache.keys().next().value;
    if (firstKey) resolvedCache.delete(firstKey);
  }
}

export function clearCachedResolvedStream(song?: Song): void {
  if (!song) {
    resolvedCache.clear();
    return;
  }
  resolvedCache.delete(getTrackKey(song));
}

function pickQualityHashFromPrivilege(privBody: any, quality: AudioQuality, fallbackHash: string): string {
  const goods = privBody?.data?.[0]?.relate_goods;
  if (!Array.isArray(goods)) return fallbackHash;

  const targetLevel = quality === 'flac' ? 5 : quality === '320' ? 4 : 2;
  const matched =
    goods.find((g: any) => Number(g?.level) === targetLevel && g?.hash) ||
    (quality === 'flac' ? goods.find((g: any) => /flac/i.test(String(g?.quality || '')) && g?.hash) : null) ||
    (quality === '320' ? goods.find((g: any) => /320|high/i.test(String(g?.quality || '')) && g?.hash) : null);

  return String(matched?.hash || fallbackHash);
}

function isTrialSnippet(body: any, expectedDurationSec: number): boolean {
  const timeLen = Number(body?.timeLength ?? body?.data?.timeLength ?? 0);
  const actualSec = timeLen > 1000 ? timeLen / 1000 : timeLen;
  if (expectedDurationSec >= 90 && actualSec > 0 && actualSec <= 65 && expectedDurationSec - actualSec >= 30) {
    return true;
  }
  return Boolean(body?.is_try_listen === 1 || body?.free_part === 1);
}

export async function resolvePlayableStream(
  song: Song,
  preferredQuality: AudioQuality = '320',
  options: { enableUnblock?: boolean; bypassCache?: boolean } = {},
): Promise<ResolvedStream> {
  const enableUnblock = options.enableUnblock !== false;

  // 0a. Fast return from in-memory prefetch cache (instant track switch!)
  if (!options.bypassCache) {
    const cached = getCachedResolvedStream(song, preferredQuality);
    if (cached) return cached;
  }

  // 0b. Pinned unblock source always wins
  if (enableUnblock) {
    const pinned = await getPinnedSource(song);
    if (pinned) {
      const unblocked = await resolveUnblockedUrl(song, preferredQuality);
      if (unblocked) {
        const res: ResolvedStream = { ...unblocked, isUnblocked: true };
        setCachedResolvedStream(song, preferredQuality, res);
        return res;
      }
    }
  }

  // 1. Official KuGou catalog resolution (skip multi-attempt waterfall when known copyright-gray)
  let fallbackTrial: ResolvedStream | null = null;
  const skipOfficialRetries = Boolean(song.isGray && enableUnblock);

  if (song.hash && !skipOfficialRetries) {
    let targetHash =
      (preferredQuality === 'flac' && song.hashFlac) ||
      (preferredQuality === '320' && song.hash320) ||
      song.hash;

    try {
      const priv = await kugouApi.getSongPrivilegeLite(song.hash);
      targetHash = pickQualityHashFromPrivilege(priv?.body, preferredQuality, targetHash);
    } catch {
      // non-fatal
    }

    const attempts: Array<{ hash: string; quality: string; useNew?: boolean; label: AudioQuality }> = [];
    if (preferredQuality === 'flac') {
      if (targetHash) attempts.push({ hash: targetHash, quality: 'flac', label: 'flac' });
      if (song.hash320 || song.hash) attempts.push({ hash: song.hash320 || song.hash, quality: '320', label: '320' });
    } else if (preferredQuality === '320') {
      if (targetHash) attempts.push({ hash: targetHash, quality: '320', label: '320' });
    }
    attempts.push({ hash: song.hash, quality: '128', label: '128' });
    attempts.push({ hash: song.hash, quality: '', label: '128' });
    attempts.push({ hash: song.hash, quality: preferredQuality, useNew: true, label: preferredQuality });

    for (const attempt of attempts) {
      if (!attempt.hash) continue;
      try {
        const res = attempt.useNew
          ? await kugouApi.getSongUrlNew(attempt.hash, attempt.quality)
          : await kugouApi.getSongUrl(attempt.hash, attempt.quality);
        const urls = extractUrlsFromPayload(res?.body);
        if (urls.length === 0) continue;

        const trial = isTrialSnippet(res?.body, song.duration);
        const candidate: ResolvedStream = {
          url: urls[0],
          quality: attempt.label,
          sourceTag: attempt.label === 'flac' ? '无损 FLAC' : attempt.label === '320' ? '高品 320k' : '标准 128k',
          isUnblocked: false,
        };
        if (!trial) {
          setCachedResolvedStream(song, preferredQuality, candidate);
          return candidate;
        }
        if (!fallbackTrial) fallbackTrial = candidate;
      } catch {
        // continue
      }
    }
  }

  // 2. Built-in 4-channel gray-song / trial-snippet unblock waterfall
  if (enableUnblock) {
    const unblocked = await resolveUnblockedUrl(song, preferredQuality);
    if (unblocked) {
      const res: ResolvedStream = { ...unblocked, isUnblocked: true };
      setCachedResolvedStream(song, preferredQuality, res);
      return res;
    }
  }

  if (fallbackTrial) {
    return { ...fallbackTrial, sourceTag: '试听片段' };
  }

  throw new Error('暂无可用音源，点击「换源」试试其他版本');
}
