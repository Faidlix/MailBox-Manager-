// Android wrapper configuration. Run `npm run android:sync` after web or native dependency changes.
// Load bundled public/ assets. Do not point the APK at the private Sites login gate.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.faidlix.mailboxmanager',
  appName: 'MailBox Manager',
  webDir: 'public',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
