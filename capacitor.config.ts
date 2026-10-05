import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.codetoday.fontcraft',
  appName: 'FontCraft',
  webDir: 'dist-android',
  backgroundColor: '#0a0a0b',
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0a0a0b', showSpinner: false },
    Keyboard: { resize: 'body' },
    StatusBar: { style: 'DARK', backgroundColor: '#0a0a0b', overlaysWebView: false },
  },
};

export default config;
