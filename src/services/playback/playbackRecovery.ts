export const MAX_STREAM_RECOVERY_ATTEMPTS = 3;

export type PlaybackRecoveryReason =
  | 'upcoming_dropped'
  | 'stream_error'
  | 'premature_eof'
  | 'short_trial_stream';

export type RecoveryDecision =
  | { action: 'refresh_upcoming' }
  | { action: 'reload_same_source'; positionMs: number; attempt: number }
  | { action: 'reload_force_unblock'; positionMs: number; attempt: number }
  | { action: 'reload_stable_quality'; positionMs: number; attempt: number }
  | { action: 'stop_with_notice'; toastMessage: string };

export interface PlaybackRecoveryInput {
  reason: PlaybackRecoveryReason;
  positionMs: number;
  attemptsSoFar: number;
  enableUnblock: boolean;
  alreadyUnblocked: boolean;
  songTitle: string;
  errorMessage?: string;
}

function summarizeReasonLabel(reason: PlaybackRecoveryReason, errorMessage?: string): string {
  if (reason === 'short_trial_stream') return '仅返回试听片段';
  if (reason === 'premature_eof') return '音频流提前中断';
  const clean = String(errorMessage || '').trim();
  if (!clean) return '音频流加载异常';
  if (/403|forbidden/i.test(clean)) return '直链权限已失效';
  if (/404|not found/i.test(clean)) return '音源链接不可用';
  if (/timeout|timed out|connect|network|io/i.test(clean)) return '网络波动中断';
  if (/parse|format|codec|decode/i.test(clean)) return '音频解码异常';
  return clean.length > 18 ? `${clean.slice(0, 18)}…` : clean;
}

/**
 * Zero-auto-skip recovery policy:
 * NEVER skips mid-song to the next track. Exhausts up to 3 in-place recovery tiers
 * (fresh URL -> full-length unblock fallback -> ultra-stable 128k fallback) at exact timestamp;
 * if still unrecoverable (e.g. offline), pauses cleanly at current position with a clear toast.
 */
export function decidePlaybackRecovery(input: PlaybackRecoveryInput): RecoveryDecision {
  if (input.reason === 'upcoming_dropped') {
    return { action: 'refresh_upcoming' };
  }

  const safePos = Math.max(0, Math.round(Number(input.positionMs) || 0));
  const attempts = Math.max(0, Math.floor(Number(input.attemptsSoFar) || 0));

  // Trial snippet detected at STATE_READY: immediately switch to full-length unblocked track
  if (input.reason === 'short_trial_stream') {
    if (attempts < MAX_STREAM_RECOVERY_ATTEMPTS && input.enableUnblock && !input.alreadyUnblocked) {
      return {
        action: 'reload_force_unblock',
        positionMs: safePos,
        attempt: attempts + 1,
      };
    }
    const title = String(input.songTitle || '当前歌曲').trim() || '当前歌曲';
    const shortTitle = title.length > 14 ? `${title.slice(0, 14)}…` : title;
    return {
      action: 'stop_with_notice',
      toastMessage: `「${shortTitle}」当前源仅为试听片段，请点击换源获取完整版`,
    };
  }

  if (attempts === 0) {
    return {
      action: 'reload_same_source',
      positionMs: safePos,
      attempt: 1,
    };
  }

  if (attempts === 1) {
    if (input.enableUnblock && !input.alreadyUnblocked) {
      return {
        action: 'reload_force_unblock',
        positionMs: safePos,
        attempt: 2,
      };
    }
    return {
      action: 'reload_stable_quality',
      positionMs: safePos,
      attempt: 2,
    };
  }

  if (attempts < MAX_STREAM_RECOVERY_ATTEMPTS) {
    return {
      action: 'reload_stable_quality',
      positionMs: safePos,
      attempt: attempts + 1,
    };
  }

  const title = String(input.songTitle || '当前歌曲').trim() || '当前歌曲';
  const shortTitle = title.length > 14 ? `${title.slice(0, 14)}…` : title;
  const reasonLabel = summarizeReasonLabel(input.reason, input.errorMessage);
  return {
    action: 'stop_with_notice',
    toastMessage: `「${shortTitle}」${reasonLabel}，已暂停在当前进度（点播放续播或换源）`,
  };
}
