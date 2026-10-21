import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL CHECK(provider IN ('gmail', 'imap')),
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      remote_id TEXT NOT NULL,
      thread_id TEXT,
      folder TEXT NOT NULL DEFAULT 'INBOX',
      sender_name TEXT NOT NULL DEFAULT '',
      sender_email TEXT NOT NULL DEFAULT '',
      recipients TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '(無主旨)',
      snippet TEXT NOT NULL DEFAULT '',
      text_body TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '未分類',
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, remote_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id);
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      field TEXT NOT NULL CHECK(field IN ('sender', 'subject', 'both')),
      operator TEXT NOT NULL CHECK(operator IN ('contains', 'equals', 'regex')),
      value TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const q = {
    listAccounts: db.prepare('SELECT id, provider, email, display_name, enabled, last_synced_at, created_at FROM accounts ORDER BY email'),
    getAccount: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    getAccountByEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    insertAccount: db.prepare('INSERT INTO accounts(provider,email,display_name,secret) VALUES(?,?,?,?)'),
    updateAccount: db.prepare('UPDATE accounts SET provider=?, display_name=?, secret=?, enabled=1 WHERE email=?'),
    touchAccount: db.prepare('UPDATE accounts SET last_synced_at=CURRENT_TIMESTAMP WHERE id=?'),
    deleteAccount: db.prepare('DELETE FROM accounts WHERE id=?'),
    upsertMessage: db.prepare(`INSERT INTO messages(
      account_id,remote_id,thread_id,folder,sender_name,sender_email,recipients,subject,snippet,text_body,html_body,
      received_at,is_read,is_starred,has_attachments,labels
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,remote_id) DO UPDATE SET
      folder=excluded.folder,sender_name=excluded.sender_name,sender_email=excluded.sender_email,
      recipients=excluded.recipients,subject=excluded.subject,snippet=excluded.snippet,text_body=excluded.text_body,
      html_body=excluded.html_body,received_at=excluded.received_at,is_read=excluded.is_read,
      is_starred=excluded.is_starred,has_attachments=excluded.has_attachments,labels=excluded.labels,
      updated_at=CURRENT_TIMESTAMP`),
    getMessage: db.prepare(`SELECT m.*, a.email account_email, a.provider FROM messages m JOIN accounts a ON a.id=m.account_id WHERE m.id=?`),
    setMessageRead: db.prepare('UPDATE messages SET is_read=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'),
    setMessageStarred: db.prepare('UPDATE messages SET is_starred=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'),
    setMessageFolder: db.prepare('UPDATE messages SET folder=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'),
    deleteMessage: db.prepare('DELETE FROM messages WHERE id=?'),
    listRules: db.prepare('SELECT * FROM rules ORDER BY id DESC'),
    insertRule: db.prepare('INSERT INTO rules(name,field,operator,value,category) VALUES(?,?,?,?,?)'),
    deleteRule: db.prepare('DELETE FROM rules WHERE id=?'),
    updateCategory: db.prepare('UPDATE messages SET category=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'),
  };

  return { db, q };
}

export function listMessages(db, filters = {}) {
  const where = [];
  const params = {};
  if (filters.accountId) { where.push('m.account_id=:accountId'); params.accountId = Number(filters.accountId); }
  const state = filters.state || (filters.unread === 'true' ? 'unread' : 'all');
  if (state === 'unread') where.push('m.is_read=0');
  if (state === 'starred') where.push('m.is_starred=1');
  if (state === 'archive') where.push("m.folder='ARCHIVE'");
  if (state === 'spam') where.push("m.folder='SPAM'");
  if (state === 'trash') where.push("m.folder='TRASH'");
  if (filters.category) { where.push('m.category=:category'); params.category = filters.category; }
  if (filters.search) {
    where.push(`(m.subject LIKE :search ESCAPE '\\' OR m.sender_name LIKE :search ESCAPE '\\' OR m.sender_email LIKE :search ESCAPE '\\' OR m.snippet LIKE :search ESCAPE '\\')`);
    params.search = `%${String(filters.search).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 1000, 1), 1000);
  const sql = `SELECT m.id,m.account_id,m.remote_id,m.sender_name,m.sender_email,m.subject,m.snippet,m.received_at,
    m.folder,m.is_read,m.is_starred,m.has_attachments,m.category,a.email account_email,a.provider
    FROM messages m JOIN accounts a ON a.id=m.account_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY datetime(m.received_at) DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}
