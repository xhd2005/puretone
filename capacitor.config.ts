import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xhd2005.puretone',
  appName: 'MELUNE',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#0B1336',
    webContentsDebuggingEnabled: true,
  },
};

export default config;
