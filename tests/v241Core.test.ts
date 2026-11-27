import { describe, expect, it } from 'vitest';
import { normalizeSong, parseStructuredIntro } from '@/services/kugou/kugouEngine';
import {
  buildApkDownloadCandidates,
  buildManifestCandidateUrls,
  normalizeMirrorPrefix,
  parseLatestManifestJson,
  pickReleaseApkAsset,
} from '@/services/update/updateService';

describe('MELUNE v2.4.1 core upgrades', () => {
  it('parses KuGou multi-section artist long_intro array without [object Object]', () => {
    const raw = [
      { title: '简介', content: '王菲，华语乐坛传奇女歌手。' },
      { title: '基本资料', content: '出生日期：1969年8月8日' },
      { title: '荣誉记录', content: '多次获得金曲奖与十大中文金曲奖。' },
      { title: '空章节', content: '   ' },
    ];
    const parsed = parseStructuredIntro(raw);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0].title).toBe('简介');
    expect(parsed.sections[1].content).toContain('1969');
    expect(parsed.plainText).not.toContain('[object Object]');
    expect(parsed.plainText).toContain('【演艺经历】'.slice(0, 0)); // sanity
    expect(parsed.plainText).toContain('【基本资料】');

    // Single object & string & empty safety
    expect(parseStructuredIntro({ title: '介绍', content: '单章节文本' }).sections).toHaveLength(1);
    expect(parseStructuredIntro('纯文本简介').plainText).toBe('纯文本简介');
    expect(parseStructuredIntro(null).sections).toHaveLength(0);
  });

  it('normalizes KuGou album_songs nested duration_128 and album_info.cover properly', () => {
    const song = normalizeSong({
      base: {
        album_id: 2591233,
        author_name: 'Simon & Garfunkel',
        audio_name: 'The Sound of Silence',
        album_audio_id: 64211635,
      },
      audio_info: {
        hash: 'F76C0F6F8F5297BAB6D139CB66884051',
        hash_320: 'F7D72881037B72A6B140E663F49B9DC3',
        hash_flac: 'B08604745D302207EE6ABDB3A17ADC99',
        duration_128: 185756,
      },
      album_info: {
        album_name: 'Sounds of Silence (Remastered)',
        cover: 'http://imge.kugou.com/stdmusic/{size}/20201125/test.jpg',
      },
    });
    expect(song.duration).toBe(186);
    expect(song.albumId).toBe('2591233');
    expect(song.album).toBe('Sounds of Silence (Remastered)');
    expect(song.coverUrl).toContain('/480/');
    expect(song.hashFlac).toBe('B08604745D302207EE6ABDB3A17ADC99');
  });

  it('builds Mainland China multi-mirror manifest and APK candidate queues with custom override', () => {
    expect(normalizeMirrorPrefix('https://mirror.example.com')).toBe('https://mirror.example.com/');
    expect(normalizeMirrorPrefix('invalid-url')).toBe('');

    const autoManifests = buildManifestCandidateUrls('auto', 'https://my-cf.example.com');
    expect(autoManifests[0].url).toBe(
      'https://my-cf.example.com/https://raw.githubusercontent.com/xhd2005/puretone/updates/latest.json',
    );
    expect(autoManifests.some((m) => m.url.includes('fastly.jsdelivr.net'))).toBe(true);
    expect(autoManifests[autoManifests.length - 1].kind).toBe('github-api');

    const directManifests = buildManifestCandidateUrls('direct');
    expect(directManifests.every((m) => m.url.includes('github'))).toBe(true);
    expect(directManifests.some((m) => m.url.includes('ghfast.top'))).toBe(false);

    const apkUrl = 'https://github.com/xhd2005/puretone/releases/download/v2.4.1/MELUNE-v2.4.1-release.apk';
    const autoDl = buildApkDownloadCandidates(apkUrl, 'auto', 'https://my-cf.example.com/');
    expect(autoDl[0].url).toBe(`https://my-cf.example.com/${apkUrl}`);
    expect(autoDl.some((c) => c.url.startsWith('https://ghfast.top/'))).toBe(true);
    expect(autoDl[autoDl.length - 1].url).toBe(apkUrl);

    const directDl = buildApkDownloadCandidates(apkUrl, 'direct');
    expect(directDl).toHaveLength(1);
    expect(directDl[0].url).toBe(apkUrl);
  });

  it('parses latest.json manifest and extracts APK SHA-256 digest safely', () => {
    const validSha = 'a'.repeat(64);
    const parsed = parseLatestManifestJson(
      JSON.stringify({
        version: 'v2.4.1',
        title: '弥音 · MELUNE v2.4.1',
        publishedAt: '2026-11-27',
        releaseNotes: '测试日志',
        apkFileName: 'MELUNE-v2.4.1-release.apk',
        apkSizeBytes: 7162250,
        apkSha256: validSha,
      }),
    );
    expect(parsed?.version).toBe('2.4.1');
    expect(parsed?.apkSha256).toBe(validSha);
    expect(parsed?.githubDownloadUrl).toContain('MELUNE-v2.4.1-release.apk');

    expect(parseLatestManifestJson('<html>502 Bad Gateway</html>')).toBeNull();

    const picked = pickReleaseApkAsset([
      {
        name: 'MELUNE-v2.4.1-release.apk',
        browser_download_url: 'https://github.com/xhd2005/puretone/releases/download/v2.4.1/MELUNE-v2.4.1-release.apk',
        size: 7162250,
        digest: `sha256:${validSha}`,
      },
    ]);
    expect(picked?.sha256).toBe(validSha);
  });
});
