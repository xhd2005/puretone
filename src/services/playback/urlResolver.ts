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

export interface ExtractedQualityHashes {
  high?: string;
  flac?: string;
  ogg320?: string;
  mp3320?: string;
  ogg128?: string;
  mp3128?: string;
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
 * Generates a quality- and source-isolated SimpleCache key so switching quality (128/320/FLAC/Hi-Res)
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

function cleanHash(val: unknown): string | undefined {
  const s = String(val || '').trim();
  return s.length >= 16 ? s : undefined;
}

/**
 * Extracts independent per-tier hashes from KuGou `/privilege/lite` (`relate_goods`, `trans_param`,
 * and `quality_vip`) so Hi-Res / FLAC / OGG 320 / MP3 320 / 128 NEVER silently fall back to a
 * 128k hash while mislabeling itself as 320k!
 */
export function extractQualityHashesFromPrivilege(
  privBody: any,
  song?: Partial<Pick<Song, 'hash' | 'hash320' | 'hashFlac' | 'hashHigh'>>,
): ExtractedQualityHashes {
  const out: ExtractedQualityHashes = {
    high: cleanHash(song?.hashHigh),
    flac: cleanHash(song?.hashFlac),
    mp3320: cleanHash(song?.hash320),
    mp3128: cleanHash(song?.hash),
  };

  const firstData = Array.isArray(privBody?.data) ? privBody.data[0] : privBody?.data;
  const transParam = firstData?.trans_param;
  if (transParam && typeof transParam === 'object') {
    const ogg320 = cleanHash(transParam.ogg_320_hash);
    const ogg128 = cleanHash(transParam.ogg_128_hash);
    if (ogg320) out.ogg320 = ogg320;
    if (ogg128) out.ogg128 = ogg128;
  }

  const goods = firstData?.relate_goods;
  if (Array.isArray(goods)) {
    for (const g of goods) {
      const h = cleanHash(g?.hash);
      if (!h) continue;
      const lvl = Number(g?.level ?? 0);
      const q = String(g?.quality || '').toLowerCase();
      if (!out.high && (lvl === 6 || q === 'high')) {
        out.high = h;
      } else if (!out.flac && (lvl === 5 || q === 'flac')) {
        out.flac = h;
      } else if (!out.mp3320 && (lvl === 4 || q === '320')) {
        out.mp3320 = h;
      } else if (!out.ogg128 && lvl === 1 && q === '128') {
        out.ogg128 = h;
      } else if (!out.mp3128 && (lvl === 2 || q === '128')) {
        out.mp3128 = h;
      }
    }
  }

  const qVipList = privBody?.quality_vip?.[0]?.qualities;
  if (Array.isArray(qVipList)) {
    for (const item of qVipList) {
      const h = cleanHash(item?.hash);
      if (!h || item?.exists === false) continue;
      const q = String(item?.quality || '').toLowerCase();
      const ext = String(item?.extname || '').toLowerCase();
      if (q === 'high' && !out.high) out.high = h;
      else if (q === 'flac' && !out.flac) out.flac = h;
      else if (q === '320') {
        if (ext === 'ogg' && !out.ogg320) out.ogg320 = h;
        else if (!out.mp3320) out.mp3320 = h;
      } else if (q === '128') {
        if (ext === 'ogg' && !out.ogg128) out.ogg128 = h;
        else if (!out.mp3128) out.mp3128 = h;
      }
    }
  }

  return out;
}

/**
 * Computes the honest stream quality tier & display badge directly from upstream response metadata
 * (`bitRate`, `extName`, resolved URL extension) instead of trusting the requested quality blindly.
 */
export function formatVerifiedQualityTag(
  body: any,
  fallbackQuality: AudioQuality,
  resolvedUrl = '',
): { quality: AudioQuality; sourceTag: string } {
  const firstItem = Array.isArray(body?.data) ? body.data[0] : null;
  const rawBitrate = Number(
    body?.bitRate ??
      body?.bitrate ??
      body?.data?.bitRate ??
      body?.data?.bitrate ??
      firstItem?.info?.bitrate ??
      0,
  );
  // Some KuGou responses report bps (e.g. 320000) instead of kbps (320)
  const bitRateKbps = rawBitrate > 10000 ? Math.round(rawBitrate / 1000) : Math.round(rawBitrate);

  let ext = String(
    body?.extName ??
      body?.extname ??
      body?.data?.extName ??
      body?.data?.extname ??
      firstItem?.info?.extname ??
      '',
  )
    .trim()
    .toLowerCase();

  if (!ext && resolvedUrl) {
    const m = /\.(flac|ogg|mp3|m4a|wav|aac)(?:\?|#|$)/i.exec(resolvedUrl);
    if (m) ext = m[1].toLowerCase();
  }

  if (bitRateKbps >= 1100 || (fallbackQuality === 'high' && (ext === 'flac' || bitRateKbps >= 950 || bitRateKbps === 0))) {
    if (bitRateKbps >= 1100 || fallbackQuality === 'high') {
      return { quality: 'high', sourceTag: 'Hi-Res' };
    }
  }
  if (ext === 'flac' || bitRateKbps >= 600) {
    return { quality: 'flac', sourceTag: '无损 FLAC' };
  }
  if (bitRateKbps >= 256 || (bitRateKbps === 0 && fallbackQuality === '320')) {
    return { quality: '320', sourceTag: ext === 'ogg' ? 'OGG 320k' : '高品 320k' };
  }
  if (bitRateKbps > 0 && bitRateKbps < 256) {
    return { quality: '128', sourceTag: ext === 'ogg' ? 'OGG 128k' : '标准 128k' };
  }

  switch (fallbackQuality) {
    case 'high':
      return { quality: 'high', sourceTag: 'Hi-Res' };
    case 'flac':
      return { quality: 'flac', sourceTag: '无损 FLAC' };
    case '320':
      return { quality: '320', sourceTag: ext === 'ogg' ? 'OGG 320k' : '高品 320k' };
    default:
      return { quality: '128', sourceTag: ext === 'ogg' ? 'OGG 128k' : '标准 128k' };
  }
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
  const normalizedBr = rawBitrate > 10000 ? rawBitrate / 1000 : rawBitrate;
  const bitrateKbps =
    normalizedBr >= 64 && normalizedBr <= 6400
      ? normalizedBr
      : quality === 'high'
        ? 1600
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
    new Set<AudioQuality>([preferredQuality, 'high', 'flac', '320', '128']),
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
    let hashes: ExtractedQualityHashes = {
      high: cleanHash(song.hashHigh),
      flac: cleanHash(song.hashFlac),
      mp3320: cleanHash(song.hash320),
      mp3128: cleanHash(song.hash),
    };

    try {
      const priv = await kugouApi.getSongPrivilegeLite(song.hash, song.albumId);
      hashes = extractQualityHashesFromPrivilege(priv?.body, song);
    } catch {
      // non-fatal
    }

    const attempts: Array<{ hash: string; quality: string; useNew?: boolean; label: AudioQuality }> = [];
    const seen = new Set<string>();
    const pushAttempt = (hash: string | undefined, quality: string, label: AudioQuality, useNew = false) => {
      if (!hash) return;
      const key = `${hash.toLowerCase()}|${quality}|${useNew ? 'new' : 'v5'}`;
      if (seen.has(key)) return;
      seen.add(key);
      attempts.push({ hash, quality, label, useNew });
    };

    // Each quality tier STRICTLY uses its own real hash (never mislabeling 128k as 320k/FLAC!)
    if (preferredQuality === 'high') {
      pushAttempt(hashes.high, 'high', 'high');
      pushAttempt(hashes.flac, 'flac', 'flac');
      pushAttempt(hashes.ogg320, '320', '320');
      pushAttempt(hashes.mp3320, '320', '320');
    } else if (preferredQuality === 'flac') {
      pushAttempt(hashes.flac, 'flac', 'flac');
      pushAttempt(hashes.ogg320, '320', '320');
      pushAttempt(hashes.mp3320, '320', '320');
    } else if (preferredQuality === '320') {
      pushAttempt(hashes.ogg320, '320', '320');
      pushAttempt(hashes.mp3320, '320', '320');
    }

    pushAttempt(hashes.ogg128, '128', '128');
    pushAttempt(hashes.mp3128 || song.hash, '128', '128');
    pushAttempt(song.hash, '', '128');

    // v6 priv_url fallback using the highest available real hash for the requested tier
    const bestNewHash =
      (preferredQuality === 'high' && (hashes.high || hashes.flac || hashes.ogg320 || hashes.mp3320)) ||
      (preferredQuality === 'flac' && (hashes.flac || hashes.ogg320 || hashes.mp3320)) ||
      (preferredQuality === '320' && (hashes.ogg320 || hashes.mp3320)) ||
      hashes.ogg128 ||
      hashes.mp3128 ||
      song.hash;
    pushAttempt(bestNewHash, preferredQuality, preferredQuality, true);

    const urlMetaOpts = { albumId: song.albumId, albumAudioId: song.mixSongId };

    for (const attempt of attempts) {
      try {
        const res = attempt.useNew
          ? await kugouApi.getSongUrlNew(attempt.hash, attempt.quality, { albumAudioId: song.mixSongId })
          : await kugouApi.getSongUrl(attempt.hash, attempt.quality, urlMetaOpts);
        const urls = extractUrlsFromPayload(res?.body);
        if (urls.length === 0) continue;

        const verified = formatVerifiedQualityTag(res?.body, attempt.label, urls[0]);
        const trial = isTrialSnippet(res?.body, song.duration, verified.quality);
        const candidate: ResolvedStream = {
          url: urls[0],
          quality: verified.quality,
          sourceTag: verified.sourceTag,
          isUnblocked: false,
          cacheKey: trial ? undefined : buildAudioCacheKey(song, verified.quality, verified.sourceTag, false),
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
