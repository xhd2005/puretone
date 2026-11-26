import { reactive } from 'vue';
import type { PlaylistSummary, Song } from '@/types/music';
import { echoSystem } from '@/native/echoSystem';
import { kugouApi } from '@/services/kugou/kugouEngine';

const COVER_CACHE_KEY = 'playlist.covers.v1';

const PLACEHOLDER_COVER_RE =
  /(default\.jpg|default_playlist|default_album|default_cover|20130807185439172736|nopic|no_pic|blank\.png)/i;

export function isValidCoverUrl(url?: string | null): boolean {
  const u = String(url || '').trim();
  if (!u || !/^https?:\/\//i.test(u)) return false;
  if (PLACEHOLDER_COVER_RE.test(u)) return false;
  return true;
}

export function getPlaylistCacheKey(pl: Pick<PlaylistSummary, 'globalCollectionId' | 'id' | 'listId'>): string {
  return String(pl.globalCollectionId || pl.listId || pl.id || '').trim();
}

export function extractDistinctCoversFromSongs(songs: Song[], limit = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of songs) {
    if (!isValidCoverUrl(s.coverUrl)) continue;
    if (seen.has(s.coverUrl)) continue;
    seen.add(s.coverUrl);
    out.push(s.coverUrl);
    if (out.length >= limit) break;
  }
  return out;
}

const reactiveCoverMap = reactive<Record<string, string[]>>({});
let loaded = false;
let loadPromise: Promise<void> | null = null;
const inFlight = new Set<string>();

export async function hydratePlaylistCoverCache(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const saved = await echoSystem.kvGetJson<Record<string, string[]>>(COVER_CACHE_KEY, {});
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) {
        if (Array.isArray(v)) {
          const valid = v.filter(isValidCoverUrl).slice(0, 4);
          if (valid.length) reactiveCoverMap[k] = valid;
        }
      }
    }
    loaded = true;
  })();
  return loadPromise;
}

async function persistCoverCache(): Promise<void> {
  const plain: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(reactiveCoverMap)) {
    if (Array.isArray(v) && v.length) plain[k] = v.slice(0, 4);
  }
  await echoSystem.kvSetJson(COVER_CACHE_KEY, plain);
}

export function getResolvedPlaylistCovers(playlistKey: string, explicitCoverUrl?: string): string[] {
  if (isValidCoverUrl(explicitCoverUrl)) {
    return [explicitCoverUrl!.trim()];
  }
  const cached = reactiveCoverMap[playlistKey];
  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }
  return [];
}

export function recordPlaylistCoversFromSongs(playlistKey: string, songs: Song[]): void {
  if (!playlistKey || !songs.length) return;
  const covers = extractDistinctCoversFromSongs(songs, 4);
  if (!covers.length) return;
  const prev = reactiveCoverMap[playlistKey];
  if (prev && prev.length === covers.length && prev.every((u, i) => u === covers[i])) {
    return;
  }
  reactiveCoverMap[playlistKey] = covers;
  void persistCoverCache();
}

export async function backfillMissingPlaylistCovers(playlists: PlaylistSummary[], concurrency = 3): Promise<void> {
  await hydratePlaylistCoverCache();

  const targets = playlists.filter((pl) => {
    if (isValidCoverUrl(pl.coverUrl)) return false;
    const key = getPlaylistCacheKey(pl);
    if (!key || inFlight.has(key)) return false;
    const existing = reactiveCoverMap[key];
    return !existing || existing.length < 1;
  });

  if (!targets.length) return;

  let cursor = 0;
  let dirty = false;

  async function worker() {
    while (cursor < targets.length) {
      const pl = targets[cursor++];
      const key = getPlaylistCacheKey(pl);
      if (!key || inFlight.has(key)) continue;
      inFlight.add(key);
      try {
        const page = await kugouApi.getPlaylistTracksPaged({
          globalCollectionId: pl.globalCollectionId || pl.id,
          listId: pl.listId,
          page: 1,
          pagesize: 10,
        });
        const covers = extractDistinctCoversFromSongs(page.songs, 4);
        if (covers.length > 0) {
          reactiveCoverMap[key] = covers;
          dirty = true;
        }
      } catch {
        // non-fatal
      } finally {
        inFlight.delete(key);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()));
  if (dirty) {
    await persistCoverCache();
  }
}
