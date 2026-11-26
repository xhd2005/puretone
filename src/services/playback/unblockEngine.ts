import type { AudioQuality, PinnedSource, Song, UnblockCandidate } from '@/types/music';
import { nativeHttpRequest } from '@/native/echoHttp';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { echoSystem } from '@/native/echoSystem';

const UNWANTED_VARIANT_RE = /(伴奏|卡拉ok|karaoke|instrumental|off\s*vocal|纯音乐版|dj版|dj\s*remix|慢摇|喊麦|翻唱|cover)/i;
const PINNED_STORAGE_KEY = 'unblock.pinned.v2';
const PINNED_TTL_MS = 20 * 60 * 1000;
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

export function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\b(feat\.?|ft\.?|live|ver\.?|version|remaster(?:ed)?|hi-?res|flac|无损|音质|原唱)\b/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function parseDurationLabel(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 10000 ? Math.round(raw / 1000) : Math.round(raw);
  }
  const str = String(raw || '').trim();
  if (!str) return 0;
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return n > 10000 ? Math.round(n / 1000) : n;
  }
  const parts = str.split(':').map((p) => Number(p));
  if (parts.every((n) => Number.isFinite(n))) {
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
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
    titleScore = 0.12;
  } else if (a === b) {
    titleScore = 1;
  } else if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    titleScore = ratio >= 0.55 ? 0.9 : 0.74;
  } else {
    const setA = new Set(a);
    const setB = new Set(b);
    let inter = 0;
    for (const ch of setA) if (setB.has(ch)) inter += 1;
    const union = setA.size + setB.size - inter;
    titleScore = union > 0 ? inter / union : 0;
  }
  if (titleScore < 0.45) return 0;

  let artistScore = 0;
  const artA = normalizeText(target.artist);
  const artB = normalizeText(cand.artist);
  const combinedCand = `${artB} ${b}`;
  if (!artA) artistScore = 0.6;
  else if (!artB) artistScore = combinedCand.includes(artA) ? 0.78 : 0.2;
  else if (artA === artB) artistScore = 1;
  else {
    const partsA = target.artist.split(/[/、&,，;；\s]+/).map(normalizeText).filter(Boolean);
    const partsB = cand.artist.split(/[/、&,，;；\s]+/).map(normalizeText).filter(Boolean);
    for (const pa of partsA) {
      if (
        partsB.some((pb) => pa === pb || pa.includes(pb) || pb.includes(pa)) ||
        combinedCand.includes(pa)
      ) {
        artistScore = 0.92;
        break;
      }
    }
  }

  let durScore = 0.65;
  if (target.duration > 0 && cand.duration > 0) {
    const diff = Math.abs(target.duration - cand.duration);
    if (diff <= 3) durScore = 1;
    else if (diff <= 8) durScore = 0.84;
    else if (diff <= 15) durScore = 0.58;
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

/**
 * Safely parse Kuwo search response (`search.kuwo.cn/r.s`) which returns single-quoted JSON.
 */
export function parseKuwoSearchPayload(rawText: string): Array<{
  rid: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}> {
  if (!rawText) return [];
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    try {
      // Convert single-quoted keys/strings carefully while escaping double quotes inside
      const normalized = rawText
        .replace(/\\'/g, '\u0001')
        .replace(/"/g, '\\"')
        .replace(/'/g, '"')
        .replace(/\u0001/g, "'");
      parsed = JSON.parse(normalized);
    } catch {
      parsed = null;
    }
  }

  const abslist = Array.isArray(parsed?.abslist) ? parsed.abslist : [];
  if (abslist.length > 0) {
    return abslist
      .map((item: any) => {
        const ridRaw = String(item?.MUSICRID ?? item?.DC_TARGETID ?? '');
        const rid = ridRaw.replace(/^MUSIC_/i, '').trim();
        return {
          rid,
          title: decodeHtmlEntities(item?.SONGNAME ?? item?.NAME ?? ''),
          artist: decodeHtmlEntities(item?.ARTIST ?? ''),
          album: decodeHtmlEntities(item?.ALBUM ?? ''),
          duration: parseDurationLabel(item?.DURATION ?? 0),
        };
      })
      .filter((x: any) => Boolean(x.rid && x.title));
  }

  // Regex fallback if malformed escapes break JSON.parse
  const out: Array<{ rid: string; title: string; artist: string; album: string; duration: number }> = [];
  const blockRe = /'MUSICRID'\s*:\s*'MUSIC_(\d+)'[\s\S]*?'SONGNAME'\s*:\s*'([^']*)'[\s\S]*?'ARTIST'\s*:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(rawText)) !== null && out.length < 8) {
    out.push({
      rid: m[1],
      title: decodeHtmlEntities(m[2]),
      artist: decodeHtmlEntities(m[3]),
      album: '',
      duration: 0,
    });
  }
  return out;
}

async function fetchTextZeroCors(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500,
): Promise<{ status: number; body: string; headers: Record<string, string>; url: string } | null> {
  try {
    const res = await nativeHttpRequest({
      method: 'GET',
      url,
      headers: {
        'User-Agent': MOBILE_UA,
        Accept: 'application/json, text/plain, */*',
        ...headers,
      },
      readTimeoutMs: timeoutMs,
      connectTimeoutMs: 4200,
    });
    if (res.status >= 200 && res.status < 400) {
      return { status: res.status, body: res.body || '', headers: res.headers || {}, url: res.url || url };
    }
  } catch {
    // non-fatal
  }
  return null;
}

async function fetchJsonZeroCors(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500,
): Promise<any> {
  const res = await fetchTextZeroCors(url, headers, timeoutMs);
  if (!res?.body) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/**
 * Fast stream reachability verification via HTTP Range: bytes=0-1 (2.5s timeout).
 * Ensures dead CDN links / 403 / HTML error pages are rejected BEFORE hitting ExoPlayer.
 */
export async function verifyStreamReachable(
  url: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const res = await nativeHttpRequest({
      method: 'GET',
      url,
      headers: {
        'User-Agent': MOBILE_UA,
        Range: 'bytes=0-1',
        ...headers,
      },
      responseType: 'base64',
      connectTimeoutMs: 2500,
      readTimeoutMs: 2800,
      followRedirects: true,
    });
    if (res.status !== 200 && res.status !== 206) return false;
    const ct = String(res.headers?.['content-type'] || '').toLowerCase();
    if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---- Pinned source persistence ----

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

export async function pinSourceForSong(
  song: Song,
  candidate: UnblockCandidate,
  resolvedUrl: string,
  headers?: Record<string, string>,
): Promise<void> {
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
    headers: headers || candidate.headers,
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

// ---- Channel 1: Direct Kuwo 320k MP3 (Primary, live-verified) ----

export async function findKuwoDirectCandidates(song: Song): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  const url = `https://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}&ft=music&rformat=json&encoding=utf8&rn=6&pn=0&vipver=1`;
  const res = await fetchTextZeroCors(url, {}, 5000);
  if (!res?.body) return [];

  const parsed = parseKuwoSearchPayload(res.body);
  const out: UnblockCandidate[] = [];
  for (const item of parsed) {
    const score = scoreCandidate(song, item);
    if (score < 0.62) continue;
    out.push({
      id: `external:kuwo-direct:${item.rid}`,
      channel: 'external',
      channelLabel: '酷我直连 320k',
      provider: 'kuwo-direct',
      sourcePlatform: 'kuwo',
      externalId: item.rid,
      title: item.title,
      artist: item.artist,
      album: item.album,
      duration: item.duration,
      quality: '320',
      score: Math.min(1, Number((score + 0.03).toFixed(3))),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
}

async function resolveKuwoDirectUrl(
  rid: string,
  expectedDurationSec: number,
  preferredQuality: AudioQuality,
): Promise<{ url: string; quality: AudioQuality } | null> {
  const bitrates = preferredQuality === '128' ? ['128kmp3'] : ['320kmp3', '128kmp3'];
  for (const br of bitrates) {
    const ep = `https://mobi.kuwo.cn/mobi.s?f=web&user=0&source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk&type=convert_url_with_sign&rid=${encodeURIComponent(rid)}&br=${br}`;
    const data = await fetchJsonZeroCors(ep, { 'User-Agent': 'okhttp/3.10.0' }, 5000);
    const url = String(data?.data?.url || '').trim();
    const dur = Number(data?.data?.duration || 0);
    if (!/^https?:\/\//i.test(url)) continue;
    // Skip short trial snippets (<35s when target song > 75s)
    if (expectedDurationSec >= 75 && dur > 0 && dur < 35) continue;
    return {
      url,
      quality: Number(data?.data?.bitrate) >= 256 || br.startsWith('320') ? '320' : '128',
    };
  }
  return null;
}

// ---- Channel 2: KuGou Same-Song Alt ----

export async function findKugouAltCandidates(song: Song, quality: AudioQuality = '320'): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  try {
    const { songs } = await kugouApi.searchSongs(kw, 1, 14);
    const currentHash = song.hash.toLowerCase();
    const out: UnblockCandidate[] = [];
    for (const item of songs) {
      if (item.isGray) continue;
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
        score: Math.min(1, Number((score + 0.02).toFixed(3))),
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 4);
  } catch {
    return [];
  }
}

// ---- Channel 3: GDStudio JOOX 320k (Live-verified original tracks) ----

export async function findJooxCandidates(song: Song): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  const url = `https://music-api.gdstudio.xyz/api.php?types=search&source=joox&name=${encodeURIComponent(kw)}&count=5&pages=1`;
  const list = await fetchJsonZeroCors(url, {}, 6000);
  if (!Array.isArray(list)) return [];

  const out: UnblockCandidate[] = [];
  for (const item of list) {
    const candTitle = String(item?.name ?? item?.title ?? '').trim();
    const candArtist = Array.isArray(item?.artist) ? item.artist.join(' / ') : String(item?.artist ?? '').trim();
    const trackId = String(item?.url_id ?? item?.id ?? '').trim();
    if (!trackId || !candTitle) continue;
    const candDur = parseDurationLabel(item?.duration ?? 0);
    const score = scoreCandidate(song, { title: candTitle, artist: candArtist, duration: candDur });
    if (score < 0.62) continue;
    out.push({
      id: `external:joox:${trackId}`,
      channel: 'external',
      channelLabel: 'JOOX 320k',
      provider: 'gdstudio-joox',
      sourcePlatform: 'joox',
      externalId: trackId,
      lyricId: String(item?.lyric_id ?? trackId),
      title: candTitle,
      artist: candArtist,
      album: String(item?.album ?? ''),
      duration: candDur,
      quality: '320',
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ---- Channel 4: Bilibili DASH Audio-Only Stream (Fallback, live-verified) ----

let cachedBiliCookie = '';
let cachedBiliAt = 0;

async function getBilibiliCookie(): Promise<string> {
  if (cachedBiliCookie && Date.now() - cachedBiliAt < 60 * 60 * 1000) {
    return cachedBiliCookie;
  }
  const spi = await fetchJsonZeroCors('https://api.bilibili.com/x/frontend/finger/spi', {}, 4000);
  if (spi?.data?.b_3) {
    cachedBiliCookie = `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4 || ''}`;
    cachedBiliAt = Date.now();
    return cachedBiliCookie;
  }
  return '';
}

export async function findBilibiliAudioCandidates(song: Song): Promise<UnblockCandidate[]> {
  const kw = `${song.title} ${song.artist}`.trim();
  if (!kw) return [];
  const cookie = await getBilibiliCookie();
  const headers: Record<string, string> = {
    Referer: 'https://www.bilibili.com/',
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const sr = await fetchJsonZeroCors(
    `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page_size=5`,
    headers,
    5500,
  );
  const list = sr?.data?.result;
  if (!Array.isArray(list)) return [];

  const out: UnblockCandidate[] = [];
  for (const item of list) {
    const bvid = String(item?.bvid || '').trim();
    const rawTitle = decodeHtmlEntities(item?.title || '');
    const dur = parseDurationLabel(item?.duration);
    if (!bvid || !rawTitle) continue;
    // Skip super-long compilations or super-short clips
    if (dur > 0 && (dur < 45 || dur > 900)) continue;
    const score = scoreCandidate(song, {
      title: rawTitle,
      artist: String(item?.author || ''),
      duration: dur,
    });
    if (score < 0.56) continue;
    out.push({
      id: `external:bilibili:${bvid}`,
      channel: 'external',
      channelLabel: 'B站纯音频',
      provider: 'bilibili-dash',
      sourcePlatform: 'bilibili',
      externalId: bvid,
      title: rawTitle,
      artist: String(item?.author || song.artist),
      album: 'Bilibili 音频流',
      duration: dur,
      quality: '320',
      score: Number((score - 0.04).toFixed(3)),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function resolveBilibiliDashAudio(
  bvid: string,
): Promise<{ url: string; quality: AudioQuality; headers: Record<string, string> } | null> {
  const cookie = await getBilibiliCookie();
  const reqHeaders: Record<string, string> = {
    Referer: 'https://www.bilibili.com/',
    'User-Agent': MOBILE_UA,
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const view = await fetchJsonZeroCors(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    reqHeaders,
    4500,
  );
  const cid = view?.data?.cid;
  if (!cid) return null;

  const play = await fetchJsonZeroCors(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16`,
    reqHeaders,
    5000,
  );
  const audios: any[] = play?.data?.dash?.audio || [];
  if (!audios.length) return null;

  // Pick highest bandwidth audio track
  const sorted = [...audios].sort((a, b) => Number(b?.bandwidth || 0) - Number(a?.bandwidth || 0));
  const best = sorted[0];
  const url = String(best?.baseUrl || best?.base_url || best?.backupUrl?.[0] || '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    url,
    quality: Number(best?.bandwidth || 0) >= 180000 ? '320' : '128',
    headers: {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': MOBILE_UA,
    },
  };
}

// ---- Unified Resolver & 4-Channel Parallel Orchestrator ----

export async function resolveCandidateUrl(
  cand: UnblockCandidate,
  quality: AudioQuality = '320',
  expectedDurationSec = 0,
): Promise<{ url: string; quality: AudioQuality; headers?: Record<string, string> } | null> {
  if (cand.url && /^https?:\/\//i.test(cand.url)) {
    return { url: cand.url, quality: cand.quality, headers: cand.headers };
  }

  if (cand.channel === 'kugou-alt') {
    const hashes = Array.from(new Set([cand.hash, ...(cand.fallbackHashes || [])].filter(Boolean) as string[]));
    const qualities = quality === 'flac' ? ['flac', '320', '128', ''] : ['320', '128', ''];
    for (const h of hashes) {
      for (const q of qualities) {
        try {
          const res = await kugouApi.getSongUrl(h, q);
          const urls = extractUrlsFromPayload(res?.body);
          if (urls.length > 0 && !res?.body?.free_part && !res?.body?.is_try_listen) {
            return { url: urls[0], quality: (q || cand.quality || '128') as AudioQuality };
          }
        } catch {
          // try next
        }
      }
    }
    return null;
  }

  if (cand.provider === 'kuwo-direct' && cand.externalId) {
    return resolveKuwoDirectUrl(cand.externalId, expectedDurationSec || cand.duration, quality);
  }

  if ((cand.provider === 'gdstudio-joox' || cand.provider === 'gdstudio') && cand.externalId) {
    const br = quality === 'flac' ? '999' : '320';
    const src = cand.sourcePlatform || 'joox';
    const urlApi = `https://music-api.gdstudio.xyz/api.php?types=url&source=${encodeURIComponent(src)}&id=${encodeURIComponent(cand.externalId)}&br=${br}`;
    const data = await fetchJsonZeroCors(urlApi, {}, 6500);
    const resolvedUrl = String(data?.url || '').trim();
    if (/^https?:\/\//i.test(resolvedUrl)) {
      return { url: resolvedUrl, quality: Number(data?.br) >= 700 ? 'flac' : '320' };
    }
  }

  if (cand.provider === 'bilibili-dash' && cand.externalId) {
    return resolveBilibiliDashAudio(cand.externalId);
  }

  return null;
}

export async function scanAllUnblockCandidates(
  song: Song,
  quality: AudioQuality = '320',
): Promise<UnblockCandidate[]> {
  const [kuwo, kg, joox, bili] = await Promise.allSettled([
    findKuwoDirectCandidates(song),
    findKugouAltCandidates(song, quality),
    findJooxCandidates(song),
    findBilibiliAudioCandidates(song),
  ]);

  const merged: UnblockCandidate[] = [
    ...(kuwo.status === 'fulfilled' ? kuwo.value : []),
    ...(kg.status === 'fulfilled' ? kg.value : []),
    ...(joox.status === 'fulfilled' ? joox.value : []),
    ...(bili.status === 'fulfilled' ? bili.value : []),
  ];

  return merged.sort((a, b) => b.score - a.score).slice(0, 12);
}

function formatSourceTag(cand: Pick<UnblockCandidate, 'channel' | 'provider' | 'sourcePlatform'>): string {
  if (cand.channel === 'kugou-alt') return '酷狗异版';
  if (cand.provider === 'kuwo-direct' || cand.sourcePlatform === 'kuwo') return '解灰 · 酷我 320k';
  if (cand.provider === 'gdstudio-joox' || cand.sourcePlatform === 'joox') return '解灰 · JOOX';
  if (cand.provider === 'bilibili-dash' || cand.sourcePlatform === 'bilibili') return '解灰 · B站音频';
  return `解灰 · ${(cand.sourcePlatform || 'EXT').toUpperCase()}`;
}

async function resolveAndVerify(
  cand: UnblockCandidate,
  quality: AudioQuality,
  expectedDuration: number,
  skipProbe = false,
): Promise<{ url: string; quality: AudioQuality; sourceTag: string; headers?: Record<string, string> } | null> {
  const resolved = await resolveCandidateUrl(cand, quality, expectedDuration);
  if (!resolved?.url) return null;
  if (!skipProbe) {
    const ok = await verifyStreamReachable(resolved.url, resolved.headers);
    if (!ok) return null;
  }
  return {
    url: resolved.url,
    quality: resolved.quality,
    sourceTag: formatSourceTag(cand),
    headers: resolved.headers,
  };
}

export async function resolveUnblockedUrl(
  song: Song,
  quality: AudioQuality = '320',
): Promise<{ url: string; quality: AudioQuality; sourceTag: string; headers?: Record<string, string> } | null> {
  // 1. Pinned source takes highest priority
  const pinned = await getPinnedSource(song);
  if (pinned) {
    const expired = !pinned.url || Date.now() - pinned.urlCachedAt > PINNED_TTL_MS;
    if (!expired && pinned.url) {
      return {
        url: pinned.url,
        quality: pinned.quality,
        sourceTag: formatSourceTag(pinned),
        headers: pinned.headers,
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
      song.duration,
    );
    if (refreshed?.url) {
      const map = await ensurePinnedLoaded();
      map[pinned.trackKey] = {
        ...pinned,
        url: refreshed.url,
        headers: refreshed.headers,
        urlCachedAt: Date.now(),
      };
      void echoSystem.kvSetJson(PINNED_STORAGE_KEY, map);
      return {
        url: refreshed.url,
        quality: refreshed.quality,
        sourceTag: formatSourceTag(pinned),
        headers: refreshed.headers,
      };
    }
  }

  // 2. Fast-path: Kuwo direct 320k & KuGou alt in parallel (fastest & cleanest original tracks!)
  const [kuwoList, kgList] = await Promise.all([
    findKuwoDirectCandidates(song).catch(() => []),
    findKugouAltCandidates(song, quality).catch(() => []),
  ]);

  for (const cand of [...kuwoList.slice(0, 2), ...kgList.slice(0, 2)]) {
    const verified = await resolveAndVerify(cand, quality, song.duration);
    if (verified) return verified;
  }

  // 3. Fallback parallel wave: JOOX 320k & Bilibili DASH audio
  const [jooxList, biliList] = await Promise.all([
    findJooxCandidates(song).catch(() => []),
    findBilibiliAudioCandidates(song).catch(() => []),
  ]);

  for (const cand of [...jooxList.slice(0, 2), ...biliList.slice(0, 2)]) {
    const verified = await resolveAndVerify(cand, quality, song.duration);
    if (verified) return verified;
  }

  return null;
}
