import type { AudioQuality, PinnedSource, Song, UnblockCandidate } from '@/types/music';
import { nativeHttpRequest } from '@/native/echoHttp';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { echoSystem } from '@/native/echoSystem';

const UNWANTED_VARIANT_RE = /(伴奏|卡拉ok|karaoke|instrumental|off\s*vocal|纯音乐版|dj版|dj\s*remix|慢摇|喊麦)/i;
const PINNED_STORAGE_KEY = 'unblock.pinned.v1';
const PINNED_TTL_MS = 20 * 60 * 1000;

export function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\b(feat\.?|ft\.?|live|ver\.?|version|remaster(?:ed)?)\b/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function getTrackKey(song: Pick<Song, 'hash' | 'id' | 'title' | 'artist'>): string {
  if (song.hash) return `hash:${song.hash.toLowerCase()}`;
  if (song.id) return `id:${song.id}`;
  return `meta:${normalizeText(song.artist)}:${normalizeText(song.title)}`;
}

export function scoreCandidate(
  target: { title: string; artist: string; duration: number },
  cand: { title: string; artist: string; duration: number },
): number {
  const a = normalizeText(target.title);
  const b = normalizeText(cand.title);
  if (!a || !b) return 0;

  let titleScore = 0;
  if (!UNWANTED_VARIANT_RE.test(target.title) && UNWANTED_VARIANT_RE.test(cand.title)) {
    titleScore = 0.15;
  } else if (a === b) {
    titleScore = 1;
  } else if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    titleScore = ratio >= 0.6 ? 0.88 : 0.72;
  } else {
    const setA = new Set(a);
    const setB = new Set(b);
    let inter = 0;
    for (const ch of setA) if (setB.has(ch)) inter += 1;
    const union = setA.size + setB.size - inter;
    titleScore = union > 0 ? inter / union : 0;
  }
  if (titleScore < 0.45) return 0;

  // Artist similarity
  let artistScore = 0;
  const artA = normalizeText(target.artist);
  const artB = normalizeText(cand.artist);
  if (!artA) artistScore = 0.6;
  else if (!artB) artistScore = 0.2;
  else if (artA === artB) artistScore = 1;
  else {
    const partsA = target.artist.split(/[/、&,，;；\s]+/).map(normalizeText).filter(Boolean);
    const partsB = cand.artist.split(/[/、&,，;；\s]+/).map(normalizeText).filter(Boolean);
    for (const pa of partsA) {
      if (partsB.some((pb) => pa === pb || pa.includes(pb) || pb.includes(pa))) {
        artistScore = 0.92;
        break;
      }
    }
  }

  // Duration similarity
  let durScore = 0.65;
  if (target.duration > 0 && cand.duration > 0) {
    const diff = Math.abs(target.duration - cand.duration);
    if (diff <= 3) durScore = 1;
    else if (diff <= 8) durScore = 0.82;
    else if (diff <= 15) durScore = 0.55;
    else if (diff <= 30) durScore = 0.25;
    else durScore = 0;
  }

  return Number((titleScore * 0.55 + artistScore * 0.3 + durScore * 0.15).toFixed(3));
}

export function extractUrlsFromPayload(payload: unknown): string[] {
  const urls: string[] = [];
  const visit = (val: unknown) => {
    if (!val) return;
    if (typeof val === 'string') {
      const t = val.trim();
      if (/^https?:\/\//i.test(t) && !urls.includes(t)) urls.push(t);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(visit);
      return;
    }
    if (typeof val === 'object') {
      const o = val as Record<string, unknown>;
      visit(o.url);
      visit(o.play_url);
      visit(o.playUrl);
      visit(o.backupUrl);
      visit(o.backup_url);
      visit(o.backupUrls);
      if (o.data) visit(o.data);
      if (o.info) visit(o.info);
    }
  };
  visit(payload);
  return urls;
}

async function fetchJsonZeroCors(url: string, headers: Record<string, string> = {}, timeoutMs = 6500): Promise<any> {
  try {
    const res = await nativeHttpRequest({
      method: 'GET',
      url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
        Accept: 'application/json, text/plain, */*',
        ...headers,
      },
      readTimeoutMs: timeoutMs,
      connectTimeoutMs: 5000,
    });
    if (res.status >= 200 && res.status < 400 && res.body) {
      return JSON.parse(res.body);
    }
  } catch {
    // non-fatal
  }
  return null;
}

let pinnedMap: Record<string, PinnedSource> | null = null;

async function ensurePinnedLoaded(): Promise<Record<string, PinnedSource>> {
  if (!pinnedMap) {
    pinnedMap = await echoSystem.kvGetJson<Record<string, PinnedSource>>(PINNED_STORAGE_KEY, {});
  }
  return pinnedMap;
}

export async function getPinnedSource(song: Song): Promise<PinnedSource | null> {
  const map = await ensurePinnedLoaded();
  return map[getTrackKey(song)] || null;
}

export async function pinSourceForSong(song: Song, candidate: UnblockCandidate, resolvedUrl: string): Promise<void> {
  const map = await ensurePinnedLoaded();
  const key = getTrackKey(song);
  map[key] = {
    trackKey: key,
    channel: candidate.channel,
    provider: candidate.provider,
    sourcePlatform: candidate.sourcePlatform,
    externalId: candidate.externalId,
    hash: candidate.hash,
    fallbackHashes: candidate.fallbackHashes,
    title: candidate.title,
    artist: candidate.artist,
    quality: candidate.quality,
    url: resolvedUrl,
    urlCachedAt: Date.now(),
  };
  await echoSystem.kvSetJson(PINNED_STORAGE_KEY, map);
}

export async function unpinSourceForSong(song: Song): Promise<void> {
  const map = await ensurePinnedLoaded();
  const key = getTrackKey(song);
  if (key in map) {
    delete map[key];
    await echoSystem.kvSetJson(PINNED_STORAGE_KEY, map);
  }
}

export async function findKugouAltCandidates(song: Song, quality: AudioQuality = '320'): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  try {
    const { songs } = await kugouApi.searchSongs(kw, 1, 14);
    const currentHash = song.hash.toLowerCase();
    const out: UnblockCandidate[] = [];
    for (const item of songs) {
      const primaryHash =
        (quality === 'flac' && item.hashFlac) ||
        (quality !== '128' && item.hash320) ||
        item.hash;
      if (!primaryHash || primaryHash.toLowerCase() === currentHash) continue;
      const score = scoreCandidate(song, item);
      if (score < 0.65) continue;
      out.push({
        id: `kugou-alt:${primaryHash}`,
        channel: 'kugou-alt',
        channelLabel: '酷狗同曲异版',
        hash: primaryHash,
        fallbackHashes: [item.hashFlac, item.hash320, item.hash].filter(Boolean) as string[],
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration: item.duration,
        quality: primaryHash === item.hashFlac ? 'flac' : primaryHash === item.hash320 ? '320' : '128',
        score,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  } catch {
    return [];
  }
}

export async function findExternalCandidates(
  song: Song,
  quality: AudioQuality = '320',
  platforms: string[] = ['netease', 'kuwo', 'tencent'],
): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  const results: UnblockCandidate[] = [];

  // 1. GDStudio multi-platform aggregator
  for (let idx = 0; idx < Math.min(platforms.length, 3); idx += 1) {
    const source = platforms[idx];
    const url = `https://music-api.gdstudio.xyz/api.php?types=search&source=${encodeURIComponent(source)}&name=${encodeURIComponent(kw)}&count=6&pages=1`;
    const list = await fetchJsonZeroCors(url);
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const candTitle = String(item?.name ?? item?.title ?? '').trim();
      const candArtist = Array.isArray(item?.artist) ? item.artist.join(' / ') : String(item?.artist ?? '').trim();
      const trackId = String(item?.id ?? item?.url_id ?? '').trim();
      if (!trackId || !candTitle) continue;
      const rawDur = Number(item?.duration ?? 0);
      const candDur = rawDur > 10000 ? Math.round(rawDur / 1000) : Math.round(rawDur);
      const score = scoreCandidate(song, { title: candTitle, artist: candArtist, duration: candDur });
      if (score < 0.65) continue;
      const boost = Math.max(0, (2 - idx) * 0.015);
      results.push({
        id: `external:gdstudio:${source}:${trackId}`,
        channel: 'external',
        channelLabel: `多平台音源 (${source.toUpperCase()})`,
        provider: 'gdstudio',
        sourcePlatform: source,
        externalId: trackId,
        lyricId: String(item?.lyric_id ?? trackId),
        title: candTitle,
        artist: candArtist,
        album: String(item?.album ?? ''),
        duration: candDur,
        quality: quality === 'flac' ? 'flac' : '320',
        score: Math.min(1, Number((score + boost).toFixed(3))),
      });
    }
  }

  // 2. NetEase direct search fallback
  if (results.length === 0 || platforms.includes('netease')) {
    const neUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(kw)}&type=1&offset=0&total=true&limit=5`;
    const neRes = await fetchJsonZeroCors(neUrl, { Referer: 'https://music.163.com/' });
    const songs = neRes?.result?.songs;
    if (Array.isArray(songs)) {
      for (const item of songs) {
        const candTitle = String(item?.name ?? '').trim();
        const candArtist = Array.isArray(item?.artists)
          ? item.artists.map((a: any) => a?.name).filter(Boolean).join(' / ')
          : '';
        const candDur = item?.duration ? Math.round(Number(item.duration) / 1000) : 0;
        const songId = String(item?.id ?? '').trim();
        if (!songId || !candTitle) continue;
        const score = scoreCandidate(song, { title: candTitle, artist: candArtist, duration: candDur });
        if (score < 0.66) continue;
        results.push({
          id: `external:netease:${songId}`,
          channel: 'external',
          channelLabel: '外部音源 (NETEASE)',
          provider: 'netease-direct',
          sourcePlatform: 'netease',
          externalId: songId,
          lyricId: songId,
          title: candTitle,
          artist: candArtist,
          album: String(item?.album?.name ?? ''),
          duration: candDur,
          quality: '320',
          score,
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}

export async function resolveCandidateUrl(
  cand: UnblockCandidate,
  quality: AudioQuality = '320',
): Promise<{ url: string; quality: AudioQuality } | null> {
  if (cand.url && /^https?:\/\//i.test(cand.url)) {
    return { url: cand.url, quality: cand.quality };
  }

  if (cand.channel === 'kugou-alt') {
    const hashes = Array.from(new Set([cand.hash, ...(cand.fallbackHashes || [])].filter(Boolean) as string[]));
    const qualities = quality === 'flac' ? ['flac', '320', '128', ''] : ['320', '128', ''];
    for (const h of hashes) {
      for (const q of qualities) {
        try {
          const res = await kugouApi.getSongUrl(h, q);
          const urls = extractUrlsFromPayload(res?.body);
          if (urls.length > 0) {
            return { url: urls[0], quality: (q || cand.quality || '128') as AudioQuality };
          }
        } catch {
          // try next
        }
      }
    }
    return null;
  }

  if (cand.provider === 'gdstudio' && cand.externalId) {
    const br = quality === 'flac' ? '999' : '320';
    const urlApi = `https://music-api.gdstudio.xyz/api.php?types=url&source=${encodeURIComponent(cand.sourcePlatform || 'netease')}&id=${encodeURIComponent(cand.externalId)}&br=${br}`;
    const data = await fetchJsonZeroCors(urlApi, {}, 7500);
    const resolvedUrl = String(data?.url || '').trim();
    if (/^https?:\/\//i.test(resolvedUrl)) {
      return { url: resolvedUrl, quality: Number(data?.br) >= 700 ? 'flac' : '320' };
    }
  }

  if (cand.sourcePlatform === 'netease' && cand.externalId) {
    try {
      const metingUrl = `https://api.i-meto.com/meting/api?server=netease&type=url&id=${encodeURIComponent(cand.externalId)}`;
      const res = await nativeHttpRequest({
        method: 'GET',
        url: metingUrl,
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36' },
        followRedirects: true,
        readTimeoutMs: 7000,
      });
      const finalUrl = String(res.url || '').trim();
      if (/^https?:\/\//i.test(finalUrl) && !finalUrl.includes('api.i-meto.com') && !finalUrl.endsWith('/404')) {
        return { url: finalUrl, quality: '320' };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function scanAllUnblockCandidates(
  song: Song,
  quality: AudioQuality = '320',
  platforms: string[] = ['netease', 'kuwo', 'tencent'],
): Promise<UnblockCandidate[]> {
  const [kg, ext] = await Promise.all([
    findKugouAltCandidates(song, quality),
    findExternalCandidates(song, quality, platforms),
  ]);
  return [...kg, ...ext];
}

export async function resolveUnblockedUrl(
  song: Song,
  quality: AudioQuality = '320',
  platforms: string[] = ['netease', 'kuwo', 'tencent'],
): Promise<{ url: string; quality: AudioQuality; sourceTag: string } | null> {
  // 1. Check pinned source first
  const pinned = await getPinnedSource(song);
  if (pinned) {
    const expired = !pinned.url || Date.now() - pinned.urlCachedAt > PINNED_TTL_MS;
    if (!expired && pinned.url) {
      return {
        url: pinned.url,
        quality: pinned.quality,
        sourceTag: pinned.channel === 'kugou-alt' ? '酷狗异版' : `解灰 · ${(pinned.sourcePlatform || 'EXT').toUpperCase()}`,
      };
    }
    const refreshed = await resolveCandidateUrl(
      {
        id: pinned.trackKey,
        channel: pinned.channel,
        channelLabel: '',
        provider: pinned.provider,
        sourcePlatform: pinned.sourcePlatform,
        externalId: pinned.externalId,
        hash: pinned.hash,
        fallbackHashes: pinned.fallbackHashes,
        title: pinned.title,
        artist: pinned.artist,
        album: '',
        duration: song.duration,
        quality: pinned.quality,
        score: 1,
      },
      quality,
    );
    if (refreshed?.url) {
      const map = await ensurePinnedLoaded();
      map[pinned.trackKey] = { ...pinned, url: refreshed.url, urlCachedAt: Date.now() };
      void echoSystem.kvSetJson(PINNED_STORAGE_KEY, map);
      return {
        url: refreshed.url,
        quality: refreshed.quality,
        sourceTag: pinned.channel === 'kugou-alt' ? '酷狗异版' : `解灰 · ${(pinned.sourcePlatform || 'EXT').toUpperCase()}`,
      };
    }
  }

  // 2. Auto waterfall: Kugou alt -> External aggregators
  const candidates = await scanAllUnblockCandidates(song, quality, platforms);
  for (const cand of candidates.slice(0, 5)) {
    const resolved = await resolveCandidateUrl(cand, quality);
    if (resolved?.url) {
      return {
        url: resolved.url,
        quality: resolved.quality,
        sourceTag: cand.channel === 'kugou-alt' ? '酷狗异版' : `解灰 · ${(cand.sourcePlatform || 'EXT').toUpperCase()}`,
      };
    }
  }

  return null;
}
