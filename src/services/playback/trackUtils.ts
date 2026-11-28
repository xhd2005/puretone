import type { Song } from '@/types/music';

export function normalizeTrackText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/\b(feat\.?|ft\.?|live|ver\.?|version|remaster(?:ed)?|hi-?res|flac|无损|音质|原唱)\b/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

export function getTrackKey(song: Pick<Song, 'hash' | 'id' | 'title' | 'artist'>): string {
  if (song.hash) return `hash:${song.hash.toLowerCase()}`;
  if (song.id) return `id:${song.id}`;
  return `meta:${normalizeTrackText(song.artist)}:${normalizeTrackText(song.title)}`;
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
