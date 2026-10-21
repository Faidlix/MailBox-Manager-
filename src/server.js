import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, googleRedirectUri } from './config.js';
import { createVault } from './crypto.js';
import { listMessages, openDatabase } from './db.js';
import { createMailService } from './mail-service.js';
import { gmailAuthUrl, gmailExchangeCode } from './providers/gmail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { db, q } = openDatabase(config.dbPath);
const vault = createVault(path.join(config.dataDir, '.vault-key'));
const mail = createMailService({ db, q, vault, syncLimit: config.syncLimit });
const pendingOAuth = new Map();
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(root, 'public')));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const required = (body, names) => {
  for (const name of names) if (!body[name] || (Array.isArray(body[name]) && body[name].length === 0)) throw Object.assign(new Error(`缺少必要欄位：${name}`), { status: 400 });
};
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const parseAddresses = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
  .map((address) => address.trim()).filter(Boolean);
const validateAddresses = (addresses, field) => {
  if (addresses.some((address) => !emailPattern.test(address))) throw Object.assign(new Error(`${field}包含無效的 Email 地址`), { status: 400 });
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/accounts', (_req, res) => res.json(q.listAccounts.all()));

app.post('/api/accounts/gmail/auth-url', (req, res) => {
  required(req.body, ['clientId', 'clientSecret']);
  const state = randomUUID();
  const secret = { clientId: req.body.clientId.trim(), clientSecret: req.body.clientSecret.trim() };
  pendingOAuth.set(state, { secret, createdAt: Date.now() });
  for (const [key, value] of pendingOAuth) if (Date.now() - value.createdAt > 10 * 60_000) pendingOAuth.delete(key);
  res.json({ url: gmailAuthUrl(secret, googleRedirectUri, state) });
});

app.get('/api/oauth/google/callback', asyncRoute(async (req, res) => {
  const pending = pendingOAuth.get(req.query.state);
  if (!pending || !req.query.code) throw Object.assign(new Error('OAuth 狀態已失效，請回到程式重新連線'), { status: 400 });
  pendingOAuth.delete(req.query.state);
  const profile = await gmailExchangeCode(pending.secret, googleRedirectUri, req.query.code);
  const encrypted = vault.seal({ ...pending.secret, tokens: profile.tokens });
  const existing = q.getAccountByEmail.get(profile.email);
  if (existing) q.updateAccount.run('gmail', profile.displayName, encrypted, profile.email);
  else q.insertAccount.run('gmail', profile.email, profile.displayName, encrypted);
  res.type('html').send('<!doctype html><meta charset="utf-8"><title>連線成功</title><style>body{font:18px system-ui;background:#f5f7f2;padding:10vh;text-align:center}div{background:white;padding:40px;border-radius:20px;max-width:520px;margin:auto}</style><div><h1>信箱已連線</h1><p>可以關閉此頁，回到 MailBox Manager 同步郵件。</p></div>');
}));

app.post('/api/accounts/imap', (req, res) => {
  required(req.body, ['email', 'password', 'imapHost', 'smtpHost']);
  const email = req.body.email.trim().toLowerCase();
  validateAddresses([email], 'Email');
  const secret = {
    username: (req.body.username || email).trim(),
    password: req.body.password,
    imap: { host: req.body.imapHost.trim(), port: Number(req.body.imapPort || 993), secure: req.body.imapSecure !== false, folder: 'INBOX' },
    smtp: { host: req.body.smtpHost.trim(), port: Number(req.body.smtpPort || 465), secure: req.body.smtpSecure !== false },
  };
  const encrypted = vault.seal(secret);
  const existing = q.getAccountByEmail.get(email);
  if (existing) q.updateAccount.run('imap', req.body.displayName || '', encrypted, email);
  else q.insertAccount.run('imap', email, req.body.displayName || '', encrypted);
  res.status(201).json({ ok: true });
});

app.delete('/api/accounts/:id', (req, res) => {
  q.deleteAccount.run(Number(req.params.id));
  res.status(204).end();
});

app.post('/api/accounts/:id/sync', asyncRoute(async (req, res) => res.json(await mail.syncAccount(Number(req.params.id)))));
app.post('/api/sync', asyncRoute(async (_req, res) => {
  const results = [];
  for (const account of q.listAccounts.all()) {
    try { results.push({ ...(await mail.syncAccount(account.id)), ok: true }); }
    catch (error) { results.push({ accountId: account.id, ok: false, error: error.message }); }
  }
  res.json(results);
}));

app.get('/api/messages', (req, res) => res.json(listMessages(db, req.query)));
app.get('/api/messages/:id', (req, res) => {
  const message = q.getMessage.get(Number(req.params.id));
  if (!message) return res.status(404).json({ error: '找不到郵件' });
  res.json({ ...message, recipients: JSON.parse(message.recipients), labels: JSON.parse(message.labels) });
});
app.patch('/api/messages/:id/read', asyncRoute(async (req, res) => {
  await mail.setRead(Number(req.params.id), Boolean(req.body.read));
  res.json({ ok: true });
}));
app.patch('/api/messages/:id/star', asyncRoute(async (req, res) => {
  await mail.setStarred(Number(req.params.id), Boolean(req.body.starred));
  res.json({ ok: true });
}));
app.patch('/api/messages/:id/move', asyncRoute(async (req, res) => {
  await mail.move(Number(req.params.id), String(req.body.folder || '').toUpperCase());
  res.json({ ok: true });
}));
app.patch('/api/messages/:id/archive', asyncRoute(async (req, res) => {
  await mail.archive(Number(req.params.id));
  res.json({ ok: true });
}));
app.get('/api/messages/:id/download', asyncRoute(async (req, res) => {
  const { raw, subject } = await mail.getRaw(Number(req.params.id));
  const filename = `${String(subject || 'message').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80)}.eml`;
  res.setHeader('Content-Type', 'message/rfc822');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(raw);
}));
app.delete('/api/messages/:id', asyncRoute(async (req, res) => {
  await mail.trash(Number(req.params.id));
  res.status(204).end();
}));

app.post('/api/send', asyncRoute(async (req, res) => {
  required(req.body, ['accountId', 'to', 'subject']);
  const to = parseAddresses(req.body.to);
  const cc = parseAddresses(req.body.cc);
  validateAddresses(to, '收件者');
  validateAddresses(cc, '副本');
  if (/[\r\n]/.test(req.body.subject)) throw Object.assign(new Error('主旨不可包含換行字元'), { status: 400 });
  await mail.send(Number(req.body.accountId), { ...req.body, to, cc, subject: String(req.body.subject).slice(0, 998) });
  res.status(202).json({ ok: true });
}));

app.get('/api/rules', (_req, res) => res.json(q.listRules.all()));
app.post('/api/rules', (req, res) => {
  required(req.body, ['name', 'field', 'operator', 'value', 'category']);
  const allowedFields = ['sender', 'subject', 'both'];
  const allowedOperators = ['contains', 'equals', 'regex'];
  if (!allowedFields.includes(req.body.field) || !allowedOperators.includes(req.body.operator)) return res.status(400).json({ error: '規則格式錯誤' });
  const result = q.insertRule.run(req.body.name, req.body.field, req.body.operator, req.body.value, req.body.category);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.delete('/api/rules/:id', (req, res) => { q.deleteRule.run(Number(req.params.id)); res.status(204).end(); });

app.use('/api', (_req, res) => res.status(404).json({ error: '找不到 API' }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : `操作失敗：${error.message}` });
});

const server = app.listen(config.port, config.host, (error) => {
  if (error) {
    console.error(`MailBox Manager 無法啟動：${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`MailBox Manager 已啟動：http://${config.host}:${config.port}`);
});

server.on('error', (error) => {
  console.error(`MailBox Manager 伺服器錯誤：${error.message}`);
});
