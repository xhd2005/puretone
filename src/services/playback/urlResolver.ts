import type { AudioQuality, Song } from '@/types/music';
import { kugouApi } from '@/services/kugou/kugouEngine';
import { extractUrlsFromPayload, getPinnedSource, resolveUnblockedUrl } from './unblockEngine';

export interface ResolvedStream {
  url: string;
  quality: AudioQuality;
  sourceTag: string;
  isUnblocked: boolean;
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
  options: { enableUnblock?: boolean; externalPlatforms?: string[] } = {},
): Promise<ResolvedStream> {
  const enableUnblock = options.enableUnblock !== false;

  // 0. If pinned unblock source exists, prioritize it immediately
  if (enableUnblock) {
    const pinned = await getPinnedSource(song);
    if (pinned) {
      const unblocked = await resolveUnblockedUrl(song, preferredQuality, options.externalPlatforms);
      if (unblocked) {
        return { ...unblocked, isUnblocked: true };
      }
    }
  }

  // 1. Official KuGou catalog resolution (aligned with EchoMusic resolver.ts)
  let targetHash =
    (preferredQuality === 'flac' && song.hashFlac) ||
    (preferredQuality === '320' && song.hash320) ||
    song.hash;

  if (song.hash) {
    try {
      const priv = await kugouApi.getSongPrivilegeLite(song.hash);
      targetHash = pickQualityHashFromPrivilege(priv?.body, preferredQuality, targetHash);
    } catch {
      // non-fatal
    }
  }

  const attempts: Array<{ hash: string; quality: string; useNew?: boolean; label: AudioQuality }> = [];
  if (preferredQuality === 'flac') {
    if (targetHash) attempts.push({ hash: targetHash, quality: 'flac', label: 'flac' });
    if (song.hash320 || song.hash) attempts.push({ hash: song.hash320 || song.hash, quality: '320', label: '320' });
  } else if (preferredQuality === '320') {
    if (targetHash) attempts.push({ hash: targetHash, quality: '320', label: '320' });
  }
  if (song.hash) {
    attempts.push({ hash: song.hash, quality: '128', label: '128' });
    attempts.push({ hash: song.hash, quality: '', label: '128' });
    attempts.push({ hash: song.hash, quality: preferredQuality, useNew: true, label: preferredQuality });
  }

  let fallbackTrial: ResolvedStream | null = null;

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
        return candidate;
      }
      if (!fallbackTrial) fallbackTrial = candidate;
    } catch {
      // continue
    }
  }

  // 2. Built-in gray-song / trial-snippet unblock waterfall
  if (enableUnblock) {
    const unblocked = await resolveUnblockedUrl(song, preferredQuality, options.externalPlatforms);
    if (unblocked) {
      return { ...unblocked, isUnblocked: true };
    }
  }

  if (fallbackTrial) {
    return { ...fallbackTrial, sourceTag: '试听片段' };
  }

  throw new Error('暂无可用音源，请尝试切换账号或手动换源');
}
