import { google } from 'googleapis';

function oauth(secret, redirectUri) {
  const client = new google.auth.OAuth2(secret.clientId, secret.clientSecret, redirectUri);
  if (secret.tokens) client.setCredentials(secret.tokens);
  return client;
}

export function gmailAuthUrl(secret, redirectUri, state) {
  return oauth(secret, redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send', 'openid', 'email'],
  });
}

export async function gmailExchangeCode(secret, redirectUri, code) {
  const client = oauth(secret, redirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const identity = google.oauth2({ version: 'v2', auth: client });
  const { data } = await identity.userinfo.get();
  return { tokens, email: data.email, displayName: data.name || '' };
}

function decode(value = '') {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
}

function bodyParts(payload, result = { text: '', html: '', attachments: false }) {
  if (payload?.filename) result.attachments = true;
  if (payload?.mimeType === 'text/plain' && payload.body?.data) result.text += decode(payload.body.data);
  if (payload?.mimeType === 'text/html' && payload.body?.data) result.html += decode(payload.body.data);
  for (const part of payload?.parts || []) bodyParts(part, result);
  return result;
}

function header(payload, name) {
  return payload.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function address(value) {
  const match = value.match(/^(.*?)\s*<([^>]+)>$/);
  return match ? { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2] } : { name: '', email: value.trim() };
}

function mapMessage(data) {
  const content = bodyParts(data.payload);
  const sender = address(header(data.payload, 'From'));
  return {
    remoteId: data.id,
    threadId: data.threadId,
    folder: 'INBOX',
    senderName: sender.name,
    senderEmail: sender.email,
    recipients: header(data.payload, 'To').split(',').map((x) => x.trim()).filter(Boolean),
    subject: header(data.payload, 'Subject') || '(無主旨)',
    snippet: data.snippet || content.text.slice(0, 280),
    textBody: content.text,
    htmlBody: content.html,
    receivedAt: new Date(Number(data.internalDate)).toISOString(),
    isRead: !data.labelIds?.includes('UNREAD'),
    isStarred: data.labelIds?.includes('STARRED'),
    hasAttachments: content.attachments,
    labels: data.labelIds || [],
  };
}

export async function gmailSync(secret, redirectUri, limit) {
  const auth = oauth(secret, redirectUri);
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: limit });
  const messages = [];
  for (const item of list.data.messages || []) {
    const { data } = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
    messages.push(mapMessage(data));
  }
  return messages;
}

export async function gmailSetRead(secret, redirectUri, remoteId, read) {
  const gmail = google.gmail({ version: 'v1', auth: oauth(secret, redirectUri) });
  await gmail.users.messages.modify({ userId: 'me', id: remoteId, requestBody: read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] } });
}

export async function gmailTrash(secret, redirectUri, remoteId) {
  const gmail = google.gmail({ version: 'v1', auth: oauth(secret, redirectUri) });
  await gmail.users.messages.trash({ userId: 'me', id: remoteId });
}

function encodeMime({ from, to, cc, subject, text, html, inReplyTo }) {
  const safeMessageId = inReplyTo?.replace(/[\r\n]/g, '');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const headers = [`From: ${from}`, `To: ${to.join(', ')}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0'];
  if (cc?.length) headers.push(`Cc: ${cc.join(', ')}`);
  if (safeMessageId) headers.push(`In-Reply-To: ${safeMessageId}`, `References: ${safeMessageId}`);
  if (html) {
    const boundary = `mailbox-${Date.now()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    headers.push('', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', text || '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', html, `--${boundary}--`);
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8', '', text || '');
  }
  return Buffer.from(headers.join('\r\n')).toString('base64url');
}

export async function gmailSend(secret, redirectUri, account, message) {
  const gmail = google.gmail({ version: 'v1', auth: oauth(secret, redirectUri) });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodeMime({ ...message, from: account.email }), threadId: message.threadId || undefined } });
}
