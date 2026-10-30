import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('Gmail and Yahoo expose compact official-login links without credential fields', () => {
  assert.match(app, /id="gmail-provider-title">Gmail<\/h3><button id="gmail-authorize"[^>]*>連結<\/button>/);
  assert.match(app, /id="yahoo-provider-title">Yahoo<\/h3><button id="yahoo-authorize"[^>]*>連結<\/button>/);
  assert.match(app, /globalThis\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(app, /globalThis\.mailBoxNativeOAuth/);
  assert.match(app, /bridge\.startGoogleOAuth \|\| bridge\.startGoogleLogin \|\| bridge\.startGoogle \|\| bridge\.openGoogleOAuth/);
  assert.match(app, /globalThis\.location\.assign\('\/api\/oauth\/google\/start'\)/);
  assert.match(app, /https:\/\/login\.yahoo\.com\//);
  assert.doesNotMatch(app, /Google Client ID<input/);
  assert.doesNotMatch(app, /Google Client Secret<input/);
  assert.doesNotMatch(app, /Yahoo Email<input/);
  assert.doesNotMatch(app, /應用程式密碼<input/);
});
