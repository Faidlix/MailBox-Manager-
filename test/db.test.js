import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listMessages, openDatabase } from '../src/db.js';

test('stores and searches a unified message index', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mailbox-test-'));
  try {
    const { db, q } = openDatabase(path.join(directory, 'test.db'));
    const account = q.insertAccount.run('gmail', 'me@example.com', 'Me', 'encrypted');
    const inserted = q.upsertMessage.run(Number(account.lastInsertRowid), 'remote-1', 'thread-1', 'INBOX', 'Example Bank', 'bank@example.com', '[]', '信用卡帳單', '本期帳單', '內容', '', new Date().toISOString(), 0, 0, 0, '[]');
    const result = listMessages(db, { search: '帳單', unread: 'true' });
    assert.equal(result.length, 1);
    assert.equal(result[0].account_email, 'me@example.com');
    q.setMessageFolder.run('ARCHIVE', Number(inserted.lastInsertRowid));
    const archived = listMessages(db, { state: 'archive' });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].folder, 'ARCHIVE');
    q.setMessageStarred.run(1, Number(inserted.lastInsertRowid));
    assert.equal(listMessages(db, { state: 'starred' }).length, 1);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('lists up to 1000 messages for a single inbox view', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'mailbox-limit-test-'));
  try {
    const { db, q } = openDatabase(path.join(directory, 'test.db'));
    const account = Number(q.insertAccount.run('gmail', 'bulk@example.com', 'Bulk', 'encrypted').lastInsertRowid);
    const now = new Date().toISOString();
    db.exec('BEGIN');
    for (let index = 0; index < 1000; index += 1) q.upsertMessage.run(account, `remote-${index}`, `thread-${index}`, 'INBOX', 'Sender', 'sender@example.com', '[]', `Message ${index}`, '', '', '', now, 0, 0, 0, '[]');
    db.exec('COMMIT');
    assert.equal(listMessages(db, { state: 'all', limit: 1000 }).length, 1000);
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
