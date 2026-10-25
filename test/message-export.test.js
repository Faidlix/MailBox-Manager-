import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { simpleParser } from 'mailparser';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6p8AAAAASUVORK5CYII=';
function emlContext() {
  const context = vm.createContext({
    TextEncoder, btoa, Image: class { async decode() {} },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => `data:image/png;base64,${png}` }) },
  });
  vm.runInContext(source.slice(source.indexOf('const escapeHtml'), source.indexOf('const demoApi')), context);
  vm.runInContext(source.slice(source.indexOf('async function demoEml'), source.indexOf('async function downloadMessage')), context);
  return context;
}

test('EML preserves the displayed HTML, Chinese headers, PNG CID and attachments', async () => {
  const context = emlContext();
  const message = { id: 1, subject: '信用卡自動扣款成功通知', sender_name: '星河銀行', sender_email: 'notice@bank.example', recipients: ['test@example.com'], received_at: '2026-10-23T00:00:00Z', text_body: '您好，帳單已扣款。', has_attachments: 1 };
  context.message = message;
  const html = vm.runInContext('demoHtml(message)', context);
  const raw = await vm.runInContext('demoEml({ ...message, html_body: demoHtml(message) })', context);
  const parsed = await simpleParser(raw, { skipImageLinks: true });
  assert.equal(parsed.subject, message.subject);
  assert.equal(parsed.from.value[0].name, message.sender_name);
  assert.equal(parsed.html, html.replace(/data:image\/svg\+xml;base64,[^"]+/, 'cid:mailbox-demo-mark'));
  const logo = parsed.attachments.find((item) => item.cid === 'mailbox-demo-mark');
  assert.equal(logo.contentType, 'image/png');
  assert.equal(logo.content.toString('base64'), png);
  assert.ok(parsed.attachments.some((item) => item.filename === 'demo-attachment.txt'));
});

test('EML without images or attachments does not invent an embedded logo', async () => {
  const context = emlContext();
  context.message = { id: 2, subject: '純文字', sender_email: 'test@example.com', recipients: [], received_at: '2026-10-23T00:00:00Z', text_body: '信件內容', html_body: '<p>信件內容</p>' };
  const parsed = await simpleParser(await vm.runInContext('demoEml(message)', context));
  assert.equal(parsed.html, '<p>信件內容</p>');
  assert.equal(parsed.attachments.length, 0);
});

test('share starts during the click and restores the button on permission denial or cancel', async () => {
  const snippet = source.slice(source.indexOf("document.querySelector('#message-share').addEventListener"), source.indexOf('const closeHelp'));
  for (const name of ['NotAllowedError', 'AbortError']) {
    let handler;
    const notices = [];
    const button = { disabled: false, textContent: '分享', dataset: {} };
    Object.defineProperty(button, 'innerHTML', { get() { return this.textContent; }, set(value) { this.textContent = value; } });
    let called = false;
    const context = vm.createContext({
      exportSession: { readyType: 'eml', readyFiles: ['file'], message: { subject: '信件' } },
      document: { querySelector: () => ({ addEventListener: (_type, callback) => { handler = callback; } }) },
      navigator: { canShare: () => true, share: () => { called = true; return Promise.reject(Object.assign(new Error('Permission denied'), { name })); } },
      messageDownloadDialog: { close() {} }, showNotice: (message) => notices.push(message),
    });
    vm.runInContext(source.slice(source.indexOf('function setBusy('), source.indexOf('async function loadAccounts')), context);
    vm.runInContext(snippet, context);
    const event = { currentTarget: button };
    const pending = handler(event);
    assert.equal(called, true, 'share must run before losing user activation');
    event.currentTarget = null;
    await pending;
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, '分享');
    assert.equal(notices.length, name === 'AbortError' ? 0 : 1);
  }
});

test('opening unread mail updates API, local collections and list immediately', async () => {
  const calls = [];
  const unread = { id: 5, is_read: 0 };
  const collections = Array.from({ length: 3 }, () => [{ ...unread }]);
  let removed = false;
  const context = vm.createContext({
    activeMessageRequest: 0, activeDetailOutsideHandler: null,
    messages: collections[0], loadedMessages: collections[1], demoMessages: collections[2],
    api: async (url, options) => { calls.push([url, options]); return { ...unread }; },
    document: { querySelector: () => ({ classList: { remove: () => { removed = true; } } }) },
    showNotice() {},
  });
  const start = source.indexOf('async function openMessage(id)');
  const end = source.indexOf("  document.querySelectorAll('.message-row')", start);
  vm.runInContext(source.slice(start, end) + 'return message;\n}', context);
  const result = await vm.runInContext('openMessage(5)', context);
  assert.equal(result.is_read, 1);
  assert.equal(JSON.parse(calls[1][1].body).read, true);
  assert.ok(collections.every((items) => items[0].is_read === 1));
  assert.equal(removed, true);
});
