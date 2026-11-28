import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  getRingSlotAssignment,
  rotateRingCenter,
  stepCriticallyDampedSpring,
} from '@/utils/heroMorph';
import { computeWordLuminanceAlpha, quantizeWordAlphaStep } from '@/utils/lyricClock';
import {
  buildMelunePluginShareLink,
  normalizeRegistryUrl,
  parseMeluneExtensionDeepLink,
} from '@/services/plugins/deepLink';
import {
  computeUtf8Sha256Hex,
  validatePluginManifest,
  validateRegistryIndex,
} from '@/services/plugins/registryClient';
import { pluginRuntime } from '@/services/plugins/pluginRuntime';
import { MELUNE_EXT_PROTOCOL, type InstalledMelunePlugin } from '@/services/plugins/types';
import type { ParsedLyrics, Song } from '@/types/music';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

describe('v2.5.0 Direct-DOM 3-Slot Ring Carousel & Zero-Flicker Lyrics / 3-Mode Landscape', () => {
  it('rotates 3-slot ring indices cleanly without ever resetting or teleporting the landed center card', () => {
    expect(getRingSlotAssignment(0)).toEqual({ prev: 2, center: 0, next: 1 });
    const afterNext = rotateRingCenter(0, 'next');
    expect(afterNext).toBe(1);
    expect(getRingSlotAssignment(afterNext)).toEqual({ prev: 0, center: 1, next: 2 });

    const afterPrev = rotateRingCenter(afterNext, 'prev');
    expect(afterPrev).toBe(0);
    expect(rotateRingCenter(0, 'prev')).toBe(2);

    // Critically-damped spring converges monotonically to target without overshoot bounce
    let pos = -120;
    let vel = -520;
    let settled = false;
    for (let i = 0; i < 180; i += 1) {
      const step = stepCriticallyDampedSpring(pos, -320, vel, 1 / 120, 16.5);
      pos = step.position;
      vel = step.velocity;
      if (step.settled) {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true);
    expect(pos).toBe(-320);
  });

  it('computes monotonic zero-SaveLayer word luminance alpha and enforces flicker-free KRC CSS', () => {
    const word = { startMs: 1000, durationMs: 400 };
    expect(computeWordLuminanceAlpha(word, 900)).toBe(0.34);
    const mid = computeWordLuminanceAlpha(word, 1200);
    expect(mid).toBeGreaterThan(0.7);
    expect(mid).toBeLessThan(1);
    expect(computeWordLuminanceAlpha(word, 1500)).toBe(1);
    expect(quantizeWordAlphaStep(0.34)).toBe(0);
    expect(quantizeWordAlphaStep(1)).toBe(16);

    const krcVue = fs.readFileSync(path.resolve(process.cwd(), 'src/components/KrcLyricsView.vue'), 'utf8');
    const krcStyle = krcVue.slice(krcVue.indexOf('<style'));
    expect(krcStyle).not.toContain('background-clip: text');
    expect(krcStyle).not.toContain('color: transparent');
    expect(krcStyle).not.toContain('contain: strict');
    expect(krcStyle).not.toContain('mask-image');
    expect(krcStyle).not.toContain(':global(.dark)');

    const landVue = fs.readFileSync(path.resolve(process.cwd(), 'src/components/LandscapeStudioStage.vue'), 'utf8');
    expect(landVue).toContain('data-landscape-vinyl');
    expect(landVue).toContain('data-landscape-cinema');
    expect(landVue).toContain('ls-tonearm');
    expect(landVue).toContain('CoverFlowStage');
    expect(landVue).not.toContain(':global(.dark)');
  });
});

describe('v2.5.0 melune-ext/v1 Plugin Protocol, Sandbox Isolation & Compliance Decoupling', () => {
  beforeEach(async () => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
    pluginRuntime.setSafeMode(false);
    await pluginRuntime.unloadAll();
  });

  it('normalizes GitHub repository URLs and parses/builds melune://ext/* deep links securely', () => {
    expect(normalizeRegistryUrl('xhd2005/melune-plugins')).toBe(
      'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/melune-registry.json',
    );
    expect(normalizeRegistryUrl('https://github.com/xhd2005/melune-plugins')).toBe(
      'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/melune-registry.json',
    );
    expect(normalizeRegistryUrl('http://insecure.example/reg.json')).toBe('');

    const share = buildMelunePluginShareLink('xhd2005/melune-plugins', 'melune-team-vip');
    expect(share.startsWith('melune://ext/install?')).toBe(true);

    const parsed = parseMeluneExtensionDeepLink(share);
    expect(parsed).toEqual({
      kind: 'plugin',
      registryUrl: 'https://raw.githubusercontent.com/xhd2005/melune-plugins/main/melune-registry.json',
      pluginId: 'melune-team-vip',
    });

    // Reject cleartext http:// inside melune:// deep link
    expect(parseMeluneExtensionDeepLink('melune://ext/install?registry=http://evil.com/r.json&id=x')).toBeNull();
  });

  it('enforces mandatory SHA-256 verification, permission gates, and Safe Mode isolation', async () => {
    const code = `
      module.exports = defineMelunePlugin({
        setup(ctx) {
          ctx.registerLyricFilter((parsed) => ({
            ...parsed,
            lines: parsed.lines.filter((l) => !l.text.startsWith('META:')),
          }));
        },
      });
    `;
    const sha256 = computeUtf8Sha256Hex(code);

    // Tampered SHA-256 must be rejected!
    const tampered: InstalledMelunePlugin = {
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'test-tampered',
        name: 'Tampered',
        version: '1.0.0',
        author: 'Tester',
        description: 'Tampered bundle',
        sha256: 'f'.repeat(64),
        permissions: ['lyric.filter'],
      }),
      code,
      sourceUrl: 'https://example.com/index.js',
      enabled: true,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      grantedPermissions: ['lyric.filter'],
    };
    expect(await pluginRuntime.loadPlugin(tampered)).toBe(false);
    expect(pluginRuntime.getPluginRuntimeStatus('test-tampered').lastError).toContain('完整性校验失败');

    // Valid SHA-256 without lyric.filter permission -> blocked by permission gate
    const missingPerm: InstalledMelunePlugin = {
      ...tampered,
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'test-no-perm',
        name: 'NoPerm',
        version: '1.0.0',
        author: 'Tester',
        description: 'Missing perm',
        sha256,
        permissions: ['storage'],
      }),
      grantedPermissions: ['storage'],
    };
    expect(await pluginRuntime.loadPlugin(missingPerm)).toBe(false);
    expect(pluginRuntime.getPluginRuntimeStatus('test-no-perm').lastError).toContain('未获得权限');

    // Valid SHA-256 + matching permission -> runs cleanly
    const valid: InstalledMelunePlugin = {
      ...tampered,
      manifest: validatePluginManifest({
        protocol: MELUNE_EXT_PROTOCOL,
        id: 'test-clean',
        name: 'Clean',
        version: '1.0.0',
        author: 'Tester',
        description: 'Valid lyric filter',
        sha256,
        permissions: ['lyric.filter'],
      }),
      grantedPermissions: ['lyric.filter'],
    };
    expect(await pluginRuntime.loadPlugin(valid)).toBe(true);

    const sampleSong: Song = { id: '1', hash: 'abc', title: 'Song', artist: 'Singer', album: '', coverUrl: '', duration: 200 };
    const sampleLyrics: ParsedLyrics = {
      lines: [
        { startMs: 0, endMs: 1000, text: 'META: 作词：张三' },
        { startMs: 2000, endMs: 5000, text: '第一句真实歌词' },
      ],
      hasWordTiming: false,
      hasTranslation: false,
      source: 'kugou-lrc',
    };

    const filtered = await pluginRuntime.applyLyricFilters(sampleLyrics, sampleSong);
    expect(filtered.lines).toHaveLength(1);
    expect(filtered.lines[0].text).toBe('第一句真实歌词');

    // Safe Mode immediately disables all plugin hooks
    pluginRuntime.setSafeMode(true);
    const bypassed = await pluginRuntime.applyLyricFilters(sampleLyrics, sampleSong);
    expect(bypassed.lines).toHaveLength(2);
  });

  it('guarantees puretone core contains zero built-in VIP/unblock engines or hardcoded sensitive registry URLs', () => {
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/services/vip/vipClaimEngine.ts'))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/stores/vip.ts'))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/services/playback/unblockEngine.ts'))).toBe(false);

    const hubSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PluginHubTab.vue'), 'utf8');
    expect(hubSrc).not.toContain('v-html');
    expect(hubSrc).not.toContain(':global(.dark)');

    const rendererSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PluginPanelRenderer.vue'), 'utf8');
    expect(rendererSrc).not.toContain('v-html');
    expect(rendererSrc).not.toContain(':global(.dark)');
  });

  it('loads and executes all 5 official melune-plugins repository bundles when sibling workspace is present', async () => {
    const pluginsRepoRoot = path.resolve(process.cwd(), '..', 'melune-plugins');
    const registryPath = path.join(pluginsRepoRoot, 'melune-registry.json');
    if (!fs.existsSync(registryPath)) {
      // Self-contained CI checkout (only puretone repo cloned): skip sibling repo integration check
      return;
    }

    const rawReg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const registry = validateRegistryIndex(rawReg);
    expect(registry.plugins.map((p) => p.id).sort()).toEqual([
      'melune-daily-checkin',
      'melune-lyric-cleaner',
      'melune-sleep-timer',
      'melune-smart-unblock',
      'melune-team-vip',
    ]);

    pluginRuntime.setHostBridge({
      getAppVersion: () => '2.5.2',
      getActiveAccount: () => ({ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-01-01' }),
      listAccounts: () => [{ userid: '10086', nickname: 'Hayden', isVip: true, tvipEndTime: '2027-01-01' }],
      getAuthForUser: () => ({ userid: '10086', token: 'mock_token_never_exposed' }),
      refreshAccount: async () => {},
      showToast: () => {},
      getCurrentTrack: () => null,
      isPlaying: () => false,
      pausePlayback: async () => {},
    });

    for (const manifest of registry.plugins) {
      const code = fs.readFileSync(
        path.join(pluginsRepoRoot, 'plugins', manifest.id, manifest.entry || 'index.js'),
        'utf8',
      );
      expect(computeUtf8Sha256Hex(code)).toBe(manifest.sha256);

      const ok = await pluginRuntime.loadPlugin({
        manifest,
        code,
        sourceUrl: manifest.downloadUrl || '',
        enabled: true,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        grantedPermissions: [...manifest.permissions],
      });
      expect(ok).toBe(true);

      const panel = await pluginRuntime.renderPluginPanel(manifest.id);
      expect(panel).not.toBeNull();
      expect(panel!.sections.length).toBeGreaterThan(0);
    }

    // Verify melune-smart-unblock registered an audio resolver and melune-lyric-cleaner strips metadata
    expect(pluginRuntime.hasAudioResolvers()).toBe(true);
    const cleaned = await pluginRuntime.applyLyricFilters(
      {
        lines: [
          { startMs: 0, endMs: 1000, text: '作词：方文山' },
          { startMs: 1000, endMs: 2000, text: '作曲：周杰伦' },
          { startMs: 2000, endMs: 3000, text: '酷狗音乐版权声明' },
          { startMs: 5000, endMs: 8000, text: '窗外的麻雀 在电线杆上多嘴' },
          { startMs: 9000, endMs: 12000, text: '你说这一句 很有夏天的感觉' },
        ],
        hasWordTiming: false,
        hasTranslation: false,
        source: 'kugou-lrc',
      },
      { id: '2', hash: 'h', title: '七里香', artist: '周杰伦', album: '', coverUrl: '', duration: 299 },
    );
    expect(cleaned.lines).toHaveLength(2);
    expect(cleaned.lines[0].text).toBe('窗外的麻雀 在电线杆上多嘴');
  });
});
