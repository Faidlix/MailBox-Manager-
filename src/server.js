import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, getGoogleOAuthSettings } from './config.js';
import { createVault } from './crypto.js';
import { listMessages, openDatabase } from './db.js';
import { createMailService } from './mail-service.js';
import { gmailExchangeCode } from './providers/gmail.js';
import { createGoogleOAuthRouter } from './google-oauth-flow.js';
import { connectGoogleAccount } from './google-account.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { db, q } = openDatabase(config.dbPath);
const vault = createVault(path.join(config.dataDir, '.vault-key'));
const mail = createMailService({ db, q, vault, syncLimit: config.syncLimit });
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
app.get('/api/runtime', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ api: true });
});
app.get('/api/accounts', (_req, res) => res.json(q.listAccounts.all()));

app.use(createGoogleOAuthRouter({
  getSettings: getGoogleOAuthSettings,
  exchangeCode: gmailExchangeCode,
  connectAccount: (profile, settings) => connectGoogleAccount({ q, vault }, profile, settings),
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
app.patch('/api/messages/:id/category', (req, res) => {
  const category = String(req.body.category || '未分類').trim().slice(0, 60) || '未分類';
  q.updateCategory.run(category, Number(req.params.id));
  res.json({ ok: true, category });
});
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
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 499 ? error.status : 500;
  console.error('MailBox API request failed', { status });
  res.status(status).json({ error: status < 500 ? error.message : '操作失敗，請稍後再試' });
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
