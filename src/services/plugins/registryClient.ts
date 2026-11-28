import { Buffer } from 'buffer';
import cryptoShim from '@/polyfills/nodeCryptoShim';
import { nativeHttpRequest } from '@/native/echoHttp';
import { BUILTIN_CHINA_MIRRORS, wrapWithMirrorPrefix } from '@/services/update/updateService';
import {
  ALL_MELUNE_PERMISSIONS,
  MELUNE_EXT_PROTOCOL,
  MELUNE_REGISTRY_PROTOCOL,
  type MelunePermission,
  type MelunePluginManifest,
  type MeluneRegistryIndex,
} from './types';
import { normalizeRegistryUrl } from './deepLink';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const VALID_PERMISSIONS = new Set<string>(ALL_MELUNE_PERMISSIONS);

export function computeUtf8Sha256Hex(content: string): string {
  return String(cryptoShim.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')).toLowerCase();
}

export function isValidSha256(hash: unknown): hash is string {
  return typeof hash === 'string' && SHA256_HEX_RE.test(hash.trim());
}

export function validatePluginManifest(raw: unknown): MelunePluginManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('插件清单格式无效');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.protocol !== MELUNE_EXT_PROTOCOL) {
    throw new Error(`不支持的插件协议：${String(obj.protocol || 'unknown')}（需 ${MELUNE_EXT_PROTOCOL}）`);
  }
  const id = String(obj.id || '').trim();
  if (!PLUGIN_ID_RE.test(id)) {
    throw new Error(`插件 ID 不合法：${id}`);
  }
  const name = String(obj.name || '').trim();
  const version = String(obj.version || '').trim();
  const author = String(obj.author || '').trim();
  const description = String(obj.description || '').trim();
  if (!name || !version || !author) {
    throw new Error(`插件 ${id} 缺少必要字段（name / version / author）`);
  }
  const sha256 = String(obj.sha256 || '').trim().toLowerCase();
  if (!isValidSha256(sha256)) {
    throw new Error(`插件 ${id} 缺少有效的 64 位 SHA-256 校验值`);
  }
  const rawPerms = Array.isArray(obj.permissions) ? obj.permissions : [];
  const permissions: MelunePermission[] = [];
  for (const p of rawPerms) {
    const s = String(p || '').trim();
    if (!VALID_PERMISSIONS.has(s)) {
      throw new Error(`插件 ${id} 声明了未知权限：${s}`);
    }
    if (!permissions.includes(s as MelunePermission)) {
      permissions.push(s as MelunePermission);
    }
  }
  const entry = obj.entry ? String(obj.entry).trim() : 'index.js';
  const downloadUrl = obj.downloadUrl ? String(obj.downloadUrl).trim() : undefined;
  if (downloadUrl && !/^https:\/\//i.test(downloadUrl)) {
    throw new Error(`插件 ${id} 下载地址必须使用 HTTPS`);
  }
  const cat = String(obj.category || 'utility').trim();
  const category =
    cat === 'audio' || cat === 'lyrics' || cat === 'account' || cat === 'utility' ? cat : 'utility';

  return {
    protocol: MELUNE_EXT_PROTOCOL,
    id,
    name,
    version,
    author,
    license: obj.license ? String(obj.license).trim() : undefined,
    description: description || name,
    icon: obj.icon ? String(obj.icon).trim() : undefined,
    category,
    entry,
    downloadUrl,
    sha256,
    minAppVersion: obj.minAppVersion ? String(obj.minAppVersion).trim() : undefined,
    homepage: obj.homepage && /^https:\/\//i.test(String(obj.homepage)) ? String(obj.homepage).trim() : undefined,
    permissions,
  };
}

export function validateRegistryIndex(raw: unknown): MeluneRegistryIndex {
  if (!raw || typeof raw !== 'object') {
    throw new Error('插件源索引格式无效');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.protocol !== MELUNE_REGISTRY_PROTOCOL) {
    throw new Error(`不支持的插件源协议：${String(obj.protocol || 'unknown')}（需 ${MELUNE_REGISTRY_PROTOCOL}）`);
  }
  const id = String(obj.id || '').trim();
  const name = String(obj.name || '').trim();
  if (!id || !name) {
    throw new Error('插件源缺少 id 或 name');
  }
  const rawPlugins = Array.isArray(obj.plugins) ? obj.plugins : [];
  const plugins = rawPlugins.map((p) => validatePluginManifest(p));

  return {
    protocol: MELUNE_REGISTRY_PROTOCOL,
    id,
    name,
    maintainer: obj.maintainer ? String(obj.maintainer).trim() : undefined,
    description: obj.description ? String(obj.description).trim() : undefined,
    homepage: obj.homepage && /^https:\/\//i.test(String(obj.homepage)) ? String(obj.homepage).trim() : undefined,
    updatedAt: obj.updatedAt ? String(obj.updatedAt).trim() : undefined,
    plugins,
  };
}

/**
 * Builds HTTPS download candidates for GitHub raw assets with China CDN / mirror acceleration.
 */
export function buildMirroredHttpsCandidates(url: string): Array<{ label: string; url: string }> {
  const clean = String(url || '').trim();
  if (!/^https:\/\//i.test(clean)) return [];

  const list: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (label: string, u: string) => {
    if (!u || seen.has(u) || !/^https:\/\//i.test(u)) return;
    seen.add(u);
    list.push({ label, url: u });
  };

  // Detect raw.githubusercontent.com/<owner>/<repo>/<branch>/<path> for jsDelivr CDN
  const rawGh = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i.exec(clean);
  if (rawGh) {
    const [, owner, repo, branch, filePath] = rawGh;
    push('CDN · fastly', `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`);
    push('CDN · jsDelivr', `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`);
    for (const mirror of BUILTIN_CHINA_MIRRORS.slice(0, 2)) {
      push(mirror.label, wrapWithMirrorPrefix(mirror.prefix, clean));
    }
    push('GitHub Raw', clean);
    return list;
  }

  push('HTTPS Direct', clean);
  return list;
}

async function fetchUtf8WithMirrors(url: string, timeoutMs = 8000): Promise<{ body: string; via: string }> {
  const candidates = buildMirroredHttpsCandidates(url);
  if (!candidates.length) {
    throw new Error('仅支持 HTTPS 插件源地址');
  }
  let lastErr = '网络不可达';
  for (const cand of candidates) {
    try {
      const res = await nativeHttpRequest({
        method: 'GET',
        url: cand.url,
        headers: {
          Accept: 'application/json, text/javascript, text/plain, */*',
          'Cache-Control': 'no-cache',
        },
        connectTimeoutMs: 5000,
        readTimeoutMs: timeoutMs,
        followRedirects: true,
      });
      if (res.status >= 200 && res.status < 300 && res.body) {
        return { body: res.body, via: cand.label };
      }
      lastErr = `${cand.label} HTTP ${res.status}`;
    } catch (err: any) {
      lastErr = `${cand.label}: ${err?.message || '连接超时'}`;
    }
  }
  throw new Error(`无法拉取资源（${lastErr}）`);
}

export async function fetchPluginRegistry(rawUrl: string): Promise<{
  registry: MeluneRegistryIndex;
  normalizedUrl: string;
  via: string;
}> {
  const normalizedUrl = normalizeRegistryUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error('无效的插件源地址（需为 HTTPS 链接或 owner/repo 格式）');
  }
  const { body, via } = await fetchUtf8WithMirrors(normalizedUrl, 8500);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('插件源返回的不是有效 JSON 格式');
  }
  const registry = validateRegistryIndex(parsed);
  return { registry, normalizedUrl, via };
}

export function resolvePluginDownloadUrl(manifest: MelunePluginManifest, registryUrl?: string): string {
  if (manifest.downloadUrl && /^https:\/\//i.test(manifest.downloadUrl)) {
    return manifest.downloadUrl;
  }
  if (!registryUrl) {
    throw new Error(`插件 ${manifest.id} 未提供 downloadUrl`);
  }
  const base = registryUrl.replace(/[^/]+$/, '');
  const entry = (manifest.entry || 'index.js').replace(/^\/+/, '');
  const joined = entry.includes('/') ? `${base}${entry}` : `${base}plugins/${manifest.id}/${entry}`;
  if (!/^https:\/\//i.test(joined)) {
    throw new Error('插件下载地址必须为 HTTPS');
  }
  return joined;
}

/**
 * Downloads a plugin bundle via HTTPS (with mirror acceleration) and enforces
 * STRICT SHA-256 verification before returning the code.
 */
export async function downloadAndVerifyPluginBundle(
  manifest: MelunePluginManifest,
  registryUrl?: string,
): Promise<{ code: string; sourceUrl: string; sha256: string; via: string }> {
  const validated = validatePluginManifest(manifest);
  const sourceUrl = resolvePluginDownloadUrl(validated, registryUrl);
  const { body, via } = await fetchUtf8WithMirrors(sourceUrl, 10000);
  const actualSha = computeUtf8Sha256Hex(body);
  if (actualSha !== validated.sha256.toLowerCase()) {
    throw new Error(
      `插件「${validated.name}」SHA-256 校验失败，已阻止安装（期望 ${validated.sha256.slice(0, 12)}…，实际 ${actualSha.slice(0, 12)}…）`,
    );
  }
  return { code: body, sourceUrl, sha256: actualSha, via };
}
