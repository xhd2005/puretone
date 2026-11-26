import { Buffer } from 'buffer';
import { nativeHttpRequest } from '@/native/echoHttp';

export interface AxiosLikeConfig {
  method?: string;
  url?: string;
  baseURL?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, unknown>;
  responseType?: string;
  timeout?: number;
  maxRedirects?: number;
  withCredentials?: boolean;
  validateStatus?: (status: number) => boolean;
}

export interface AxiosLikeResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, any>;
  config: AxiosLikeConfig;
  request?: { responseURL?: string };
}

function buildFullUrl(baseURL?: string, url?: string, params?: Record<string, unknown>): string {
  let full = url || '';
  if (baseURL && !/^https?:\/\//i.test(full)) {
    const base = baseURL.replace(/\/+$/, '');
    const rel = full.replace(/^\/+/, '');
    full = rel ? `${base}/${rel}` : base;
  }
  if (params && typeof params === 'object') {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length > 0) {
      const qs = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      full += (full.includes('?') ? '&' : '?') + qs;
    }
  }
  return full;
}

function serializeBody(data: unknown): { body?: string; bodyEncoding?: 'utf8' | 'base64'; contentType?: string } {
  if (data === undefined || data === null) return {};
  if (Buffer.isBuffer(data)) {
    return { body: data.toString('base64'), bodyEncoding: 'base64' };
  }
  if (data instanceof Uint8Array) {
    return { body: Buffer.from(data).toString('base64'), bodyEncoding: 'base64' };
  }
  if (data instanceof ArrayBuffer) {
    return { body: Buffer.from(new Uint8Array(data)).toString('base64'), bodyEncoding: 'base64' };
  }
  if (typeof data === 'string') {
    return { body: data, bodyEncoding: 'utf8' };
  }
  if (typeof data === 'object') {
    return {
      body: JSON.stringify(data),
      bodyEncoding: 'utf8',
      contentType: 'application/json',
    };
  }
  return { body: String(data), bodyEncoding: 'utf8' };
}

function normalizeHeaders(raw?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    out[k] = Array.isArray(v) ? v.join('; ') : String(v);
  }
  return out;
}

/**
 * Unified Axios replacement aliased via Vite for BOTH ESM and CommonJS (`require('axios')`)
 * so every single KuGouMusicApi & WeChat request executes through Android native OkHttp (`EchoHttpPlugin`).
 */
async function axiosShim<T = any>(
  configOrUrl: AxiosLikeConfig | string,
  extraConfig?: AxiosLikeConfig,
): Promise<AxiosLikeResponse<T>> {
  const config: AxiosLikeConfig =
    typeof configOrUrl === 'string' ? { ...(extraConfig || {}), url: configOrUrl } : { ...(configOrUrl || {}) };

  const method = (config.method || 'GET').toUpperCase();
  const fullUrl = buildFullUrl(config.baseURL, config.url, config.params);
  const headers = normalizeHeaders(config.headers);
  const { body, bodyEncoding, contentType } = serializeBody(config.data);

  if (contentType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = contentType;
  }

  const wantsBinary = config.responseType === 'arraybuffer' || config.responseType === 'blob';
  // WeChat long-polling endpoint needs up to 35s read timeout
  const defaultTimeout = fullUrl.includes('long.open.weixin.qq.com') ? 35000 : 15000;
  const timeout = typeof config.timeout === 'number' && config.timeout > 0 ? config.timeout : defaultTimeout;

  const nativeRes = await nativeHttpRequest({
    method,
    url: fullUrl,
    headers,
    body,
    bodyEncoding,
    responseType: wantsBinary ? 'base64' : 'text',
    connectTimeoutMs: Math.min(timeout, 12000),
    readTimeoutMs: timeout,
    followRedirects: config.maxRedirects !== 0,
  });

  const respHeaders: Record<string, any> = { ...nativeRes.headers };
  if (Array.isArray(nativeRes.setCookies) && nativeRes.setCookies.length > 0) {
    respHeaders['set-cookie'] = nativeRes.setCookies;
  }

  let parsedData: any = nativeRes.body;
  if (wantsBinary && nativeRes.bodyEncoding === 'base64') {
    const buf = Buffer.from(nativeRes.body, 'base64');
    parsedData = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } else if (typeof nativeRes.body === 'string' && config.responseType !== 'text') {
    const trimmed = nativeRes.body.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsedData = JSON.parse(trimmed);
      } catch {
        parsedData = nativeRes.body;
      }
    }
  }

  const response: AxiosLikeResponse<T> = {
    data: parsedData,
    status: nativeRes.status,
    statusText: String(nativeRes.status),
    headers: respHeaders,
    config,
    request: { responseURL: nativeRes.url },
  };

  const validateStatus = config.validateStatus ?? ((status: number) => status >= 200 && status < 300);
  if (!validateStatus(response.status)) {
    const err = new Error(`Request failed with status code ${response.status}`) as Error & {
      response?: AxiosLikeResponse<T>;
      config?: AxiosLikeConfig;
      status?: number;
    };
    err.response = response;
    err.config = config;
    err.status = response.status;
    throw err;
  }

  return response;
}

const axiosExport = Object.assign(axiosShim, {
  request: axiosShim,
  get: <T = any>(url: string, config?: AxiosLikeConfig) => axiosShim<T>({ ...(config || {}), url, method: 'GET' }),
  post: <T = any>(url: string, data?: unknown, config?: AxiosLikeConfig) =>
    axiosShim<T>({ ...(config || {}), url, data, method: 'POST' }),
  put: <T = any>(url: string, data?: unknown, config?: AxiosLikeConfig) =>
    axiosShim<T>({ ...(config || {}), url, data, method: 'PUT' }),
  delete: <T = any>(url: string, config?: AxiosLikeConfig) =>
    axiosShim<T>({ ...(config || {}), url, method: 'DELETE' }),
  create: (defaults?: AxiosLikeConfig) => {
    const instance = <T = any>(cfg: AxiosLikeConfig | string) => {
      const merged =
        typeof cfg === 'string' ? { ...(defaults || {}), url: cfg } : { ...(defaults || {}), ...(cfg || {}) };
      return axiosShim<T>(merged);
    };
    return Object.assign(instance, {
      request: instance,
      get: <T = any>(url: string, cfg?: AxiosLikeConfig) => instance<T>({ ...(cfg || {}), url, method: 'GET' }),
      post: <T = any>(url: string, data?: unknown, cfg?: AxiosLikeConfig) =>
        instance<T>({ ...(cfg || {}), url, data, method: 'POST' }),
      defaults: { ...(defaults || {}) },
    });
  },
  defaults: {} as Record<string, unknown>,
  isAxiosError: (err: unknown) => Boolean(err && typeof err === 'object' && 'response' in err),
});

export default axiosExport;
export { axiosShim as request };
export const get = axiosExport.get;
export const post = axiosExport.post;
export const create = axiosExport.create;
export const defaults = axiosExport.defaults;
export const isAxiosError = axiosExport.isAxiosError;
