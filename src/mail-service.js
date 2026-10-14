import { googleRedirectUri } from './config.js';
import { applyRules } from './rules.js';
import { gmailArchive, gmailGetRaw, gmailSend, gmailSetRead, gmailSync, gmailTrash } from './providers/gmail.js';
import { imapArchive, imapGetRaw, imapSetRead, imapSync, imapTrash, smtpSend } from './providers/imap.js';

export function createMailService({ db, q, vault, syncLimit }) {
  const secretFor = (account) => vault.open(account.secret);

  function saveMessage(accountId, message) {
    q.upsertMessage.run(
      accountId, message.remoteId, message.threadId, message.folder, message.senderName, message.senderEmail,
      JSON.stringify(message.recipients), message.subject, message.snippet, message.textBody, message.htmlBody,
      message.receivedAt, Number(message.isRead), Number(message.isStarred), Number(message.hasAttachments), JSON.stringify(message.labels),
    );
    const local = db.prepare('SELECT * FROM messages WHERE account_id=? AND remote_id=?').get(accountId, message.remoteId);
    const category = applyRules(local, q.listRules.all());
    q.updateCategory.run(category, local.id);
  }

  async function syncAccount(id) {
    const account = q.getAccount.get(id);
    if (!account) throw Object.assign(new Error('找不到信箱帳號'), { status: 404 });
    const secret = secretFor(account);
    const messages = account.provider === 'gmail'
      ? await gmailSync(secret, googleRedirectUri, syncLimit)
      : await imapSync(secret, syncLimit);
    db.exec('BEGIN');
    try {
      for (const message of messages) saveMessage(account.id, message);
      q.touchAccount.run(account.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { accountId: account.id, count: messages.length };
  }

  async function setRead(messageId, read) {
    const message = q.getMessage.get(messageId);
    if (!message) throw Object.assign(new Error('找不到郵件'), { status: 404 });
    const account = q.getAccount.get(message.account_id);
    const secret = secretFor(account);
    if (account.provider === 'gmail') await gmailSetRead(secret, googleRedirectUri, message.remote_id, read);
    else await imapSetRead(secret, message.remote_id, read);
    q.setMessageRead.run(Number(read), messageId);
  }

  async function trash(messageId) {
    const message = q.getMessage.get(messageId);
    if (!message) throw Object.assign(new Error('找不到郵件'), { status: 404 });
    const account = q.getAccount.get(message.account_id);
    const secret = secretFor(account);
    if (account.provider === 'gmail') await gmailTrash(secret, googleRedirectUri, message.remote_id);
    else await imapTrash(secret, message.remote_id);
    q.setMessageFolder.run('TRASH', messageId);
  }

  async function archive(messageId) {
    const message = q.getMessage.get(messageId);
    if (!message) throw Object.assign(new Error('找不到郵件'), { status: 404 });
    const account = q.getAccount.get(message.account_id);
    const secret = secretFor(account);
    if (account.provider === 'gmail') await gmailArchive(secret, googleRedirectUri, message.remote_id);
    else await imapArchive(secret, message.remote_id, message.folder);
    q.setMessageFolder.run('ARCHIVE', messageId);
  }

  async function getRaw(messageId) {
    const message = q.getMessage.get(messageId);
    if (!message) throw Object.assign(new Error('找不到郵件'), { status: 404 });
    const account = q.getAccount.get(message.account_id);
    const secret = secretFor(account);
    const raw = account.provider === 'gmail'
      ? await gmailGetRaw(secret, googleRedirectUri, message.remote_id)
      : await imapGetRaw(secret, message.remote_id, message.folder);
    return { raw, subject: message.subject };
  }

  async function send(accountId, message) {
    const account = q.getAccount.get(accountId);
    if (!account) throw Object.assign(new Error('找不到寄件帳號'), { status: 404 });
    const secret = secretFor(account);
    if (account.provider === 'gmail') await gmailSend(secret, googleRedirectUri, account, message);
    else await smtpSend(secret, account, message);
  }

  return { syncAccount, setRead, trash, archive, getRaw, send };
}
