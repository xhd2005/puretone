import { nativeHttpRequest } from '@/native/echoHttp';
import { echoSystem, type UpdateDownloadCandidate } from '@/native/echoSystem';
import type { UpdateMirrorMode } from '@/stores/settings';

export const APP_REPO = 'xhd2005/puretone';
export const APP_REPO_URL = `https://github.com/${APP_REPO}`;
export const APP_RELEASES_URL = `${APP_REPO_URL}/releases`;
export const APP_AUTHOR = 'xhd2005';
export const FALLBACK_APP_VERSION = '2.5.0';

const LAST_CHECK_KEY = 'update.lastCheckAt.v1';
const SKIPPED_VERSION_KEY = 'update.skippedVersion.v1';

const UPDATES_RAW_MANIFEST_URL = `https://raw.githubusercontent.com/${APP_REPO}/updates/latest.json`;
const GITHUB_RELEASES_LATEST_API = `https://api.github.com/repos/${APP_REPO}/releases/latest`;

export interface MirrorNode {
  id: string;
  label: string;
  prefix: string;
}

export const BUILTIN_CHINA_MIRRORS: readonly MirrorNode[] = [
  { id: 'ghfast', label: '国内加速 · ghfast', prefix: 'https://ghfast.top/' },
  { id: 'ghproxy', label: '国内加速 · gh-proxy', prefix: 'https://gh-proxy.com/' },
  { id: 'akams', label: '国内加速 · akams', prefix: 'https://github.akams.cn/' },
  { id: 'ghproxynet', label: '国内加速 · ghproxy', prefix: 'https://ghproxy.net/' },
] as const;

const JSDELIVR_MANIFEST_NODES: readonly UpdateDownloadCandidate[] = [
  { label: 'CDN · fastly', url: `https://fastly.jsdelivr.net/gh/${APP_REPO}@updates/latest.json` },
  { label: 'CDN · jsDelivr', url: `https://cdn.jsdelivr.net/gh/${APP_REPO}@updates/latest.json` },
  { label: 'CDN · gcore', url: `https://gcore.jsdelivr.net/gh/${APP_REPO}@updates/latest.json` },
] as const;

export interface ReleaseUpdateInfo {
  latestVersion: string;
  currentVersion: string;
  hasUpdate: boolean;
  title: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  apkUrl: string;
  apkFileName: string;
  apkSizeBytes: number;
  apkSha256?: string;
  downloadCandidates: UpdateDownloadCandidate[];
  checkedVia?: string;
}

export interface LatestManifestPayload {
  version: string;
  tag?: string;
  title?: string;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
  apkFileName?: string;
  apkSizeBytes?: number;
  apkSha256?: string;
  githubDownloadUrl?: string;
}

export function normalizeMirrorPrefix(raw?: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  // Strictly enforce HTTPS for update mirrors (never permit cleartext HTTP MITM downgrade)
  if (!/^https:\/\//i.test(trimmed)) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function wrapWithMirrorPrefix(prefix: string, targetUrl: string): string {
  const cleanPrefix = normalizeMirrorPrefix(prefix);
  if (!cleanPrefix || !targetUrl) return targetUrl;
  return `${cleanPrefix}${targetUrl}`;
}

export function normalizeSemver(version: string): [number, number, number] {
  const clean = String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const parts = clean.split('.').map((p) => Number.parseInt(p, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Returns > 0 if `a > b`, 0 if equal, < 0 if `a < b`.
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeSemver(a);
  const pb = normalizeSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function pickReleaseApkAsset(
  assets: Array<{ name?: string; browser_download_url?: string; size?: number; digest?: string }>,
): { url: string; fileName: string; sizeBytes: number; sha256?: string } | null {
  if (!Array.isArray(assets) || !assets.length) return null;
  const apks = assets.filter(
    (a) => typeof a?.browser_download_url === 'string' && /\.apk$/i.test(String(a?.name || '')),
  );
  if (!apks.length) return null;
  const preferred =
    apks.find((a) => /release/i.test(String(a.name || ''))) ||
    apks.find((a) => /melune|puretone/i.test(String(a.name || ''))) ||
    apks[0];
  const rawDigest = String(preferred.digest || '').trim();
  const shaMatch = rawDigest.match(/^(?:sha256:)?([0-9a-f]{64})$/i);
  return {
    url: String(preferred.browser_download_url || ''),
    fileName: String(preferred.name || 'MELUNE-update.apk'),
    sizeBytes: Number(preferred.size || 0),
    sha256: shaMatch ? shaMatch[1].toLowerCase() : undefined,
  };
}

export function buildManifestCandidateUrls(
  mode: UpdateMirrorMode = 'auto',
  customMirror = '',
): Array<{ url: string; label: string; kind: 'manifest' | 'github-api' }> {
  const out: Array<{ url: string; label: string; kind: 'manifest' | 'github-api' }> = [];
  const seen = new Set<string>();
  const push = (url: string, label: string, kind: 'manifest' | 'github-api') => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, label, kind });
  };

  const customPrefix = normalizeMirrorPrefix(customMirror);
  if (customPrefix) {
    push(wrapWithMirrorPrefix(customPrefix, UPDATES_RAW_MANIFEST_URL), '自定义加速节点', 'manifest');
  }

  if (mode !== 'direct') {
    for (const m of BUILTIN_CHINA_MIRRORS) {
      push(wrapWithMirrorPrefix(m.prefix, UPDATES_RAW_MANIFEST_URL), m.label, 'manifest');
    }
    for (const cdn of JSDELIVR_MANIFEST_NODES) {
      push(cdn.url, cdn.label, 'manifest');
    }
  }

  push(UPDATES_RAW_MANIFEST_URL, 'GitHub Raw 直连', 'manifest');
  push(GITHUB_RELEASES_LATEST_API, 'GitHub API 直连', 'github-api');
  return out;
}

export function buildApkDownloadCandidates(
  githubApkUrl: string,
  mode: UpdateMirrorMode = 'auto',
  customMirror = '',
  options: { apkSha256?: string; requireSha256ForMirrors?: boolean } = {},
): UpdateDownloadCandidate[] {
  const cleanUrl = String(githubApkUrl || '').trim();
  if (!cleanUrl || !/^https:\/\//i.test(cleanUrl)) return [];

  const out: UpdateDownloadCandidate[] = [];
  const seen = new Set<string>();
  const push = (url: string, label: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, label });
  };

  const isGithubHost = /^https:\/\/(?:github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i.test(
    cleanUrl,
  );
  const hasValidSha256 = /^[0-9a-f]{64}$/i.test(String(options.apkSha256 || '').trim());
  const mirrorsAllowed = !options.requireSha256ForMirrors || hasValidSha256;
  const customPrefix = normalizeMirrorPrefix(customMirror);

  if (mirrorsAllowed && customPrefix && isGithubHost) {
    push(wrapWithMirrorPrefix(customPrefix, cleanUrl), '自定义加速节点');
  }
  if (mirrorsAllowed && mode !== 'direct' && isGithubHost) {
    for (const m of BUILTIN_CHINA_MIRRORS) {
      push(wrapWithMirrorPrefix(m.prefix, cleanUrl), m.label);
    }
  }
  push(cleanUrl, 'GitHub 直连');
  return out;
}

export function parseLatestManifestJson(rawBody: string): LatestManifestPayload | null {
  try {
    const data = JSON.parse(rawBody);
    if (!data || typeof data !== 'object') return null;
    const version = String(data.version ?? data.tag ?? '')
      .trim()
      .replace(/^v/i, '');
    if (!version || !/^\d+\.\d+\.\d+/.test(version)) return null;
    const shaRaw = String(data.apkSha256 ?? data.sha256 ?? '').trim().toLowerCase();
    return {
      version,
      tag: String(data.tag || `v${version}`).trim(),
      title: String(data.title || `MELUNE v${version}`).trim(),
      releaseNotes: String(data.releaseNotes ?? data.notes ?? '').trim(),
      publishedAt: String(data.publishedAt || '').slice(0, 10),
      htmlUrl: String(data.htmlUrl || `${APP_RELEASES_URL}/tag/v${version}`).trim(),
      apkFileName: String(data.apkFileName || `MELUNE-v${version}-release.apk`).trim(),
      apkSizeBytes: Number(data.apkSizeBytes || 0) || 0,
      apkSha256: /^[0-9a-f]{64}$/.test(shaRaw) ? shaRaw : undefined,
      githubDownloadUrl: String(
        data.githubDownloadUrl ||
          `${APP_REPO_URL}/releases/download/v${version}/${String(data.apkFileName || `MELUNE-v${version}-release.apk`).trim()}`,
      ).trim(),
    };
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getCurrentAppVersion(): Promise<string> {
  try {
    const flags = await echoSystem.getLaunchFlags();
    if (flags?.versionName) return flags.versionName;
  } catch {
    // ignore
  }
  return FALLBACK_APP_VERSION;
}

export function shouldPromptAutoUpdate(
  info: Pick<ReleaseUpdateInfo, 'hasUpdate' | 'latestVersion'> | null | undefined,
  skippedVersion = '',
): boolean {
  if (!info || !info.hasUpdate) return false;
  const latest = String(info.latestVersion || '').trim();
  const skipped = String(skippedVersion || '').trim();
  if (!latest) return false;
  return !skipped || skipped !== latest;
}

export async function checkForAppUpdate(
  options: {
    silent?: boolean;
    currentVersion?: string;
    mirrorMode?: UpdateMirrorMode;
    customMirror?: string;
  } = {},
): Promise<ReleaseUpdateInfo | null> {
  const currentVersion = options.currentVersion || (await getCurrentAppVersion());
  const mirrorMode = options.mirrorMode || 'auto';
  const customMirror = options.customMirror || '';

  const endpoints = buildManifestCandidateUrls(mirrorMode, customMirror);
  let resolvedInfo: ReleaseUpdateInfo | null = null;
  let lastStatus = 0;

  for (const ep of endpoints) {
    try {
      const res = await nativeHttpRequest({
        method: 'GET',
        url: ep.url,
        headers: {
          Accept: ep.kind === 'github-api' ? 'application/vnd.github+json' : 'application/json',
          'User-Agent': `MELUNE-Android/${currentVersion}`,
          'Cache-Control': 'no-cache',
        },
        connectTimeoutMs: 4500,
        readTimeoutMs: 6000,
      });

      lastStatus = res.status;
      if (res.status < 200 || res.status >= 300 || !res.body) {
        continue;
      }

      if (ep.kind === 'manifest') {
        const manifest = parseLatestManifestJson(res.body);
        if (!manifest) continue;
        const latestVersion = manifest.version;
        const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
        const rawApkUrl = manifest.githubDownloadUrl || '';
        const downloadCandidates = buildApkDownloadCandidates(rawApkUrl, mirrorMode, customMirror, {
          apkSha256: manifest.apkSha256,
          requireSha256ForMirrors: true,
        });
        resolvedInfo = {
          latestVersion,
          currentVersion,
          hasUpdate,
          title: manifest.title || `MELUNE v${latestVersion}`,
          releaseNotes: manifest.releaseNotes || '包含常规体验优化与问题修复。',
          publishedAt: manifest.publishedAt || '',
          htmlUrl: manifest.htmlUrl || APP_RELEASES_URL,
          apkUrl: downloadCandidates[0]?.url || rawApkUrl,
          apkFileName: manifest.apkFileName || `MELUNE-v${latestVersion}-release.apk`,
          apkSizeBytes: manifest.apkSizeBytes || 0,
          apkSha256: manifest.apkSha256,
          downloadCandidates,
          checkedVia: ep.label,
        };
        break;
      } else {
        const data = JSON.parse(res.body);
        const tagName = String(data?.tag_name || data?.name || currentVersion).trim();
        const latestVersion = tagName.replace(/^v/i, '');
        const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
        const apk = pickReleaseApkAsset(data?.assets || []);
        const rawApkUrl = apk?.url || '';
        const downloadCandidates = buildApkDownloadCandidates(rawApkUrl, mirrorMode, customMirror, {
          apkSha256: apk?.sha256,
          requireSha256ForMirrors: true,
        });
        resolvedInfo = {
          latestVersion,
          currentVersion,
          hasUpdate,
          title: String(data?.name || `MELUNE v${latestVersion}`),
          releaseNotes: String(data?.body || '包含常规体验优化与问题修复。').trim(),
          publishedAt: String(data?.published_at || '').slice(0, 10),
          htmlUrl: String(data?.html_url || APP_RELEASES_URL),
          apkUrl: downloadCandidates[0]?.url || rawApkUrl,
          apkFileName: apk?.fileName || `MELUNE-v${latestVersion}-release.apk`,
          apkSizeBytes: apk?.sizeBytes || 0,
          apkSha256: apk?.sha256,
          downloadCandidates,
          checkedVia: ep.label,
        };
        break;
      }
    } catch {
      // Automatically fail over to next Mainland mirror / CDN / direct endpoint
    }
  }

  if (!resolvedInfo) {
    throw new Error(
      lastStatus > 0
        ? `全部更新节点暂不可达（HTTP ${lastStatus}），请稍后重试或配置自定义镜像`
        : '网络连接超时，请在「偏好设置 → 更新线路」配置自定义镜像或稍后重试',
    );
  }

  await echoSystem.kvSetJson(LAST_CHECK_KEY, Date.now());

  if (options.silent) {
    const skipped = await echoSystem.kvGetJson<string>(SKIPPED_VERSION_KEY, '');
    if (!shouldPromptAutoUpdate(resolvedInfo, skipped)) return null;
  }

  return resolvedInfo;
}

export async function skipUpdateVersion(version: string): Promise<void> {
  await echoSystem.kvSetJson(SKIPPED_VERSION_KEY, version);
}

export async function clearSkippedUpdateVersion(): Promise<void> {
  await echoSystem.kvDelete(SKIPPED_VERSION_KEY);
}
