import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGoogleOAuthRouter, googleOAuthSettings } from '../src/google-oauth-flow.js';
import { connectGoogleAccount } from '../src/google-account.js';
import { openDatabase } from '../src/db.js';
import { createVault } from '../src/crypto.js';

const origin = 'https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site';
const fake = { MAILBOX_PUBLIC_ORIGIN: origin, GOOGLE_OAUTH_CLIENT_ID: 'unit-test.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'unit-test-server-secret' };

async function fixture(t, overrides = {}) {
  const calls = [], connected = [];
  const app = express();
  app.use(express.json());
  app.use(createGoogleOAuthRouter({
    getSettings: () => googleOAuthSettings(fake),
    exchangeCode: async (...args) => { calls.push(args); return { email: 'person@example.com' }; },
    connectAccount: async (...args) => { connected.push(args); },
    ...overrides,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (pathname, options = {}) => fetch(base + pathname, { redirect: 'manual', ...options });
  const start = async () => {
    const response = await request('/api/accounts/gmail/auth-url', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200);
    const data = await response.json();
    const url = new URL(data.url);
    return { url, cookie: response.headers.get('set-cookie').split(';')[0], response };
  };
  return { request, start, calls, connected };
}

test('Google redirect settings use the registered HTTPS origin and reject unsafe origins', () => {
  assert.equal(googleOAuthSettings(fake).redirectUri, `${origin}/api/oauth/google/callback`);
  assert.throws(() => googleOAuthSettings({ ...fake, MAILBOX_PUBLIC_ORIGIN: 'http://example.com' }));
  assert.throws(() => googleOAuthSettings({ ...fake, MAILBOX_PUBLIC_ORIGIN: `${origin}/evil` }));
  assert.throws(() => googleOAuthSettings({ ...fake, MAILBOX_PUBLIC_ORIGIN: 'https://user:password@example.com' }));
  assert.equal(googleOAuthSettings({}).configured, false);
});

test('authorization URL contains PKCE and callback binds cookie/state, exchanges once, and returns to inbox', async (t) => {
  const f = await fixture(t);
  const { url, cookie, response } = await f.start();
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/oauth/google/callback`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(response.headers.get('set-cookie').includes('Secure'));
  assert.ok(response.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.ok(!url.href.includes(fake.GOOGLE_OAUTH_CLIENT_SECRET));
  const callback = `/api/oauth/google/callback?state=${url.searchParams.get('state')}&code=unit-test-code`;
  const success = await f.request(callback, { headers: { Cookie: cookie } });
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), `${origin}/?gmail=connected#inbox`);
  assert.equal(f.connected.length, 1);
  assert.equal(createHash('sha256').update(f.calls[0][3]).digest('base64url'), url.searchParams.get('code_challenge'));
  const replay = await f.request(callback, { headers: { Cookie: cookie } });
  assert.ok(replay.headers.get('location').includes('gmail=expired'));
  assert.equal(f.calls.length, 1);
});

test('unconfigured service and cross-origin or browser-supplied credentials cannot start OAuth', async (t) => {
  const f = await fixture(t);
  const config = await f.request('/api/oauth/google/config');
  assert.deepEqual(await config.json(), { configured: true });
  const foreign = await f.request('/api/accounts/gmail/auth-url', { method: 'POST', headers: { Origin: 'https://attacker.example' } });
  assert.equal(foreign.status, 403);
  const postedSecret = await f.request('/api/accounts/gmail/auth-url', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientSecret: 'not-accepted' }) });
  assert.equal(postedSecret.status, 400);
  const absent = await fixture(t, { getSettings: () => googleOAuthSettings({ MAILBOX_PUBLIC_ORIGIN: origin }) });
  assert.equal((await absent.request('/api/oauth/google/start')).status, 503);
  assert.equal(f.calls.length, 0);
});

test('missing/wrong binding cookie, expired state and consent cancellation do not exchange codes', async (t) => {
  let time = 1;
  const f = await fixture(t, { now: () => time });
  const first = await f.start();
  const pathname = `/api/oauth/google/callback?state=${first.url.searchParams.get('state')}&code=secret-code`;
  assert.ok((await f.request(pathname)).headers.get('location').includes('gmail=expired'));
  assert.ok((await f.request(pathname, { headers: { Cookie: 'mailbox_google_oauth=wrong-cookie' } })).headers.get('location').includes('gmail=expired'));
  time += 10 * 60_000;
  assert.ok((await f.request(pathname, { headers: { Cookie: first.cookie } })).headers.get('location').includes('gmail=expired'));
  const second = await f.start();
  const denied = await f.request(`/api/oauth/google/callback?state=${second.url.searchParams.get('state')}&error=access_denied`, { headers: { Cookie: second.cookie } });
  assert.equal(denied.headers.get('location'), `${origin}/?gmail=cancelled#inbox`);
  assert.equal(f.calls.length, 0);
});

test('top-level start redirects and callback errors never expose codes, tokens or client secrets', async (t) => {
  const f = await fixture(t, { exchangeCode: async () => { throw new Error('sensitive-token sensitive-code unit-test-server-secret'); } });
  const start = await f.request('/api/oauth/google/start');
  assert.equal(start.status, 303);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const error = await f.request(`/api/oauth/google/callback?state=${state}&code=sensitive-code`, { headers: { Cookie: cookie } });
  assert.equal(error.headers.get('location'), `${origin}/?gmail=failed#inbox`);
  assert.ok(!(await error.text()).includes('sensitive'));
  assert.equal(f.connected.length, 0);
});

test('concurrent callbacks cannot exchange the same state twice', async (t) => {
  let exchanges = 0;
  const f = await fixture(t, { exchangeCode: async () => { exchanges++; await new Promise((resolve) => setTimeout(resolve, 20)); return {}; } });
  const { url, cookie } = await f.start();
  const pathname = `/api/oauth/google/callback?state=${url.searchParams.get('state')}&code=code`;
  const results = await Promise.all([f.request(pathname, { headers: { Cookie: cookie } }), f.request(pathname, { headers: { Cookie: cookie } })]);
  assert.equal(exchanges, 1);
  assert.ok(results.some((response) => response.headers.get('location').includes('gmail=connected')));
  assert.ok(results.some((response) => response.headers.get('location').includes('gmail=expired')));
});

test('reconnect retains account identity and compatible refresh token without storing the client secret', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mailbox-oauth-'));
  const { db, q } = openDatabase(path.join(directory, 'index.db'));
  try {
    const vault = createVault(path.join(directory, '.vault-key'));
    const settings = googleOAuthSettings(fake);
    const profile = { email: 'person@example.com', verifiedEmail: true, displayName: 'Person', tokens: { access_token: 'fake-access-1', refresh_token: 'fake-refresh-1' } };
    connectGoogleAccount({ q, vault }, profile, settings);
    const first = q.getAccountByEmail.get(profile.email);
    connectGoogleAccount({ q, vault }, { ...profile, tokens: { access_token: 'fake-access-2' } }, settings);
    const next = q.getAccountByEmail.get(profile.email);
    assert.equal(first.id, next.id);
    const saved = vault.open(next.secret);
    assert.equal(saved.tokens.refresh_token, 'fake-refresh-1');
    assert.equal(saved.tokens.access_token, 'fake-access-2');
    assert.equal(saved.clientSecret, undefined);
    assert.equal(saved.oauthManaged, true);
    assert.ok(!next.secret.includes('fake-refresh-1'));
    assert.throws(() => connectGoogleAccount({ q, vault }, { ...profile, verifiedEmail: false }, settings));
    assert.throws(() => connectGoogleAccount({ q, vault }, { ...profile, tokens: { access_token: 'partial', scope: 'openid email' } }, settings));
    assert.throws(() => connectGoogleAccount({ q, vault }, { ...profile, tokens: { access_token: 'other' } }, { ...settings, clientId: 'different-client' }));
    assert.equal(q.getAccountByEmail.get(profile.email).secret, next.secret);
    q.insertAccount.run('imap', 'another@example.com', 'Existing', vault.seal({ password: 'fake-password' }));
    assert.throws(() => connectGoogleAccount({ q, vault }, { ...profile, email: 'another@example.com' }, settings));
    assert.equal(q.getAccountByEmail.get('another@example.com').provider, 'imap');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
