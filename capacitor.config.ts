// Android wrapper configuration. Run `npm run android:sync` after web or native dependency changes.
// The APK loads the owner-private MailBox Manager test Site; update `server.url` only when the cloud URL changes.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.faidlix.mailboxmanager',
  appName: 'MailBox Manager',
  webDir: 'public',
  server: {
    url: 'https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/#inbox',
    cleartext: false,
    allowNavigation: ['mailbox-manager-test.fantasy02dreamer08.chatgpt.site'],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
