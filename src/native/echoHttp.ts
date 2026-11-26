import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeHttpRequestOptions {
  requestId?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: 'utf8' | 'base64';
  responseType?: 'text' | 'base64';
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  followRedirects?: boolean;
}

export interface NativeHttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  setCookies: string[];
  body: string;
  bodyEncoding: 'utf8' | 'base64';
}

export interface EchoHttpPluginInterface {
  request(options: NativeHttpRequestOptions): Promise<NativeHttpResponse>;
  cancel(options: { requestId: string }): Promise<void>;
}

const EchoHttpNative = registerPlugin<EchoHttpPluginInterface>('EchoHttp');

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function nativeHttpRequest(options: NativeHttpRequestOptions): Promise<NativeHttpResponse> {
  if (Capacitor.isNativePlatform()) {
    return EchoHttpNative.request(options);
  }
  // Web browser / Vitest fallback
  const controller = new AbortController();
  const timeoutMs = options.readTimeoutMs ?? 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let bodyPayload: BodyInit | undefined;
    if (options.body !== undefined && options.method.toUpperCase() !== 'GET' && options.method.toUpperCase() !== 'HEAD') {
      if (options.bodyEncoding === 'base64') {
        const bin = atob(options.body);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        bodyPayload = bytes;
      } else {
        bodyPayload = options.body;
      }
    }
    const res = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: bodyPayload,
      redirect: options.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const setCookies: string[] = [];
    const sc = headers['set-cookie'];
    if (sc) setCookies.push(sc);

    if (options.responseType === 'base64') {
      const ab = await res.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
      return {
        status: res.status,
        url: res.url || options.url,
        headers,
        setCookies,
        body: btoa(bin),
        bodyEncoding: 'base64',
      };
    }

    const text = await res.text();
    return {
      status: res.status,
      url: res.url || options.url,
      headers,
      setCookies,
      body: text,
      bodyEncoding: 'utf8',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function nativeHttpCancel(requestId: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await EchoHttpNative.cancel({ requestId });
  }
}
