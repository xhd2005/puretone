import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xhd2005.puretone',
  appName: 'MELUNE',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0B1336',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
