import { describe, expect, it, vi } from 'vitest';

const mockNativeHttpRequest = vi.fn();

vi.mock('@/native/echoHttp', () => ({
  nativeHttpRequest: (...args: unknown[]) => mockNativeHttpRequest(...args),
  isNativePlatform: () => true,
}));

import axiosShim from '@/services/kugou/axiosShim';

describe('Unified axiosShim routing all ESM & CJS requests to native OkHttp', () => {
  it('builds URL with baseURL + query params, preserves multi Set-Cookie, and auto-parses JSON', async () => {
    mockNativeHttpRequest.mockResolvedValueOnce({
      status: 200,
      url: 'https://login-user.kugou.com/v2/qrcode?appid=3116',
      headers: { 'content-type': 'application/json', 'ssa-code': 'verify_01' },
      setCookies: ['dfid=abc; Path=/', 'kg_mid=123; Path=/'],
      body: '{"status":1,"data":{"qrcode":"key123"}}',
      bodyEncoding: 'utf8',
    });

    const res = await axiosShim({
      baseURL: 'https://login-user.kugou.com',
      url: '/v2/qrcode',
      method: 'GET',
      params: { appid: 3116 },
      headers: { 'User-Agent': 'Android15-KuGou' },
    });

    expect(mockNativeHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://login-user.kugou.com/v2/qrcode?appid=3116',
        headers: expect.objectContaining({ 'User-Agent': 'Android15-KuGou' }),
      }),
    );
    expect(res.data).toEqual({ status: 1, data: { qrcode: 'key123' } });
    expect(res.headers['set-cookie']).toEqual(['dfid=abc; Path=/', 'kg_mid=123; Path=/']);
    expect(res.headers['ssa-code']).toBe('verify_01');
  });

  it('uses extended 35s timeout for WeChat long-polling qrconnect endpoint', async () => {
    mockNativeHttpRequest.mockResolvedValueOnce({
      status: 200,
      url: 'https://long.open.weixin.qq.com/connect/l/qrconnect?f=json&uuid=u1',
      headers: {},
      setCookies: [],
      body: '{"wx_errcode":405,"wx_code":"code_xyz"}',
      bodyEncoding: 'utf8',
    });

    const res = await axiosShim({
      url: 'https://long.open.weixin.qq.com/connect/l/qrconnect?f=json&uuid=u1',
    });

    expect(mockNativeHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ readTimeoutMs: 35000 }),
    );
    expect(res.data).toEqual({ wx_errcode: 405, wx_code: 'code_xyz' });
  });
});
