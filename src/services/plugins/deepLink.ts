import type { PendingPluginInstallIntent } from './types';

/**
 * Normalizes a user-supplied plugin registry URL:
 * - Accepts direct HTTPS `melune-registry.json` URLs.
 * - Accepts GitHub repository URLs (e.g. `https://github.com/owner/repo` or `owner/repo`)
 *   and automatically expands them to `https://raw.githubusercontent.com/owner/repo/main/melune-registry.json`.
 * - Rejects non-HTTPS schemes (cleartext HTTP, file://, javascript:, data:).
 */
export function normalizeRegistryUrl(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';

  // Allow shorthand `owner/repo`
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://raw.githubusercontent.com/${trimmed}/main/melune-registry.json`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'https:') return '';

  const host = parsed.hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com') {
    const segs = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (segs.length >= 2) {
      const owner = segs[0];
      const repo = segs[1].replace(/\.git$/i, '');
      // Handle `/owner/repo/blob/<branch>/<path>`
      if (segs[2] === 'blob' && segs.length >= 5) {
        const branch = segs[3];
        const filePath = segs.slice(4).join('/');
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      }
      // Handle `/owner/repo/tree/<branch>`
      if (segs[2] === 'tree' && segs.length >= 4) {
        const branch = segs[3];
        const subPath = segs.slice(4).join('/');
        const base = subPath ? `${subPath.replace(/\/+$/, '')}/melune-registry.json` : 'melune-registry.json';
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${base}`;
      }
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/melune-registry.json`;
    }
  }

  return parsed.toString();
}

/**
 * Parses a MELUNE extension deep link:
 * - `melune://ext/install?registry=<httpsUrl>&id=<pluginId>`
 * - `melune://ext/registry?url=<httpsUrl>`
 * Rejects any unsafe or non-HTTPS target URL.
 */
export function parseMeluneExtensionDeepLink(rawUri: string): PendingPluginInstallIntent | null {
  const clean = String(rawUri || '').trim();
  if (!clean.toLowerCase().startsWith('melune://')) return null;

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return null;
  }

  if (parsed.protocol.toLowerCase() !== 'melune:') return null;
  if (parsed.hostname.toLowerCase() !== 'ext') return null;

  const actionPath = parsed.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (actionPath === 'registry') {
    const rawUrl = parsed.searchParams.get('url') || parsed.searchParams.get('registry') || '';
    const registryUrl = normalizeRegistryUrl(rawUrl);
    if (!registryUrl) return null;
    return { kind: 'registry', registryUrl };
  }

  if (actionPath === 'install') {
    const rawReg = parsed.searchParams.get('registry') || parsed.searchParams.get('source') || '';
    const registryUrl = normalizeRegistryUrl(rawReg);
    if (!registryUrl) return null;
    const rawId = String(parsed.searchParams.get('id') || '').trim();
    if (rawId && !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(rawId)) return null;
    return {
      kind: rawId ? 'plugin' : 'registry',
      registryUrl,
      pluginId: rawId || undefined,
    };
  }

  return null;
}

/**
 * Builds a shareable `melune://` deep link for a plugin or registry.
 */
export function buildMelunePluginShareLink(registryUrl: string, pluginId?: string): string {
  const norm = normalizeRegistryUrl(registryUrl);
  if (!norm) return '';
  if (pluginId) {
    return `melune://ext/install?registry=${encodeURIComponent(norm)}&id=${encodeURIComponent(pluginId)}`;
  }
  return `melune://ext/registry?url=${encodeURIComponent(norm)}`;
}
