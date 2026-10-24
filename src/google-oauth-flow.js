import { Router } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];
const CALLBACK_PATH = '/api/oauth/google/callback';
const COOKIE = 'mailbox_google_oauth';
const TTL = 10 * 60_000;
const digest = (value) => createHash('sha256').update(value).digest();

export function googleOAuthSettings(env = process.env, fallbackOrigin = 'http://127.0.0.1:4141') {
  const url = new URL(env.MAILBOX_PUBLIC_ORIGIN || fallbackOrigin);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MAILBOX_PUBLIC_ORIGIN 必須是 HTTPS 網站來源（本機開發可用 HTTP）');
  }
  const clientId = (env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  return { origin: url.origin, redirectUri: `${url.origin}${CALLBACK_PATH}`, clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

// All OAuth secrets stay server-side. The browser receives an authorization URL
// and an opaque HttpOnly binding cookie, never the client secret or Google tokens.
export function createGoogleOAuthRouter({ getSettings, exchangeCode, connectAccount, now = Date.now }) {
  const router = Router();
  const pending = new Map();
  const cookieOptions = (settings) => ({ httpOnly: true, secure: settings.origin.startsWith('https:'), sameSite: 'lax', path: '/api/oauth/google' });
  const prune = () => { for (const [key, value] of pending) if (now() - value.createdAt >= TTL) pending.delete(key); };
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  router.get('/api/oauth/google/config', (_req, res) => {
    const settings = getSettings();
    res.json({ configured: settings.configured });
  });
  const start = (req, res, redirect = false) => {
    const settings = getSettings();
    if (!settings.configured) return res.status(503).json({ error: 'Google 登入服務尚未啟用，請稍後再試' });
    if (!redirect && req.get('Origin') !== settings.origin) return res.status(403).json({ error: '登入請求來源不符' });
    if (req.body?.clientId || req.body?.clientSecret) return res.status(400).json({ error: '登入設定由服務管理，請更新頁面後重試' });
    prune();
    if (pending.size >= 100) return res.status(429).json({ error: '登入請求過多，請稍後再試' });
    const state = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    pending.set(state, { bindingHash: digest(binding), verifier, createdAt: now(), clientId: settings.clientId, redirectUri: settings.redirectUri });
    res.cookie(COOKIE, binding, { ...cookieOptions(settings), maxAge: TTL });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: settings.clientId, redirect_uri: settings.redirectUri,
      response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: GOOGLE_SCOPES.join(' '), state,
      code_challenge: digest(verifier).toString('base64url'), code_challenge_method: 'S256',
    }).toString();
    if (redirect) return res.redirect(303, url.href);
    return res.json({ url: url.href });
  };
  router.post('/api/accounts/gmail/auth-url', (req, res) => start(req, res));
  router.get('/api/oauth/google/start', (req, res) => start(req, res, true));
  router.get(CALLBACK_PATH, async (req, res) => {
    const settings = getSettings();
    const finish = (status) => {
      res.clearCookie(COOKIE, cookieOptions(settings));
      res.redirect(303, `${settings.origin}/?gmail=${status}#inbox`);
    };
    prune();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const entry = pending.get(state);
    const binding = req.get('Cookie')?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    if (!entry || !binding || !timingSafeEqual(digest(binding), entry.bindingHash)) return finish('expired');
    // Claim before any await: one-time state cannot be replayed or exchanged twice.
    pending.delete(state);
    if (!settings.configured || entry.clientId !== settings.clientId || entry.redirectUri !== settings.redirectUri) return finish('expired');
    if (req.query.error) return finish('cancelled');
    if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return finish('failed');
    try {
      const profile = await exchangeCode(settings, settings.redirectUri, req.query.code, entry.verifier);
      await connectAccount(profile, settings);
      return finish('connected');
    } catch {
      // OAuth SDK errors may contain authorization codes, token payloads or secrets.
      // Never log them or expose them to the browser.
      return finish('failed');
    }
  });
  return router;
}
