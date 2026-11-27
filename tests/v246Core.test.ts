import { describe, expect, it, beforeEach } from 'vitest';
import { ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { zhCN, zhTW, enUS } from '@/i18n/messages';
import { computeSharedArtworkTransform } from '@/utils/heroMorph';
import {
  clearDecodedCoverCache,
  isCoverUrlDecoded,
  rememberDecodedUrl,
  useDecodedCover,
} from '@/composables/useDecodedCover';
import { useUiStore } from '@/stores/ui';
import { FALLBACK_APP_VERSION } from '@/services/update/updateService';
import {
  buildCommentLikeAssign,
  KUGOU_COMMENT_SONG_CODE,
  normalizeCommentItem,
  resolveCommentPoolId,
} from '@/services/kugou/kugouEngine';

describe('v2.4.6 Brand Philosophy & Splash Replay', () => {
  it('stores the verbatim 5-line 弥音 · MELUNE brand manifesto in zh-CN and localized variants', () => {
    expect(zhCN['app.fullName']).toBe('弥音 · MELUNE');
    expect(zhCN['about.miLine']).toBe('弥，是绵延，是充盈，也是声音穿越时间后的余韵。');
    expect(zhCN['about.yinLine']).toBe('音，是旋律，是情感，也是每个人独一无二的精神世界。');
    expect(zhCN['about.vision']).toBe('弥音，希望让每一段旋律都拥有自己的空间，让每一种情绪都能找到共鸣。');
    expect(zhCN['about.closing']).toBe('音乐终会停止，余音却可以绵延。');
    expect(zhCN['splash.headline']).toBe('音乐终会停止，余音却可以绵延。');
    expect(zhCN['about.replaySplash']).toBe('重温弥音开屏');

    for (const dict of [zhTW, enUS]) {
      expect(dict['splash.headline'].length).toBeGreaterThan(8);
      expect(dict['about.miLine'].length).toBeGreaterThan(10);
      expect(dict['about.yinLine'].length).toBeGreaterThan(10);
      expect(dict['about.vision'].length).toBeGreaterThan(10);
      expect(dict['about.closing'].length).toBeGreaterThan(8);
      expect(dict['about.replaySplash'].length).toBeGreaterThan(3);
    }
  });

  it('closes AccountVipSheet and increments splashReplaySeq when replaying splash from Settings', () => {
    setActivePinia(createPinia());
    const ui = useUiStore();
    ui.accountSheetOpen = true;
    expect(ui.splashReplaySeq).toBe(0);

    ui.replaySplash();
    expect(ui.accountSheetOpen).toBe(false);
    expect(ui.splashReplaySeq).toBe(1);

    ui.replaySplash();
    expect(ui.splashReplaySeq).toBe(2);
  });

  it('reports a valid v2.4.x fallback app version', () => {
    expect(FALLBACK_APP_VERSION).toMatch(/^2\.4\.\d+$/);
  });
});

describe('v2.4.6 Flicker-Free Shared Artwork & Pre-Decoded Cover Buffer', () => {
  beforeEach(() => {
    clearDecodedCoverCache();
  });

  it('computes pure-GPU transforms for cover playing, cover paused, swipe tilt, and lyrics/queue landing', () => {
    const coverSlot = { left: 45, top: 140, width: 300, height: 300 };
    const miniSlot = { left: 20, top: 60, width: 48, height: 48 };

    const playing = computeSharedArtworkTransform(coverSlot, miniSlot, {
      mode: 'cover',
      isPlaying: true,
    });
    expect(playing.dx).toBe(0);
    expect(playing.dy).toBe(0);
    expect(playing.scale).toBe(1);
    expect(playing.transform).toBe('translate3d(0, 0, 0) scale3d(1, 1, 1)');

    const paused = computeSharedArtworkTransform(coverSlot, miniSlot, {
      mode: 'cover',
      isPlaying: false,
    });
    expect(paused.scale).toBe(0.84);
    expect(paused.transform).toBe('translate3d(0, 0, 0) scale3d(0.84, 0.84, 1)');

    const swiping = computeSharedArtworkTransform(coverSlot, miniSlot, {
      mode: 'cover',
      isPlaying: true,
      swipeX: -80,
    });
    expect(swiping.dx).toBe(-80);
    expect(swiping.scale).toBe(0.95);
    expect(swiping.transform).toContain('rotate(-2.56deg)');

    const lyrics = computeSharedArtworkTransform(coverSlot, miniSlot, {
      mode: 'lyrics',
      isPlaying: true,
    });
    // cover center: (195, 290), mini center: (44, 84) -> dx = -151, dy = -206, scale = 48 / 300 = 0.16
    expect(lyrics.dx).toBe(-151);
    expect(lyrics.dy).toBe(-206);
    expect(lyrics.scale).toBeCloseTo(0.16, 4);
    expect(lyrics.transform).toBe('translate3d(-151px, -206px, 0) scale3d(0.16, 0.16, 1)');
  });

  it('keeps displayedCoverUrl rock-solid on cache hit and clears cleanly when track has no cover', () => {
    const first = 'https://cdn.example.com/cover-a.jpg';
    const second = 'https://cdn.example.com/cover-b.jpg';
    rememberDecodedUrl(second);
    expect(isCoverUrlDecoded(second)).toBe(true);

    const src = ref(first);
    const { displayedCoverUrl } = useDecodedCover(() => src.value);

    expect(displayedCoverUrl.value).toBe(first);
    expect(isCoverUrlDecoded(first)).toBe(true);

    // Pre-decoded URL swaps synchronously with zero dark placeholder flash
    src.value = second;
    expect(displayedCoverUrl.value).toBe(second);

    // Empty URL clears cleanly
    src.value = '';
    expect(displayedCoverUrl.value).toBe('');
  });
});

describe('v2.4.6 KuGou Comment Floor Pool ID & Like Signature', () => {
  it('prioritizes special_child_id and body.childrenid over internal shard special_id', () => {
    const rawBody = {
      childrenid: '351563',
      list: [
        {
          id: 1593614124,
          special_id: 2364,
          special_child_id: '351563',
          user_name: '真的爱你LL',
          content: '终于要当妈妈了',
          reply_num: 298,
          like: { likenum: 3555, haslike: true },
        },
      ],
    };

    const poolId = resolveCommentPoolId(rawBody);
    expect(poolId).toBe('351563');

    const normalized = normalizeCommentItem(rawBody.list[0], poolId || '');
    expect(normalized.specialId).toBe('351563');
    expect(normalized.tid).toBe('1593614124');
    expect(normalized.likeCount).toBe(3555);
    expect(normalized.liked).toBe(true);
    expect(normalized.replyCount).toBe(298);

    // Even when item lacks special_child_id, fallback body childrenid wins over internal shard special_id=2364
    const fallbackItem = normalizeCommentItem(
      { id: 999, special_id: 2364, user_name: 'Test', content: 'Hi' },
      '351563',
    );
    expect(fallbackItem.specialId).toBe('351563');
    expect(fallbackItem.liked).toBe(false);
  });

  it('produces deterministic 32-char MD5 assign signature for KuGou mlike handlelike', () => {
    const sig = buildCommentLikeAssign(KUGOU_COMMENT_SONG_CODE, '1700000000');
    expect(sig).toMatch(/^[a-f0-9]{32}$/);
    expect(sig).toBe(buildCommentLikeAssign(KUGOU_COMMENT_SONG_CODE, '1700000000'));
    expect(sig).not.toBe(buildCommentLikeAssign(KUGOU_COMMENT_SONG_CODE, '1700000001'));
  });
});
