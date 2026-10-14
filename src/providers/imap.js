import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

function imapClient(secret) {
  return new ImapFlow({
    host: secret.imap.host,
    port: secret.imap.port,
    secure: secret.imap.secure,
    auth: { user: secret.username, pass: secret.password },
    logger: false,
  });
}

export async function imapSync(secret, limit) {
  const client = imapClient(secret);
  const messages = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(secret.imap.folder || 'INBOX');
    try {
      if (!client.mailbox.exists) return messages;
      const start = Math.max(1, client.mailbox.exists - limit + 1);
      for await (const message of client.fetch(`${start}:*`, { uid: true, flags: true, source: true, envelope: true, internalDate: true })) {
        const parsed = await simpleParser(message.source);
        messages.push({
          remoteId: String(message.uid),
          threadId: parsed.inReplyTo || parsed.messageId || String(message.uid),
          folder: secret.imap.folder || 'INBOX',
          senderName: parsed.from?.value?.[0]?.name || '',
          senderEmail: parsed.from?.value?.[0]?.address || '',
          recipients: parsed.to?.value?.map((x) => x.address) || [],
          subject: parsed.subject || '(無主旨)',
          snippet: (parsed.text || '').replace(/\s+/g, ' ').slice(0, 280),
          textBody: parsed.text || '',
          htmlBody: typeof parsed.html === 'string' ? parsed.html : '',
          receivedAt: (message.internalDate || parsed.date || new Date()).toISOString(),
          isRead: message.flags.has('\\Seen'),
          isStarred: message.flags.has('\\Flagged'),
          hasAttachments: parsed.attachments.length > 0,
          labels: [...message.flags],
        });
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }
  return messages;
}

export async function imapSetRead(secret, uid, read) {
  const client = imapClient(secret);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(secret.imap.folder || 'INBOX');
    try { await (read ? client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }) : client.messageFlagsRemove(uid, ['\\Seen'], { uid: true })); }
    finally { lock.release(); }
  } finally { await client.logout(); }
}

export async function imapTrash(secret, uid) {
  const client = imapClient(secret);
  await client.connect();
  try {
    const mailboxes = await client.list();
    const trash = mailboxes.find((mailbox) => mailbox.specialUse === '\\Trash');
    const lock = await client.getMailboxLock(secret.imap.folder || 'INBOX');
    try {
      if (trash) await client.messageMove(uid, trash.path, { uid: true });
      else await client.messageDelete(uid, { uid: true });
    } finally { lock.release(); }
  } finally { await client.logout(); }
}

export async function imapArchive(secret, uid, folder = 'INBOX') {
  const client = imapClient(secret);
  await client.connect();
  try {
    const mailboxes = await client.list();
    const archive = mailboxes.find((mailbox) => mailbox.specialUse === '\\Archive')
      || mailboxes.find((mailbox) => /(^|\/)archive$/i.test(mailbox.path));
    let destination = archive?.path;
    if (!destination) {
      destination = 'Archive';
      await client.mailboxCreate(destination);
    }
    if (String(folder).toLocaleLowerCase() === destination.toLocaleLowerCase()) return;
    const lock = await client.getMailboxLock(folder || secret.imap.folder || 'INBOX');
    try { await client.messageMove(uid, destination, { uid: true }); }
    finally { lock.release(); }
  } finally { await client.logout(); }
}

export async function imapGetRaw(secret, uid, folder = 'INBOX') {
  const client = imapClient(secret);
  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder || secret.imap.folder || 'INBOX');
    try {
      const message = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!message?.source) throw Object.assign(new Error('無法取得原始郵件'), { status: 404 });
      return message.source;
    } finally { lock.release(); }
  } finally { await client.logout(); }
}

export async function smtpSend(secret, account, message) {
  const transport = nodemailer.createTransport({
    host: secret.smtp.host,
    port: secret.smtp.port,
    secure: secret.smtp.secure,
    auth: { user: secret.username, pass: secret.password },
    tls: { rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await transport.sendMail({
    from: account.email,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    text: message.text,
    html: message.html || undefined,
    inReplyTo: message.inReplyTo || undefined,
    references: message.inReplyTo ? [message.inReplyTo] : undefined,
  });
}
