import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { LyricLine } from '@/types/music';
import {
  computeDesiredScrollY,
  computeRowKaraokeSweepWidth,
  getTargetLineAlpha,
  hitTestLyricLine,
  layoutLyricLines,
  renderLyricCanvas,
  stepLineAlphas,
} from '@/utils/lyricCanvasEngine';
import { useUiStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { enUS, zhCN, zhTW } from '@/i18n/messages';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => {
      map.clear();
    },
  };
}

function readRel(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

// Deterministic character-width measurer (16px per CJK char, 9px per ASCII char)
function fakeMeasure(text: string, font: string): number {
  const scale = font.includes('500') ? 0.65 : 1;
  let total = 0;
  for (const ch of Array.from(text)) {
    total += ch.charCodeAt(0) > 127 ? 24 * scale : 13 * scale;
  }
  return total;
}

describe('v2.5.3 Hardware 2D Canvas Zero-Flicker Lyrics Engine', () => {
  const sampleLines: LyricLine[] = [
    {
      startMs: 1000,
      endMs: 4000,
      text: '夜空中最亮的星 Starlight',
      translation: 'The brightest star in the night sky',
      words: [
        { text: '夜', startMs: 1000, durationMs: 400 },
        { text: '空', startMs: 1400, durationMs: 400 },
        { text: '中', startMs: 1800, durationMs: 400 },
        { text: '最', startMs: 2200, durationMs: 400 },
        { text: '亮', startMs: 2600, durationMs: 400 },
        { text: '的', startMs: 3000, durationMs: 300 },
        { text: '星', startMs: 3300, durationMs: 300 },
        { text: ' ', startMs: 3600, durationMs: 100 },
        { text: 'Starlight', startMs: 3700, durationMs: 300 },
      ],
    },
    {
      startMs: 5000,
      endMs: 7500,
      text: '能否听清',
      words: [
        { text: '能', startMs: 5000, durationMs: 600 },
        { text: '否', startMs: 5600, durationMs: 600 },
        { text: '听', startMs: 6200, durationMs: 600 },
        { text: '清', startMs: 6800, durationMs: 700 },
      ],
    },
  ];

  it('lays out mixed CJK/English KRC tokens with wrapping, translations, hit-testing & scroll clamping', () => {
    const doc = layoutLyricLines(
      sampleLines,
      {
        viewportWidth: 300,
        viewportHeight: 600,
        fontSize: 'standard',
        showTranslation: true,
      },
      fakeMeasure,
    );

    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0].hasWords).toBe(true);
    expect(doc.lines[0].mainRows.length).toBeGreaterThanOrEqual(2); // wraps on 300px viewport
    expect(doc.lines[0].transRows.length).toBeGreaterThanOrEqual(1);
    expect(doc.lines[1].y).toBeGreaterThan(doc.lines[0].y + doc.lines[0].height);

    // Hit test middle of line 1
    const hit = hitTestLyricLine(doc, doc.lines[1].centerY);
    expect(hit?.index).toBe(1);
    expect(hitTestLyricLine(doc, -500)).toBeNull();

    // Desired scroll centers active line near anchorRatio without negative scroll
    const scroll0 = computeDesiredScrollY(doc, 0, 600);
    const scroll1 = computeDesiredScrollY(doc, 1, 600);
    expect(scroll0).toBeGreaterThanOrEqual(0);
    expect(scroll1).toBeGreaterThanOrEqual(scroll0);
  });

  it('computes strictly monotonic left-to-right karaoke sweep width and smooth zero-flash line alphas', () => {
    const doc = layoutLyricLines(
      sampleLines,
      {
        viewportWidth: 600,
        viewportHeight: 600,
        fontSize: 'standard',
        showTranslation: false,
      },
      fakeMeasure,
    );
    const row = doc.lines[0].mainRows[0];
    expect(computeRowKaraokeSweepWidth(row, 800)).toBe(0);

    let prev = 0;
    for (let ms = 1000; ms <= 4100; ms += 150) {
      const cur = computeRowKaraokeSweepWidth(row, ms);
      expect(cur).toBeGreaterThanOrEqual(prev);
      expect(cur).toBeLessThanOrEqual(row.width + 0.001);
      prev = cur;
    }
    expect(prev).toBeCloseTo(row.width, 3);

    // Smooth opacity convergence: stepping from line 0 -> line 1 never drops active line to 0
    const alphas = new Float32Array([1, 0.48]);
    const stillMoving = stepLineAlphas(alphas, 1, false, 0.016, false);
    expect(stillMoving).toBe(true);
    expect(alphas[0]).toBeLessThan(1);
    expect(alphas[0]).toBeGreaterThan(0.48);
    expect(alphas[1]).toBeGreaterThan(0.48);
    expect(alphas[1]).toBeLessThan(1);

    // Snapping converges immediately to exact targets (Float32Array 32-bit precision)
    stepLineAlphas(alphas, 1, false, 0.016, true);
    expect(alphas[1]).toBeCloseTo(getTargetLineAlpha(1, 1, false), 5);
    expect(alphas[0]).toBeCloseTo(getTargetLineAlpha(0, 1, false), 5);
  });

  it('uses ctx.clip() sweep in karaoke mode and zero clip() in minimalist line mode', () => {
    const doc = layoutLyricLines(
      sampleLines,
      {
        viewportWidth: 500,
        viewportHeight: 600,
        fontSize: 'standard',
        showTranslation: true,
      },
      fakeMeasure,
    );
    const alphas = new Float32Array([1, 0.48]);

    const makeMockCtx = () => {
      const calls: string[] = [];
      const ctx = {
        font: '',
        fillStyle: '',
        textBaseline: 'top',
        textAlign: 'left',
        globalCompositeOperation: 'source-over',
        clearRect: () => calls.push('clearRect'),
        fillText: () => calls.push('fillText'),
        fillRect: () => calls.push('fillRect'),
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        beginPath: () => calls.push('beginPath'),
        rect: () => calls.push('rect'),
        clip: () => calls.push('clip'),
      } as unknown as CanvasRenderingContext2D;
      return { ctx, calls };
    };

    const karaokeRun = makeMockCtx();
    renderLyricCanvas({
      ctx: karaokeRun.ctx,
      doc,
      viewportWidth: 500,
      viewportHeight: 600,
      scrollY: 0,
      activeIndex: 0,
      nowMs: 2000,
      alphas,
      renderMode: 'karaoke',
      edgeMaskGradient: {} as CanvasGradient,
    });
    expect(karaokeRun.calls).toContain('clip');
    expect(karaokeRun.calls).toContain('fillRect'); // destination-in edge mask

    const lineRun = makeMockCtx();
    renderLyricCanvas({
      ctx: lineRun.ctx,
      doc,
      viewportWidth: 500,
      viewportHeight: 600,
      scrollY: 0,
      activeIndex: 0,
      nowMs: 2000,
      alphas,
      renderMode: 'line',
      edgeMaskGradient: null,
    });
    expect(lineRun.calls).not.toContain('clip');
    expect(lineRun.calls).toContain('fillText');
  });
});

describe('v2.5.3 Explicit Portrait Lock, Landscape Back-Priority & Lyric Style Store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
  });

  it('exits landscape mode BEFORE closing NowPlaying on hardware Back and restores portrait on close', async () => {
    const ui = useUiStore();
    ui.nowPlayingOpen = true;
    ui.setNowPlayingLandscape(true);
    expect(ui.nowPlayingLandscape).toBe(true);

    // 1st Back press exits fullscreen landscape while staying in NowPlaying
    expect(ui.closeTopOverlay()).toBe(true);
    expect(ui.nowPlayingLandscape).toBe(false);
    expect(ui.nowPlayingOpen).toBe(true);

    // 2nd Back press closes NowPlaying
    expect(ui.closeTopOverlay()).toBe(true);
    expect(ui.nowPlayingOpen).toBe(false);

    // Re-open in landscape and close NowPlaying directly -> watcher must auto-restore portrait
    ui.nowPlayingOpen = true;
    ui.setNowPlayingLandscape(true);
    ui.nowPlayingOpen = false;
    await Promise.resolve();
    expect(ui.nowPlayingLandscape).toBe(false);
  });

  it('persists, exports, imports, and sanitizes settings.lyricRenderMode', () => {
    const settings = useSettingsStore();
    expect(settings.lyricRenderMode).toBe('karaoke');

    settings.lyricRenderMode = 'line';
    const snap = settings.exportSnapshot();
    expect(snap.lyricRenderMode).toBe('line');

    settings.lyricRenderMode = 'karaoke';
    settings.importSnapshot(snap);
    expect(settings.lyricRenderMode).toBe('line');

    settings.importSnapshot({ lyricRenderMode: 'invalid-mode' as unknown as 'karaoke' });
    expect(settings.lyricRenderMode).toBe('karaoke');
  });
});

describe('v2.5.3 Native Portrait Lock, Anti-Flicker & UI Unification Gates', () => {
  it('enforces global portrait lock in AndroidManifest & native orientation bridge in Kotlin', () => {
    const manifest = readRel('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:screenOrientation="portrait"');

    const mainAct = readRel('android/app/src/main/java/com/xhd2005/puretone/MainActivity.kt');
    expect(mainAct).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES');

    const sysPlugin = readRel('android/app/src/main/java/com/xhd2005/puretone/plugins/EchoSystemPlugin.kt');
    expect(sysPlugin).toContain('fun setScreenOrientation');
    expect(sysPlugin).toContain('SCREEN_ORIENTATION_SENSOR_LANDSCAPE');
    expect(sysPlugin).toContain('SCREEN_ORIENTATION_PORTRAIT');
    expect(sysPlugin).toContain('WindowInsetsControllerCompat');
  });

  it('guarantees zero-reflow floating NowPlaying controls & global anti-flicker discipline', () => {
    const npVue = readRel('src/components/NowPlayingSheet.vue');
    expect(npVue).toContain('data-enter-landscape-btn');
    expect(npVue).toContain('ui.nowPlayingLandscape');
    expect(npVue).not.toContain('matchMedia(\'(orientation: landscape)');
    expect(npVue).not.toContain('max-height: 240px');
    expect(npVue).not.toContain('max-height: 0');
    expect(npVue).not.toContain(':global(.dark)');

    const appShell = readRel('src/layouts/AppShell.vue');
    expect(appShell).not.toContain('is-receded');
    expect(appShell).not.toContain('color-mix(');

    const css = readRel('src/styles/apple-music.css');
    const sheetBlock = css.slice(css.indexOf('.am-sheet-enter-active'), css.indexOf('.lg-modal-enter-active'));
    expect(sheetBlock).not.toContain('border-radius');
    expect(sheetBlock).not.toContain('scale(0.965)');
    const tabBlock = css.slice(css.indexOf('.ios-tab-enter-active'), css.indexOf('.ios-switch'));
    expect(tabBlock).not.toContain('scale3d(');

    const audioSheet = readRel('src/components/AudioEffectSheet.vue');
    expect(audioSheet).toContain('name="lg-modal"');
    expect(audioSheet).toContain('lg-sheet-slide');
    expect(audioSheet).toContain('useDraggableSheet');
    expect(audioSheet).toContain('ios-switch');
    expect(audioSheet).toContain('<SegmentedControl');
    expect(audioSheet).not.toContain('name="lg-sheet"');
    expect(audioSheet).not.toContain('ae-switch');

    const pluginDetail = readRel('src/components/PluginDetailSheet.vue');
    expect(pluginDetail).toContain('lg-sheet-slide');
    expect(pluginDetail).toContain('<SegmentedControl');

    const accountSheet = readRel('src/components/AccountVipSheet.vue');
    expect(accountSheet).toContain('data-lyric-render-mode-setting');
    expect(accountSheet).toContain('<SegmentedControl');

    const libView = readRel('src/views/LibraryView.vue');
    expect(libView).not.toContain('backdrop-blur-md');

    const searchView = readRel('src/views/SearchView.vue');
    expect(searchView).not.toContain('backdrop-blur-md');

    const dailyView = readRel('src/views/DailyRecommendView.vue');
    expect(dailyView).toContain('useCollapsingTitle');
    expect(dailyView).toContain('rounded-[14px]');

    const songRow = readRel('src/components/SongRow.vue');
    expect(songRow).not.toContain('color-mix(');

    const statsChart = readRel('src/components/ListeningStatsChart.vue');
    expect(statsChart).not.toContain('color-mix(');
  });

  it('ships complete v2.5.3 i18n keys across zh-CN, zh-TW, and en', () => {
    const keys = [
      'np.enterLandscape',
      'np.exitLandscape',
      'np.landscapeStudio',
      'np.landscapeArtCover',
      'np.landscapeArtVinyl',
      'settings.lyricRenderMode',
      'settings.lyricModeKaraoke',
      'settings.lyricModeLine',
    ] as const;
    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
  });
});
