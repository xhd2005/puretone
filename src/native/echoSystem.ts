import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  imeBottom: number;
}

export interface AppLaunchFlags {
  autoClaim: boolean;
  versionName: string;
  versionCode: number;
}

export interface EchoSystemPluginInterface {
  kvGet(options: { key: string }): Promise<{ value: string | null }>;
  kvSet(options: { key: string; value: string }): Promise<void>;
  kvDelete(options: { key: string }): Promise<void>;
  kvKeys(options: { prefix?: string }): Promise<{ keys: string[] }>;
  getInsets(): Promise<SafeAreaInsets>;
  setStatusBarStyle(options: { darkIcons: boolean }): Promise<void>;
  moveToBackground(): Promise<void>;
  getLaunchFlags(): Promise<AppLaunchFlags>;
  scheduleDailyReminder(options: { hour: number; minute: number }): Promise<{ scheduled: boolean }>;
  cancelDailyReminder(): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  copyToClipboard(options: { text: string }): Promise<void>;
  isWeChatInstalled(): Promise<{ installed: boolean }>;
  launchWeChatScanWithQr(options: { base64Image: string }): Promise<{ launched: boolean; savedToGallery: boolean; message?: string }>;
  shareQrToWeChat(options: { base64Image: string }): Promise<{ launched: boolean; message?: string }>;
  addListener(eventName: 'insetsChange', listener: (insets: SafeAreaInsets) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'hardwareBack', listener: () => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'autoClaimIntent', listener: () => void): Promise<PluginListenerHandle>;
}

const EchoSystemNative = registerPlugin<EchoSystemPluginInterface>('EchoSystem');

const STORAGE_PREFIX = 'echo_mobile_kv:';

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

  async moveToBackground(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.moveToBackground().catch(() => {});
    }
  },

  async getLaunchFlags(): Promise<AppLaunchFlags> {
    if (Capacitor.isNativePlatform()) {
      return EchoSystemNative.getLaunchFlags();
    }
    return { autoClaim: false, versionName: '1.0.0', versionCode: 1 };
  },

  async scheduleDailyReminder(hour: number, minute: number): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const perm = await EchoSystemNative.requestNotificationPermission().catch(() => ({ granted: true }));
      if (!perm.granted) return false;
      const res = await EchoSystemNative.scheduleDailyReminder({ hour, minute });
      return Boolean(res?.scheduled);
    }
    return true;
  },

  async cancelDailyReminder(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await EchoSystemNative.cancelDailyReminder().catch(() => {});
    }
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

  async launchWeChatScanWithQr(
    base64Image: string,
  ): Promise<{ launched: boolean; savedToGallery: boolean; message?: string }> {
    if (!Capacitor.isNativePlatform()) {
      return { launched: false, savedToGallery: false, message: '仅支持在 Android 真机拉起微信' };
    }
    return EchoSystemNative.launchWeChatScanWithQr({ base64Image });
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

  async onAutoClaimIntent(cb: () => void): Promise<() => void> {
    if (Capacitor.isNativePlatform()) {
      const h = await EchoSystemNative.addListener('autoClaimIntent', cb);
      return () => void h.remove();
    }
    return () => {};
  },
};
