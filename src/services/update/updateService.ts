import { nativeHttpRequest } from '@/native/echoHttp';
import { echoSystem } from '@/native/echoSystem';

export const APP_REPO = 'xhd2005/puretone';
export const APP_REPO_URL = `https://github.com/${APP_REPO}`;
export const APP_RELEASES_URL = `${APP_REPO_URL}/releases`;
export const APP_AUTHOR = 'xhd2005';
export const FALLBACK_APP_VERSION = '2.1.0';

const LAST_CHECK_KEY = 'update.lastCheckAt.v1';
const SKIPPED_VERSION_KEY = 'update.skippedVersion.v1';

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
  assets: Array<{ name?: string; browser_download_url?: string; size?: number }>,
): { url: string; fileName: string; sizeBytes: number } | null {
  if (!Array.isArray(assets) || !assets.length) return null;
  const apks = assets.filter(
    (a) => typeof a?.browser_download_url === 'string' && /\.apk$/i.test(String(a?.name || '')),
  );
  if (!apks.length) return null;
  const preferred =
    apks.find((a) => /release/i.test(String(a.name || ''))) ||
    apks.find((a) => /puretone/i.test(String(a.name || ''))) ||
    apks[0];
  return {
    url: String(preferred.browser_download_url || ''),
    fileName: String(preferred.name || 'PureTone-update.apk'),
    sizeBytes: Number(preferred.size || 0),
  };
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

export async function checkForAppUpdate(options: { silent?: boolean; currentVersion?: string } = {}): Promise<ReleaseUpdateInfo | null> {
  const currentVersion = options.currentVersion || (await getCurrentAppVersion());

  if (options.silent) {
    const lastCheck = await echoSystem.kvGetJson<number>(LAST_CHECK_KEY, 0);
    // Check silently at most once every 12 hours
    if (Date.now() - lastCheck < 12 * 60 * 60 * 1000) {
      return null;
    }
  }

  const res = await nativeHttpRequest({
    method: 'GET',
    url: `https://api.github.com/repos/${APP_REPO}/releases/latest`,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `PureTone-Android/${currentVersion}`,
    },
    connectTimeoutMs: 6000,
    readTimeoutMs: 8000,
  });

  if (res.status === 404) {
    return {
      latestVersion: currentVersion,
      currentVersion,
      hasUpdate: false,
      title: `PureTone v${currentVersion}`,
      releaseNotes: '当前已是最新版本。',
      publishedAt: '',
      htmlUrl: APP_RELEASES_URL,
      apkUrl: '',
      apkFileName: '',
      apkSizeBytes: 0,
    };
  }

  if (res.status < 200 || res.status >= 300 || !res.body) {
    throw new Error(`检查更新失败（HTTP ${res.status}）`);
  }

  const data = JSON.parse(res.body);
  const tagName = String(data?.tag_name || data?.name || currentVersion).trim();
  const latestVersion = tagName.replace(/^v/i, '');
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
  const apk = pickReleaseApkAsset(data?.assets || []);

  await echoSystem.kvSetJson(LAST_CHECK_KEY, Date.now());

  if (options.silent && hasUpdate) {
    const skipped = await echoSystem.kvGetJson<string>(SKIPPED_VERSION_KEY, '');
    if (skipped === latestVersion) return null;
  }

  return {
    latestVersion,
    currentVersion,
    hasUpdate,
    title: String(data?.name || `PureTone v${latestVersion}`),
    releaseNotes: String(data?.body || '包含常规体验优化与问题修复。').trim(),
    publishedAt: String(data?.published_at || '').slice(0, 10),
    htmlUrl: String(data?.html_url || APP_RELEASES_URL),
    apkUrl: apk?.url || '',
    apkFileName: apk?.fileName || `PureTone-v${latestVersion}.apk`,
    apkSizeBytes: apk?.sizeBytes || 0,
  };
}

export async function skipUpdateVersion(version: string): Promise<void> {
  await echoSystem.kvSetJson(SKIPPED_VERSION_KEY, version);
}
