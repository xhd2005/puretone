import type { AudioQuality, Song } from '@/types/music';
import { echoPlayer } from '@/native/echoPlayer';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { extractUrlsFromPayload, getPinnedSource, getTrackKey, resolveUnblockedUrl } from './unblockEngine';

export interface ResolvedStream {
  url: string;
  quality: AudioQuality;
  sourceTag: string;
  isUnblocked: boolean;
  headers?: Record<string, string>;
  cacheKey?: string;
}

interface CachedStreamEntry {
  stream: ResolvedStream;
  quality: AudioQuality;
  cachedAt: number;
}

export const PREFETCH_TTL_MS = 5 * 60 * 1000;
const resolvedCache = new Map<string, CachedStreamEntry>();

export function classifyAudioSourceBucket(sourceTag?: string, isUnblocked?: boolean): string {
  const tag = String(sourceTag || '').trim();
  if (tag === '试听片段' || /试听/i.test(tag)) return 'trial';
  if (/本地缓存/i.test(tag)) return 'local';
  if (/酷狗异版|kugou-alt/i.test(tag)) return 'kugou-alt';
  if (/酷我|kuwo/i.test(tag)) return 'kuwo';
  if (/joox/i.test(tag)) return 'joox';
  if (/b站|bilibili/i.test(tag)) return 'bilibili';
  if (isUnblocked || /解灰/i.test(tag)) return 'unblock';
  return 'official';
}

/**
 * Generates a quality- and source-isolated SimpleCache key so switching quality (128/320/FLAC)
 * or unblocked sources NEVER collides with previously cached byte spans or lengths.
 * Trial snippets intentionally return `undefined` so they are never persisted into audio cache.
 */
export function buildAudioCacheKey(
  song: Pick<Song, 'hash' | 'id' | 'title' | 'artist'>,
  quality: AudioQuality,
  sourceTag?: string,
  isUnblocked?: boolean,
): string | undefined {
  const bucket = classifyAudioSourceBucket(sourceTag, isUnblocked);
  if (bucket === 'trial' || bucket === 'local') return undefined;
  const baseKey = getTrackKey(song);
  if (!baseKey) return undefined;
  return `v2:${baseKey}:${quality}:${bucket}`;
}

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

export function isTrialSnippet(body: any, expectedDurationSec: number, quality: AudioQuality = '128'): boolean {
  if (
    body?.is_try_listen === 1 ||
    body?.free_part === 1 ||
    body?.data?.is_try_listen === 1 ||
    body?.data?.free_part === 1 ||
    body?.data?.is_free_part === 1 ||
    body?.trans_param?.is_free_part === 1
  ) {
    return true;
  }

  const firstItem = Array.isArray(body?.data) ? body.data[0] : null;
  const rawTimeLen = Number(
    body?.timeLength ??
      body?.timelength ??
      body?.data?.timeLength ??
      body?.data?.timelength ??
      firstItem?.info?.duration ??
      firstItem?.timelength ??
      firstItem?.timeLength ??
      0,
  );
  const actualSec = rawTimeLen > 1000 ? rawTimeLen / 1000 : rawTimeLen;
  if (expectedDurationSec >= 90 && actualSec > 0 && actualSec <= 75 && expectedDurationSec - actualSec >= 30) {
    return true;
  }

  // Secondary check via byte size + bitrate when upstream spoofs/omits timeLength on 60s previews
  const fileSize = Number(
    body?.fileSize ??
      body?.filesize ??
      body?.data?.fileSize ??
      body?.data?.filesize ??
      firstItem?.info?.filesize ??
      0,
  );
  const rawBitrate = Number(body?.bitRate ?? body?.bitrate ?? firstItem?.info?.bitrate ?? 0);
  const bitrateKbps =
    rawBitrate >= 64 && rawBitrate <= 3200
      ? rawBitrate
      : quality === 'flac'
        ? 850
        : quality === '320'
          ? 320
          : 128;
  if (expectedDurationSec >= 90 && fileSize > 0 && bitrateKbps > 0) {
    const estSec = (fileSize * 8) / (bitrateKbps * 1000);
    if (estSec <= 72 && estSec < expectedDurationSec * 0.62) {
      return true;
    }
  }

  return false;
}

async function tryResolveLocalCachedStream(
  song: Song,
  preferredQuality: AudioQuality,
): Promise<ResolvedStream | null> {
  const baseKey = getTrackKey(song);
  if (!baseKey) return null;

  const qualityOrder: AudioQuality[] = Array.from(
    new Set<AudioQuality>([preferredQuality, 'flac', '320', '128']),
  );
  const bucketOrder = ['official', 'kugou-alt', 'kuwo', 'joox', 'bilibili', 'unblock'];

  for (const q of qualityOrder) {
    for (const bucket of bucketOrder) {
      const candidateKey = `v2:${baseKey}:${q}:${bucket}`;
      const cached = await echoPlayer.isTrackCached(candidateKey).catch(() => false);
      if (cached) {
        return {
          url: `https://melune.local.cache/${encodeURIComponent(candidateKey)}`,
          quality: q,
          sourceTag: '本地缓存',
          isUnblocked: bucket !== 'official',
          cacheKey: candidateKey,
        };
      }
    }
  }
  return null;
}

export async function resolvePlayableStream(
  song: Song,
  preferredQuality: AudioQuality = '320',
  options: { enableUnblock?: boolean; bypassCache?: boolean; forceUnblock?: boolean } = {},
): Promise<ResolvedStream> {
  const enableUnblock = options.enableUnblock !== false;
  const forceUnblock = Boolean(options.forceUnblock);
  const bypassCache = Boolean(options.bypassCache || forceUnblock);

  // 0a. Fast return from in-memory prefetch cache (instant track switch!)
  if (!bypassCache) {
    const cached = getCachedResolvedStream(song, preferredQuality);
    if (cached) return cached;
  }

  // 0a-offline. When device is strictly offline, immediately serve local Media3 SimpleCache audio!
  if (!forceUnblock && typeof navigator !== 'undefined' && navigator.onLine === false) {
    const offlineLocal = await tryResolveLocalCachedStream(song, preferredQuality);
    if (offlineLocal) return offlineLocal;
  }

  // 0b. Pinned unblock source always wins (unless explicitly forcing fresh unblock fallback below)
  if (enableUnblock && !forceUnblock) {
    const pinned = await getPinnedSource(song);
    if (pinned) {
      const unblocked = await resolveUnblockedUrl(song, preferredQuality);
      if (unblocked) {
        const res: ResolvedStream = {
          ...unblocked,
          isUnblocked: true,
          cacheKey: buildAudioCacheKey(song, unblocked.quality, unblocked.sourceTag, true),
        };
        setCachedResolvedStream(song, preferredQuality, res);
        return res;
      }
    }
  }

  // 1. Official KuGou catalog resolution (skip when copyright-gray or forcing alternate unblock recovery)
  let fallbackTrial: ResolvedStream | null = null;
  const skipOfficialRetries = forceUnblock || Boolean(song.isGray && enableUnblock);

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

        const trial = isTrialSnippet(res?.body, song.duration, attempt.label);
        const sourceTag = attempt.label === 'flac' ? '无损 FLAC' : attempt.label === '320' ? '高品 320k' : '标准 128k';
        const candidate: ResolvedStream = {
          url: urls[0],
          quality: attempt.label,
          sourceTag,
          isUnblocked: false,
          cacheKey: trial ? undefined : buildAudioCacheKey(song, attempt.label, sourceTag, false),
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

  // 2. Built-in 4-channel gray-song / trial-snippet / recovery unblock waterfall
  if (enableUnblock || forceUnblock) {
    const unblocked = await resolveUnblockedUrl(song, preferredQuality);
    if (unblocked) {
      const res: ResolvedStream = {
        ...unblocked,
        isUnblocked: true,
        cacheKey: buildAudioCacheKey(song, unblocked.quality, unblocked.sourceTag, true),
      };
      setCachedResolvedStream(song, preferredQuality, res);
      return res;
    }
  }

  // 3. Offline / weak-network local cache fallback (Media3 SimpleCache up to 2GB+!)
  if (!forceUnblock) {
    const offlineFallback = await tryResolveLocalCachedStream(song, preferredQuality);
    if (offlineFallback) {
      return offlineFallback;
    }
  }

  if (fallbackTrial) {
    return { ...fallbackTrial, sourceTag: '试听片段', cacheKey: undefined };
  }

  throw new Error('暂无可用音源，点击「换源」试试其他版本');
}
