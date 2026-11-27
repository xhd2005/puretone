import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  imeBottom: number;
}

export interface AppLaunchFlags {
  openNowPlaying: boolean;
  versionName: string;
  versionCode: number;
}

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection' | 'success';

export interface UpdateDownloadCandidate {
  url: string;
  label: string;
}

export interface UpdateDownloadProgressEvent {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  done: boolean;
  sourceLabel?: string;
  error?: string;
}

export interface EchoSystemPluginInterface {
  kvGet(options: { key: string }): Promise<{ value: string | null }>;
  kvSet(options: { key: string; value: string }): Promise<void>;
  kvDelete(options: { key: string }): Promise<void>;
  kvKeys(options: { prefix?: string }): Promise<{ keys: string[] }>;
  getInsets(): Promise<SafeAreaInsets>;
  setStatusBarStyle(options: { darkIcons: boolean }): Promise<void>;
  haptic(options: { style?: HapticStyle }): Promise<void>;
  moveToBackground(): Promise<void>;
  getLaunchFlags(): Promise<AppLaunchFlags>;
  checkNotificationPermission(): Promise<{ granted: boolean; systemEnabled: boolean; runtimeGranted: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  openAppNotificationSettings(): Promise<{ opened: boolean }>;
  openAppDetailsSettings(): Promise<{ opened: boolean }>;
  openExternalUrl(options: { url: string }): Promise<{ opened: boolean }>;
  downloadAndInstallApk(options: {
    url?: string;
    candidates?: UpdateDownloadCandidate[];
    fileName?: string;
    expectedSha256?: string;
  }): Promise<{
    started: boolean;
    needsInstallPermission?: boolean;
    message?: string;
  }>;
  copyToClipboard(options: { text: string }): Promise<void>;
  isWeChatInstalled(): Promise<{ installed: boolean }>;
  launchKugouWithQr(options: { base64Image: string }): Promise<{
    launched: boolean;
    savedToGallery: boolean;
    appName?: string;
    message?: string;
  }>;
  launchWeChatScanWithQr(options: { base64Image: string }): Promise<{
    launched: boolean;
    savedToGallery: boolean;
    message?: string;
  }>;
  saveImageToGallery(options: { base64Image: string; fileName?: string }): Promise<{ saved: boolean }>;
  shareImage(options: { base64Image: string; title?: string }): Promise<{ launched: boolean; message?: string }>;
  shareQrToWeChat(options: { base64Image: string }): Promise<{ launched: boolean; message?: string }>;
  addListener(eventName: 'insetsChange', listener: (insets: SafeAreaInsets) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'hardwareBack', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'openNowPlayingIntent', listener: () => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'updateDownloadProgress',
    listener: (ev: UpdateDownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const EchoSystemNative = registerPlugin<EchoSystemPluginInterface>('EchoSystem');

const STORAGE_PREFIX = 'puretone_kv:';

function getWebStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export const echoSystem = {
  async kvGetJson<T>(key: string, fallback: T): Promise<T> {
    try {
      let raw: string | null = null;
      if (Capacitor.isNativePlatform()) {
        const res = await EchoSystemNative.kvGet({ key });
        raw = res?.value ?? null;
      } else {
        raw = getWebStorage()?.getItem(STORAGE_PREFIX + key) ?? null;
      }
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  async kvSetJson(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.kvSet({ key, value: serialized });
    } else {
      getWebStorage()?.setItem(STORAGE_PREFIX + key, serialized);
    }
  },

  async kvDelete(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.kvDelete({ key });
    } else {
      getWebStorage()?.removeItem(STORAGE_PREFIX + key);
    }
  },

  async getInsets(): Promise<SafeAreaInsets> {
    if (Capacitor.isNativePlatform()) {
      return EchoSystemNative.getInsets();
    }
    return { top: 0, bottom: 0, left: 0, right: 0, imeBottom: 0 };
  },

  async setStatusBarStyle(darkIcons: boolean): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.setStatusBarStyle({ darkIcons }).catch(() => {});
    }
  },

  haptic(style: HapticStyle = 'light'): void {
    if (Capacitor.isNativePlatform()) {
      void EchoSystemNative.haptic({ style }).catch(() => {});
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(style === 'heavy' ? 18 : style === 'medium' ? 10 : 6);
    }
  },

  async moveToBackground(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.moveToBackground().catch(() => {});
    }
  },

  async getLaunchFlags(): Promise<AppLaunchFlags> {
    if (Capacitor.isNativePlatform()) {
      return EchoSystemNative.getLaunchFlags();
    }
    return { openNowPlaying: false, versionName: '2.4.1', versionCode: 8 };
  },

  async checkNotificationPermission(): Promise<{ granted: boolean; systemEnabled: boolean; runtimeGranted: boolean }> {
    if (Capacitor.isNativePlatform()) {
      return EchoSystemNative.checkNotificationPermission().catch(() => ({
        granted: false,
        systemEnabled: false,
        runtimeGranted: false,
      }));
    }
    return { granted: true, systemEnabled: true, runtimeGranted: true };
  },

  async requestNotificationPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const res = await EchoSystemNative.requestNotificationPermission().catch(() => ({ granted: false }));
      return Boolean(res?.granted);
    }
    return true;
  },

  async openAppNotificationSettings(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const res = await EchoSystemNative.openAppNotificationSettings().catch(() => ({ opened: false }));
    return Boolean(res?.opened);
  },

  async openAppDetailsSettings(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const res = await EchoSystemNative.openAppDetailsSettings().catch(() => ({ opened: false }));
    return Boolean(res?.opened);
  },

  async openExternalUrl(url: string): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const res = await EchoSystemNative.openExternalUrl({ url }).catch(() => ({ opened: false }));
      return Boolean(res?.opened);
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
      return true;
    }
    return false;
  },

  async downloadAndInstallApk(
    urlOrOptions:
      | string
      | {
          url?: string;
          candidates?: UpdateDownloadCandidate[];
          fileName?: string;
          expectedSha256?: string;
        },
    fileName?: string,
  ): Promise<{ started: boolean; needsInstallPermission?: boolean; message?: string }> {
    const opts =
      typeof urlOrOptions === 'string'
        ? { url: urlOrOptions, fileName }
        : urlOrOptions;
    const primaryUrl = opts.candidates?.[0]?.url || opts.url || '';
    if (!Capacitor.isNativePlatform()) {
      if (typeof window !== 'undefined' && primaryUrl) window.open(primaryUrl, '_blank', 'noopener');
      return { started: false, message: '已在浏览器打开下载链接' };
    }
    return EchoSystemNative.downloadAndInstallApk(opts);
  },

  async onUpdateDownloadProgress(cb: (ev: UpdateDownloadProgressEvent) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoSystemNative.addListener('updateDownloadProgress', cb);
      return () => void h.remove();
    }
    return () => {};
  },

  async copyToClipboard(text: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.copyToClipboard({ text });
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  },

  async isWeChatInstalled(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    const res = await EchoSystemNative.isWeChatInstalled().catch(() => ({ installed: false }));
    return Boolean(res?.installed);
  },

  async launchKugouWithQr(
    base64Image: string,
  ): Promise<{ launched: boolean; savedToGallery: boolean; appName?: string; message?: string }> {
    if (!Capacitor.isNativePlatform()) {
      return { launched: false, savedToGallery: false, message: '请使用手机端酷狗扫描二维码登录' };
    }
    return EchoSystemNative.launchKugouWithQr({ base64Image });
  },

  async launchWeChatScanWithQr(
    base64Image: string,
  ): Promise<{ launched: boolean; savedToGallery: boolean; message?: string }> {
    if (!Capacitor.isNativePlatform()) {
      return { launched: false, savedToGallery: false, message: '仅支持在 Android 真机拉起微信' };
    }
    return EchoSystemNative.launchWeChatScanWithQr({ base64Image });
  },

  async saveImageToGallery(base64Image: string, fileName?: string): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const res = await EchoSystemNative.saveImageToGallery({ base64Image, fileName }).catch(() => ({ saved: false }));
      return Boolean(res?.saved);
    }
    if (typeof document !== 'undefined') {
      const a = document.createElement('a');
      a.href = base64Image;
      a.download = fileName || `MELUNE_Poster_${Date.now()}.png`;
      a.click();
      return true;
    }
    return false;
  },

  async shareImage(base64Image: string, title = '分享歌词海报'): Promise<{ launched: boolean; message?: string }> {
    if (Capacitor.isNativePlatform()) {
      return EchoSystemNative.shareImage({ base64Image, title }).catch(() => ({ launched: false, message: '分享失败' }));
    }
    const ok = await this.saveImageToGallery(base64Image);
    return { launched: ok, message: ok ? '已保存高清海报图片' : '浏览器暂不支持系统分享' };
  },

  async shareQrToWeChat(base64Image: string): Promise<{ launched: boolean; message?: string }> {
    if (!Capacitor.isNativePlatform()) {
      return { launched: false, message: '仅支持在 Android 真机分享至微信' };
    }
    return EchoSystemNative.shareQrToWeChat({ base64Image });
  },

  async onInsetsChange(cb: (insets: SafeAreaInsets) => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoSystemNative.addListener('insetsChange', cb);
      return () => void h.remove();
    }
    return () => {};
  },

  async onHardwareBack(cb: () => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoSystemNative.addListener('hardwareBack', cb);
      return () => void h.remove();
    }
    return () => {};
  },

  async onOpenNowPlayingIntent(cb: () => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoSystemNative.addListener('openNowPlayingIntent', cb);
      return () => void h.remove();
    }
    return () => {};
  },
};
