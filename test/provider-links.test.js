import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('Gmail and Yahoo are offered in a compact outside-dismiss provider dialog', () => {
  assert.match(html, /id="provider-dialog"[\s\S]*id="provider-gmail"[\s\S]*Gmail[\s\S]*連結/);
  assert.match(html, /id="provider-yahoo"[\s\S]*Yahoo[\s\S]*連結/);
  assert.match(app, /event\.target === dialog\) dialog\.close/);
  assert.match(app, /globalThis\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(app, /globalThis\.mailBoxNativeOAuth/);
  assert.match(app, /startProviderAuthorization\(provider\)/);
  assert.match(app, /\/api\/oauth\/\$\{provider\}\/start\?client=android/);
  assert.doesNotMatch(app, /https:\/\/login\.yahoo\.com\//);
  assert.doesNotMatch(app, /Google Client ID<input/);
  assert.doesNotMatch(app, /Google Client Secret<input/);
  assert.doesNotMatch(app, /Yahoo Email<input/);
  assert.doesNotMatch(app, /應用程式密碼<input/);
});

test('settings only manages linked accounts and imported remote folders are filterable', () => {
  assert.doesNotMatch(app, /id="gmail-provider-title"|id="yahoo-provider-title"/);
  assert.match(app, /loadFolders\(\)/);
  assert.match(app, /data-folder-id=/);
  assert.match(app, /folderId: inboxFilters\.folderId/);
});
