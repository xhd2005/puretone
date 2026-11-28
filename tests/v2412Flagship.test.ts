import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  extractQualityHashesFromPrivilege,
  formatVerifiedQualityTag,
  buildAudioCacheKey,
} from '@/services/playback/urlResolver';
import {
  buildApkDownloadCandidates,
  FALLBACK_APP_VERSION,
  normalizeMirrorPrefix,
} from '@/services/update/updateService';
import { buildPureToneBackupJson, parsePureToneBackupJson } from '@/services/backup/backupService';
import { useSettingsStore } from '@/stores/settings';
import { enUS, zhCN, zhTW } from '@/i18n/messages';
import { computeCoverCarouselLayout, computeCoverFlowCardTransform } from '@/utils/heroMorph';

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

describe('v2.4.12 Hi-Res / FLAC / OGG 320 real quality resolution', () => {
  it('separates independent per-tier hashes and never lets 128k hash masquerade as 320k/FLAC/Hi-Res', () => {
    const privBody = {
      data: [
        {
          trans_param: {
            ogg_320_hash: 'OGG320HASH0000000000000000000001',
            ogg_128_hash: 'OGG128HASH0000000000000000000002',
          },
          relate_goods: [
            { level: 2, quality: '128', hash: 'MP3128HASH0000000000000000000003' },
            { level: 4, quality: '320', hash: 'MP3320HASH0000000000000000000004' },
            { level: 5, quality: 'flac', hash: 'FLACHASH000000000000000000000005' },
            { level: 6, quality: 'high', hash: 'HIRESHRASH0000000000000000000006' },
          ],
        },
      ],
    };

    const hashes = extractQualityHashesFromPrivilege(privBody, {
      hash: 'MP3128HASH0000000000000000000003',
    });
    expect(hashes.high).toBe('HIRESHRASH0000000000000000000006');
    expect(hashes.flac).toBe('FLACHASH000000000000000000000005');
    expect(hashes.ogg320).toBe('OGG320HASH0000000000000000000001');
    expect(hashes.mp3320).toBe('MP3320HASH0000000000000000000004');
    expect(hashes.ogg128).toBe('OGG128HASH0000000000000000000002');

    // Song with ONLY 128k hash must leave high/flac/mp3320 undefined (no silent 128k fake 320k!)
    const only128 = extractQualityHashesFromPrivilege({ data: [{ relate_goods: [] }] }, {
      hash: 'ONLY128HASH000000000000000000009',
    });
    expect(only128.high).toBeUndefined();
    expect(only128.flac).toBeUndefined();
    expect(only128.mp3320).toBeUndefined();
    expect(only128.mp3128).toBe('ONLY128HASH000000000000000000009');
  });

  it('honestly formats verified stream badges from actual bitRate and extName', () => {
    expect(formatVerifiedQualityTag({ bitRate: 1720, extName: 'flac' }, 'high')).toEqual({
      quality: 'high',
      sourceTag: 'Hi-Res',
    });
    expect(formatVerifiedQualityTag({ bitRate: 920, extName: 'flac' }, 'flac')).toEqual({
      quality: 'flac',
      sourceTag: '无损 FLAC',
    });
    expect(formatVerifiedQualityTag({ bitRate: 320, extName: 'ogg' }, '320')).toEqual({
      quality: '320',
      sourceTag: 'OGG 320k',
    });
    // Upstream silently returned 128k MP3 even though 320k was requested -> MUST label honestly!
    expect(formatVerifiedQualityTag({ bitRate: 128, extName: 'mp3' }, '320')).toEqual({
      quality: '128',
      sourceTag: '标准 128k',
    });

    const hiResKey = buildAudioCacheKey(
      { id: '1', hash: 'AAAA1111BBBB2222CCCC3333DDDD4444', title: 'Test', artist: 'Artist' },
      'high',
      'Hi-Res',
      false,
    );
    expect(hiResKey).toBe('v2:hash:aaaa1111bbbb2222cccc3333dddd4444:high:official');
  });
});

describe('v2.4.12 Full-Stack Security, Privacy & Open-Source Compliance Hardening', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    setActivePinia(createPinia());
  });

  it('keeps core settings 100% free of built-in VIP auto-claim or scraping toggles (delegated to plugins)', () => {
    const settings = useSettingsStore();
    const snap = settings.exportSnapshot() as unknown as Record<string, unknown>;
    expect(snap.enableUnblock).toBeUndefined();
    expect(snap.autoClaimOnLaunch).toBeUndefined();
    expect(snap.autoClaimAllAccounts).toBeUndefined();
    expect(snap.enableConceptTasks).toBeUndefined();
  });

  it('enforces HTTPS-only update mirrors and mandatory SHA-256 on non-GitHub mirrors', () => {
    expect(normalizeMirrorPrefix('http://insecure.mirror.example')).toBe('');
    expect(normalizeMirrorPrefix('https://secure.mirror.example')).toBe('https://secure.mirror.example/');

    const apkUrl = 'https://github.com/xhd2005/puretone/releases/download/v2.4.12/MELUNE-v2.4.12-release.apk';
    // Missing SHA-256 with requireSha256ForMirrors: true -> ONLY official GitHub direct allowed
    const noSha = buildApkDownloadCandidates(apkUrl, 'auto', 'https://custom.mirror.example/', {
      requireSha256ForMirrors: true,
    });
    expect(noSha).toHaveLength(1);
    expect(noSha[0].url).toBe(apkUrl);

    // Valid 64-char SHA-256 -> mirrors safely unlocked
    const withSha = buildApkDownloadCandidates(apkUrl, 'auto', 'https://custom.mirror.example/', {
      apkSha256: 'a'.repeat(64),
      requireSha256ForMirrors: true,
    });
    expect(withSha.length).toBeGreaterThan(2);
    expect(withSha[0].url).toBe(`https://custom.mirror.example/${apkUrl}`);

    // Cleartext http:// APK URL is always rejected
    expect(buildApkDownloadCandidates('http://github.com/a.apk', 'auto')).toHaveLength(0);
  });

  it('exports MELUNE backup format while remaining 100% compatible with legacy PureTone backups', () => {
    const fresh = buildPureToneBackupJson({ stats: { totalPlays: 5 }, settings: { quality: 'high' }, pinnedSources: {} });
    const parsedFresh = parsePureToneBackupJson(fresh);
    expect(parsedFresh.app).toBe('MELUNE');
    expect(parsedFresh.settings.quality).toBe('high');

    const legacyRaw = JSON.stringify({ app: 'PureTone', schemaVersion: 1, stats: { totalPlays: 9 }, settings: {} });
    const parsedLegacy = parsePureToneBackupJson(legacyRaw);
    expect(parsedLegacy.app).toBe('PureTone');
    expect(parsedLegacy.stats.totalPlays).toBe(9);
  });

  it('verifies hardened native Android configs, pre-consent gate, 120Hz lyrics & redesigned Settings bottom', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

    const capCfg = read('capacitor.config.ts');
    expect(capCfg).toContain('cleartext: false');
    expect(capCfg).toContain('allowMixedContent: false');
    expect(capCfg).toContain('webContentsDebuggingEnabled: false');

    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).not.toContain('android:usesCleartextTraffic="true"');
    expect(manifest).toContain('android:maxSdkVersion="28"');

    const netSec = read('android/app/src/main/res/xml/network_security_config.xml');
    expect(netSec).toContain('cleartextTrafficPermitted="false"');
    expect(netSec).toContain('kugou.com');

    const filePaths = read('android/app/src/main/res/xml/file_paths.xml');
    expect(filePaths).toContain('path="updates/"');
    expect(filePaths).toContain('path="share/"');
    expect(filePaths).not.toContain('path="."');

    const appVue = read('src/App.vue');
    expect(appVue).toContain('<AppShell v-if="complianceReady" />');
    expect(appVue).toContain('deferNetworkRefresh: true');
    expect(appVue).toContain('<AudioEffectSheet />');

    const disclaimerVue = read('src/components/ComplianceDisclaimerModal.vue');
    expect(disclaimerVue).toContain('declineAndExit');
    expect(disclaimerVue).toContain('echoSystem.exitApp()');

    const lyricsVue = read('src/components/KrcLyricsView.vue');
    expect(lyricsVue).toContain('krc-viewport');
    expect(lyricsVue).toContain('SPRING_OMEGA');
    expect(lyricsVue).not.toContain('display: inline-block');

    const settingsVue = read('src/components/AccountVipSheet.vue');
    expect(settingsVue).toContain('data-settings-update');
    expect(settingsVue).toContain('data-settings-about');
    expect(settingsVue).toContain('data-brand-philosophy');
    expect(settingsVue).not.toContain(':global(.dark)');

    const audioSheetVue = read('src/components/AudioEffectSheet.vue');
    expect(audioSheetVue).not.toContain(':global(.dark)');
  });

  it('ships complete v2.4.12 i18n keys across zh-CN, zh-TW, and en', () => {
    const keys = [
      'settings.qualityHigh',
      'settings.groupUpdate',
      'settings.groupAbout',
      'settings.updateStatusLatest',
      'settings.updateStatusNew',
      'audio.sheetTitle',
      'audio.sheetSub',
      'about.authorShortBio',
      'about.philosophyToggle',
      'about.philosophyHint',
      'about.repoTitle',
      'about.disclaimerShort',
      'compliance.declineExit',
      'np.landscapeSplit',
      'np.landscapeVinyl',
      'np.landscapeCoverFlow',
      'np.landscapeCinema',
    ] as const;
    for (const k of keys) {
      expect(zhCN[k].trim().length).toBeGreaterThan(0);
      expect(zhTW[k].trim().length).toBeGreaterThan(0);
      expect(enUS[k].trim().length).toBeGreaterThan(0);
    }
    expect(FALLBACK_APP_VERSION).toBe('2.5.2');
  });

  it('validates 3-card cover swipe physics, 3D Cover Flow math & comment badge removal', () => {
    const rest = computeCoverCarouselLayout(0, 320, 1);
    expect(rest.current.opacity).toBe(1);
    expect(rest.current.transform).toContain('translate3d(0.00px, 0, 0)');

    // Swiping a full stride to the left lands the Next card squarely at center (tx=0, scale=1, opacity=1)
    const committedNext = computeCoverCarouselLayout(-320, 320, 1);
    expect(committedNext.next.opacity).toBe(1);
    expect(committedNext.next.transform).toContain('translate3d(0.00px, 0, 0)');
    expect(committedNext.next.transform).toContain('rotateY(0deg)');

    // 3D Cover Flow geometry: center card faces user flat, side cards fan symmetrically in 3D space
    const center = computeCoverFlowCardTransform(0, 180);
    expect(center.tx).toBe(0);
    expect(center.rotateY).toBe(0);
    expect(center.scale).toBe(1);
    expect(center.zIndex).toBe(50);

    const right = computeCoverFlowCardTransform(1, 180);
    const left = computeCoverFlowCardTransform(-1, 180);
    expect(right.tx).toBeGreaterThan(0);
    expect(left.tx).toBe(-right.tx);
    expect(right.rotateY).toBe(-left.rotateY);
    expect(right.scale).toBeLessThan(1);
    expect(center.zIndex).toBeGreaterThan(right.zIndex);

    const npVue = fs.readFileSync(path.resolve(process.cwd(), 'src/components/NowPlayingSheet.vue'), 'utf8');
    expect(npVue).not.toContain('np-cmt-badge');
    expect(npVue).not.toContain('getSongCommentCount');
    expect(npVue).toContain('computeCoverCarouselLayout');
    expect(npVue).toContain('LandscapeStudioStage');
    expect(npVue).toContain('data-ring-carousel');
    expect(npVue).not.toContain(':global(.dark)');

    const cfVue = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CoverFlowStage.vue'), 'utf8');
    expect(cfVue).toContain('computeCoverFlowCardTransform');
    expect(cfVue).not.toContain(':global(.dark)');
    expect(cfVue).not.toMatch(/\btranslate\s*:/);
  });
});
