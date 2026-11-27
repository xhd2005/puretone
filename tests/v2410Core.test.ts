import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAudioCacheKey,
  classifyAudioSourceBucket,
  isTrialSnippet,
  PREFETCH_TTL_MS,
} from '@/services/playback/urlResolver';
import { decidePlaybackRecovery, MAX_STREAM_RECOVERY_ATTEMPTS } from '@/services/playback/playbackRecovery';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';

const SAMPLE_SONG = {
  id: 'song-1',
  hash: 'ABCDEF1234567890ABCDEF1234567890',
  title: '晴天',
  artist: '周杰伦',
};

describe('v2.4.10 audio cache key isolation & trial snippet detection', () => {
  it('isolates cache keys by quality and source bucket so streams never collide', () => {
    const flacOfficial = buildAudioCacheKey(SAMPLE_SONG, 'flac', '无损 FLAC', false);
    const hqOfficial = buildAudioCacheKey(SAMPLE_SONG, '320', '高品 320k', false);
    const stdOfficial = buildAudioCacheKey(SAMPLE_SONG, '128', '标准 128k', false);
    const kuwo320 = buildAudioCacheKey(SAMPLE_SONG, '320', '解灰 · 酷我 320k', true);
    const bili320 = buildAudioCacheKey(SAMPLE_SONG, '320', '解灰 · B站音频', true);
    const kgAlt = buildAudioCacheKey(SAMPLE_SONG, '320', '酷狗异版', true);

    const unique = new Set([flacOfficial, hqOfficial, stdOfficial, kuwo320, bili320, kgAlt]);
    expect(unique.size).toBe(6);
    expect(flacOfficial).toBe('v2:hash:abcdef1234567890abcdef1234567890:flac:official');
    expect(kuwo320).toBe('v2:hash:abcdef1234567890abcdef1234567890:320:kuwo');
    expect(bili320).toBe('v2:hash:abcdef1234567890abcdef1234567890:320:bilibili');
    expect(kgAlt).toBe('v2:hash:abcdef1234567890abcdef1234567890:320:kugou-alt');
  });

  it('never caches trial snippets in SimpleCache', () => {
    expect(classifyAudioSourceBucket('试听片段', false)).toBe('trial');
    expect(buildAudioCacheKey(SAMPLE_SONG, '128', '试听片段', false)).toBeUndefined();
    expect(buildAudioCacheKey(SAMPLE_SONG, '320', '本地缓存', false)).toBeUndefined();
  });

  it('catches 60s chorus trial snippets across /v5/url, /v6/priv_url and fileSize estimates', () => {
    // Explicit flags
    expect(isTrialSnippet({ is_try_listen: 1, timeLength: 240 }, 240, '128')).toBe(true);
    expect(isTrialSnippet({ free_part: 1 }, 240, '320')).toBe(true);
    expect(isTrialSnippet({ data: { is_free_part: 1 } }, 240, '128')).toBe(true);

    // /v5/url 60s timeLength
    expect(isTrialSnippet({ timeLength: 60 }, 240, '128')).toBe(true);
    // /v6/priv_url nested duration (ms)
    expect(isTrialSnippet({ data: [{ info: { duration: 60000 } }] }, 240, '320')).toBe(true);
    // Spoofed/missing timeLength but ~960KB 128k fileSize (= 60s!) for a 240s song
    expect(isTrialSnippet({ fileSize: 960_000, bitRate: 128 }, 240, '128')).toBe(true);

    // Legitimate full 240s 320k MP3 (~9.6 MB) passes cleanly
    expect(isTrialSnippet({ timeLength: 240, fileSize: 9_600_000, bitRate: 320 }, 240, '320')).toBe(false);
    // Legitimate short 50s interlude passes cleanly
    expect(isTrialSnippet({ timeLength: 50, fileSize: 800_000, bitRate: 128 }, 50, '128')).toBe(false);
  });

  it('tightens prefetch URL TTL to 5 minutes to prevent stale signed CDN links', () => {
    expect(PREFETCH_TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe('v2.4.10 zero-auto-skip in-place recovery state machine', () => {
  it('refreshes upcoming queue quietly without interrupting current track when preload drops', () => {
    const decision = decidePlaybackRecovery({
      reason: 'upcoming_dropped',
      positionMs: 192_000,
      attemptsSoFar: 0,
      enableUnblock: true,
      alreadyUnblocked: false,
      songTitle: '七里香',
    });
    expect(decision).toEqual({ action: 'refresh_upcoming' });
  });

  it('immediately upgrades detected 60s trial stream to full unblocked version', () => {
    const decision = decidePlaybackRecovery({
      reason: 'short_trial_stream',
      positionMs: 0,
      attemptsSoFar: 0,
      enableUnblock: true,
      alreadyUnblocked: false,
      songTitle: '稻香',
    });
    expect(decision).toEqual({
      action: 'reload_force_unblock',
      positionMs: 0,
      attempt: 1,
    });
  });

  it('exhausts 3 in-place recovery tiers and pauses at exact timestamp — NEVER auto-skipping mid-song', () => {
    const step1 = decidePlaybackRecovery({
      reason: 'stream_error',
      positionMs: 188_500,
      attemptsSoFar: 0,
      enableUnblock: true,
      alreadyUnblocked: false,
      songTitle: '夜曲',
      errorMessage: 'HTTP 403 Forbidden',
    });
    expect(step1).toEqual({ action: 'reload_same_source', positionMs: 188_500, attempt: 1 });

    const step2 = decidePlaybackRecovery({
      reason: 'premature_eof',
      positionMs: 188_500,
      attemptsSoFar: 1,
      enableUnblock: true,
      alreadyUnblocked: false,
      songTitle: '夜曲',
    });
    expect(step2).toEqual({ action: 'reload_force_unblock', positionMs: 188_500, attempt: 2 });

    const step3 = decidePlaybackRecovery({
      reason: 'stream_error',
      positionMs: 188_500,
      attemptsSoFar: 2,
      enableUnblock: true,
      alreadyUnblocked: true,
      songTitle: '夜曲',
    });
    expect(step3).toEqual({ action: 'reload_stable_quality', positionMs: 188_500, attempt: 3 });

    const finalStop = decidePlaybackRecovery({
      reason: 'stream_error',
      positionMs: 188_500,
      attemptsSoFar: MAX_STREAM_RECOVERY_ATTEMPTS,
      enableUnblock: true,
      alreadyUnblocked: true,
      songTitle: '夜曲',
      errorMessage: 'SocketTimeoutException',
    });
    expect(finalStop.action).toBe('stop_with_notice');
    if (finalStop.action === 'stop_with_notice') {
      expect(finalStop.toastMessage).toContain('夜曲');
      expect(finalStop.toastMessage).toContain('已暂停在当前进度');
    }
  });

  it('verifies EchoPlaybackService.kt onPlayerError never calls seekToNextMediaItem()', () => {
    const svcPath = path.resolve(
      __dirname,
      '../android/app/src/main/java/com/xhd2005/puretone/player/EchoPlaybackService.kt',
    );
    const source = fs.readFileSync(svcPath, 'utf-8');
    const onErrIdx = source.indexOf('override fun onPlayerError');
    const fwdIdx = source.indexOf('val forwardingPlayer');
    expect(onErrIdx).toBeGreaterThan(0);
    expect(fwdIdx).toBeGreaterThan(onErrIdx);
    const onPlayerErrorBody = source.slice(onErrIdx, fwdIdx);
    expect(onPlayerErrorBody).not.toContain('exoPlayer.seekToNextMediaItem(');
    expect(source).not.toContain('upstreamFactory.setDefaultRequestProperties');
    expect(FALLBACK_APP_VERSION).toBe('2.4.10');
  });
});
