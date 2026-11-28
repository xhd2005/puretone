import pako from 'pako';
import { Buffer } from 'buffer';
import type { LyricLine, LyricWord, ParsedLyrics, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { nativeHttpRequest } from '@/native/echoHttp';
import { pluginRuntime } from '@/services/plugins/pluginRuntime';

// Standard KuGou KRC XOR decryption key (16 bytes)
const KRC_XOR_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

/**
 * Decode Base64-encoded encrypted KuGou KRC payload -> UTF-8 KRC text
 */
export function decodeKrcBase64(base64Content: string): string {
  const raw = Buffer.from(base64Content.trim(), 'base64');
  // KRC starts with 4-byte magic header "krc1"
  if (raw.length < 5) return raw.toString('utf8');
  const isMagic = raw[0] === 0x6b && raw[1] === 0x72 && raw[2] === 0x63 && raw[3] === 0x31;
  if (!isMagic) {
    // Already plain text / LRC encoded in base64
    return raw.toString('utf8');
  }
  const decrypted = new Uint8Array(raw.length - 4);
  for (let i = 0; i < decrypted.length; i += 1) {
    decrypted[i] = raw[i + 4] ^ KRC_XOR_KEY[i % KRC_XOR_KEY.length];
  }
  const inflated = pako.inflate(decrypted);
  return Buffer.from(inflated).toString('utf8').replace(/^\uFEFF/, '');
}

interface KrcLanguageTrack {
  type: number; // 0 = romanization/transliteration, 1 = translation
  lyricContent: string[][];
}

function parseKrcLanguageHeader(krcText: string): { translations: string[]; romanizations: string[] } {
  const m = /\[language:([A-Za-z0-9+/=]+)\]/i.exec(krcText);
  if (!m) return { translations: [], romanizations: [] };
  try {
    const jsonStr = Buffer.from(m[1], 'base64').toString('utf8');
    const parsed = JSON.parse(jsonStr) as { content?: KrcLanguageTrack[] };
    const tracks = Array.isArray(parsed?.content) ? parsed.content : [];
    const translations: string[] = [];
    const romanizations: string[] = [];
    for (const track of tracks) {
      if (!Array.isArray(track?.lyricContent)) continue;
      if (track.type === 1) {
        for (const row of track.lyricContent) {
          translations.push(Array.isArray(row) ? row.join('').trim() : String(row || '').trim());
        }
      } else if (track.type === 0) {
        for (const row of track.lyricContent) {
          romanizations.push(Array.isArray(row) ? row.join(' ').trim() : String(row || '').trim());
        }
      }
    }
    return { translations, romanizations };
  } catch {
    return { translations: [], romanizations: [] };
  }
}

/**
 * Parse decoded KRC text into word-by-word LyricLine[] with translations
 */
export function parseKrcText(krcText: string): ParsedLyrics {
  const cleaned = String(krcText || '').replace(/^\uFEFF/, '');
  const { translations, romanizations } = parseKrcLanguageHeader(cleaned);
  const rawLines = cleaned.split(/\r?\n/);

  const lineRe = /^\[(\d+),(\d+)\](.*)$/;
  const wordRe = /<(\d+),(\d+),\d+>([^<]*)/g;

  const lines: LyricLine[] = [];
  let lyricIdx = 0;

  for (const raw of rawLines) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const lineStart = Number(m[1]);
    const lineDur = Number(m[2]);
    const body = m[3] || '';

    const words: LyricWord[] = [];
    let fullText = '';
    wordRe.lastIndex = 0;
    let wm: RegExpExecArray | null;
    while ((wm = wordRe.exec(body)) !== null) {
      const wOffset = Number(wm[1]);
      const wDur = Number(wm[2]);
      const wText = wm[3] || '';
      if (wText.length > 0) {
        words.push({
          startMs: lineStart + wOffset,
          durationMs: Math.max(40, wDur),
          text: wText,
        });
        fullText += wText;
      }
    }

    const trimmedText = (fullText || body.replace(/<[^>]+>/g, '')).trim();
    const translation = translations[lyricIdx] || undefined;
    const romanization = romanizations[lyricIdx] || undefined;
    lyricIdx += 1;

    if (!trimmedText) continue;
    lines.push({
      startMs: lineStart,
      endMs: lineStart + Math.max(200, lineDur),
      text: trimmedText,
      translation: translation && translation !== '//' ? translation : undefined,
      romanization: romanization && romanization !== '//' ? romanization : undefined,
      words: words.length > 0 ? words : undefined,
    });
  }

  lines.sort((a, b) => a.startMs - b.startMs);
  return {
    lines,
    hasWordTiming: lines.some((l) => Boolean(l.words && l.words.length > 0)),
    hasTranslation: lines.some((l) => Boolean(l.translation)),
    source: 'kugou-krc',
  };
}

/**
 * Parse standard LRC (supporting optional interleaved bilingual translation lines at identical timestamps)
 */
export function parseLrcText(
  lrcText: string,
  translationLrc?: string,
  source: ParsedLyrics['source'] = 'kugou-lrc',
): ParsedLyrics {
  const timeRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const entries = new Map<number, string[]>();

  const ingest = (text: string) => {
    for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const matches = [...raw.matchAll(timeRe)];
      if (!matches.length) continue;
      const content = raw.replace(timeRe, '').trim();
      if (!content || content === '//') continue;
      for (const m of matches) {
        const min = Number(m[1]) || 0;
        const sec = Number(m[2]) || 0;
        const ms = Number(String(m[3] || '0').padEnd(3, '0').slice(0, 3)) || 0;
        const startMs = min * 60000 + sec * 1000 + ms;
        const bucket = entries.get(startMs) ?? [];
        if (!bucket.includes(content)) bucket.push(content);
        entries.set(startMs, bucket);
      }
    }
  };

  ingest(lrcText);
  if (translationLrc) ingest(translationLrc);

  const sortedTimes = Array.from(entries.keys()).sort((a, b) => a - b);
  const lines: LyricLine[] = sortedTimes.map((startMs, idx) => {
    const texts = entries.get(startMs)!;
    const nextStart = sortedTimes[idx + 1] ?? startMs + 4000;
    return {
      startMs,
      endMs: Math.max(startMs + 300, nextStart),
      text: texts[0],
      translation: texts.length > 1 ? texts[1] : undefined,
    };
  });

  return {
    lines,
    hasWordTiming: false,
    hasTranslation: lines.some((l) => Boolean(l.translation)),
    source,
  };
}

async function fetchNeteaseFallbackLyrics(song: Song): Promise<ParsedLyrics | null> {
  try {
    const kw = encodeURIComponent(`${song.title} ${song.artist}`.trim());
    const searchRes = await nativeHttpRequest({
      method: 'GET',
      url: `https://music.163.com/api/search/get/web?s=${kw}&type=1&offset=0&limit=5`,
      headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
      readTimeoutMs: 6000,
    });
    const parsedSearch = JSON.parse(searchRes.body);
    const id = parsedSearch?.result?.songs?.[0]?.id;
    if (!id) return null;

    const lrcRes = await nativeHttpRequest({
      method: 'GET',
      url: `https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1`,
      headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
      readTimeoutMs: 6000,
    });
    const parsedLrc = JSON.parse(lrcRes.body);
    const orig = String(parsedLrc?.lrc?.lyric || '').trim();
    const trans = String(parsedLrc?.tlyric?.lyric || '').trim();
    if (!orig) return null;
    const parsed = parseLrcText(orig, trans, 'netease');
    return parsed.lines.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchLrclibFallbackLyrics(song: Song): Promise<ParsedLyrics | null> {
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(song.title)}&artist_name=${encodeURIComponent(song.artist)}`;
    const res = await nativeHttpRequest({
      method: 'GET',
      url,
      headers: { 'User-Agent': 'EchoMusicMobile/1.0' },
      readTimeoutMs: 6000,
    });
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
    const synced = String(data?.syncedLyrics || '').trim();
    if (!synced) return null;
    const parsed = parseLrcText(synced, undefined, 'lrclib');
    return parsed.lines.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

const lyricsCache = new Map<string, ParsedLyrics>();

export function clearLyricsCache(): void {
  lyricsCache.clear();
}

export async function fetchLyricsForSong(song: Song): Promise<ParsedLyrics> {
  const cacheKey = song.hash || `${song.artist}:${song.title}`;
  const cached = lyricsCache.get(cacheKey);
  if (cached) {
    return pluginRuntime.applyLyricFilters(cached, song);
  }

  // 1. KuGou KRC (word-by-word + embedded translation)
  try {
    const keyword = `${song.artist} - ${song.title}`.trim();
    const searchRes = await kugouApi.searchLyric(keyword, song.hash, song.duration * 1000);
    const candidates = searchRes?.body?.candidates ?? [];
    if (Array.isArray(candidates) && candidates.length > 0) {
      const best = candidates[0];
      const dlRes = await kugouApi.downloadLyric(String(best.id), String(best.accesskey), 'krc');
      const content = String(dlRes?.body?.content || '');
      if (content) {
        const decoded = decodeKrcBase64(content);
        const parsed =
          decoded.includes('<') && /\[\d+,\d+\]/.test(decoded)
            ? parseKrcText(decoded)
            : parseLrcText(decoded, undefined, 'kugou-lrc');
        if (parsed.lines.length > 0) {
          lyricsCache.set(cacheKey, parsed);
          return pluginRuntime.applyLyricFilters(parsed, song);
        }
      }
    }
  } catch {
    // continue to fallback
  }

  // 2. NetEase bilingual LRC fallback
  const neLyrics = await fetchNeteaseFallbackLyrics(song);
  if (neLyrics) {
    lyricsCache.set(cacheKey, neLyrics);
    return pluginRuntime.applyLyricFilters(neLyrics, song);
  }

  // 3. LRCLIB international fallback
  const lrcLib = await fetchLrclibFallbackLyrics(song);
  if (lrcLib) {
    lyricsCache.set(cacheKey, lrcLib);
    return pluginRuntime.applyLyricFilters(lrcLib, song);
  }

  return { lines: [], hasWordTiming: false, hasTranslation: false, source: 'none' };
}
