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
    q.upsertMessage.run(Number(account.lastInsertRowid), 'remote-1', 'thread-1', 'INBOX', 'Example Bank', 'bank@example.com', '[]', '信用卡帳單', '本期帳單', '內容', '', new Date().toISOString(), 0, 0, 0, '[]');
    const result = listMessages(db, { search: '帳單', unread: 'true' });
    assert.equal(result.length, 1);
    assert.equal(result[0].account_email, 'me@example.com');
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
