import axios, {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { Buffer } from 'buffer';
import { nativeHttpRequest } from '@/native/echoHttp';

function buildFullUrl(baseURL?: string, url?: string, params?: Record<string, unknown>): string {
  let full = url || '';
  if (baseURL && !/^https?:\/\//i.test(full)) {
    const base = baseURL.replace(/\/+$/, '');
    const rel = full.replace(/^\/+/, '');
    full = `${base}/${rel}`;
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

function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  const obj =
    typeof (raw as AxiosHeaders).toJSON === 'function'
      ? (raw as AxiosHeaders).toJSON(true)
      : (raw as Record<string, unknown>);
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    out[k] = Array.isArray(v) ? v.join('; ') : String(v);
  }
  return out;
}

export const capacitorAxiosAdapter: AxiosAdapter = async (
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> => {
  const method = (config.method || 'GET').toUpperCase();
  const fullUrl = buildFullUrl(config.baseURL, config.url, config.params as Record<string, unknown> | undefined);
  const headers = normalizeHeaders(config.headers);
  const { body, bodyEncoding, contentType } = serializeBody(config.data);

  if (contentType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = contentType;
  }

  const wantsBinary = config.responseType === 'arraybuffer' || config.responseType === 'blob';
  const timeout = typeof config.timeout === 'number' && config.timeout > 0 ? config.timeout : 15000;

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

  const respHeaders: Record<string, unknown> = { ...nativeRes.headers };
  if (Array.isArray(nativeRes.setCookies) && nativeRes.setCookies.length > 0) {
    respHeaders['set-cookie'] = nativeRes.setCookies;
  }

  let parsedData: unknown = nativeRes.body;
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

  const response: AxiosResponse = {
    data: parsedData,
    status: nativeRes.status,
    statusText: String(nativeRes.status),
    headers: respHeaders as AxiosResponse['headers'],
    config,
    request: { responseURL: nativeRes.url },
  };

  const validateStatus = config.validateStatus ?? ((status: number) => status >= 200 && status < 300);
  if (!validateStatus(response.status)) {
    const err = new Error(`Request failed with status code ${response.status}`) as Error & {
      response?: AxiosResponse;
      config?: InternalAxiosRequestConfig;
      status?: number;
    };
    err.response = response;
    err.config = config;
    err.status = response.status;
    throw err;
  }

  return response;
};

let installed = false;
export function installCapacitorAxiosAdapter(): void {
  if (installed) return;
  axios.defaults.adapter = capacitorAxiosAdapter;
  installed = true;
}
