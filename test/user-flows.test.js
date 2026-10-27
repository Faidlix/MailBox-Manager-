// Exercises MailBox interface actions in a simulated browser DOM.
// Run with `npm test` or `node --test test/user-flows.test.js`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, tick, until } from './helpers/mailbox-dom.js';

async function scenario(body, options) { const app = await boot(options); try { await body(app); } finally { app.close(); } }

test('round 01: cold start survives malformed saved folder entries', () => scenario(async (a) => {
  assert.equal(a.all('.message-row').length, 100);
  assert.ok(!a.q('#demo-label').hidden);
}, { storage: '{"accounts":[null,12,{"name":"ok"}],"categories":[null]}' }));

test('round 02: pagination moves forward and backward with correct page counts', () => scenario(async (a) => {
  const total = a.run('demoMessages.filter((m) => !["SPAM", "TRASH"].includes(m.folder)).length');
  assert.equal(a.q('#message-count-summary').textContent, `100/${total}`);
  const first = a.q('.message-row').dataset.id;
  await a.click('[data-page-direction="next"]');
  assert.notEqual(a.q('.message-row').dataset.id, first);
  await a.click('[data-page-direction="previous"]');
  assert.equal(a.q('.message-row').dataset.id, first);
}));

test('round 03: select scope, outside cancellation and individual checkbox', () => scenario(async (a) => {
  const box = a.q('#select-all-messages'); box.checked = true; box.dispatchEvent(new a.w.Event('change'));
  assert.equal(a.q('#selection-scope').hidden, false);
  assert.equal(a.q('#message-count-summary').textContent, '100');
  a.q('#view').dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
  assert.equal(a.q('#selection-scope').hidden, true);
  assert.equal(a.run('selectedMessageIds.size'), 0);
  const one = a.q('.message-select'); one.checked = true; one.dispatchEvent(new a.w.Event('change'));
  assert.equal(a.q('#message-count-summary').textContent, '1');
  await a.run("categorizeSelectedMessages('新的分類')");
  assert.match(a.q('#notice').textContent, /分類為/);
  assert.equal(a.run('selectedMessageIds.size'), 0);
  await a.click('.message-category-filter');
  await until(() => a.all('.message-row').length === 1);
  assert.equal(a.q('.message-category-filter').textContent, '新的分類');
}));

test('round 04: sender and date filters can be reset together', () => scenario(async (a) => {
  await a.click('.message-source-filter'); await a.click('.message-date-filter');
  assert.match(a.q('#message-filter-label').textContent, /篩選：/);
  await a.click('#message-filter-reset'); await until(() => a.all('.message-row').length === 100);
  assert.equal(a.q('#message-filter-reset').hidden, true);
  a.q('#search-input').value = 'missing-unlikely-subject';
  a.q('#search-input').dispatchEvent(new a.w.Event('input'));
  await until(() => !a.all('.message-row').length && a.q('#message-list-scroll').textContent.includes('符合條件'));
  await a.click('#message-filter-reset'); await until(() => a.all('.message-row').length === 100);
}));

test('round 05: removing a star while filtering starred mail removes that row', () => scenario(async (a) => {
  await a.click('[data-state="starred"]'); await until(() => a.q('.message-star.active'));
  const id = Number(a.q('.message-row').dataset.id);
  await a.run(`toggleMessageStar(${id})`);
  assert.ok(!a.q(`.message-row[data-id="${id}"]`));
}));

test('round 06: trashing mail removes it from the inbox but retains it in trash', () => scenario(async (a) => {
  await a.run("api('/api/messages/1/move', { method:'PATCH', body:JSON.stringify({folder:'TRASH'}) })");
  const inbox = await a.run("api('/api/messages?state=all')");
  const trash = await a.run("api('/api/messages?state=trash')");
  assert.ok(!inbox.some((m) => m.id === 1)); assert.ok(trash.some((m) => m.id === 1));
  await a.open(2);
  await a.click('[data-action="spam"]');
  await until(() => a.run('demoMessages.find((m) => m.id === 2).folder') === 'SPAM');
  await until(() => !a.w.location.hash.endsWith('/2'));
  await a.click('[data-action="back"]');
  assert.equal(a.q('.message-row[data-id="2"]'), null);
}));

test('selected mail is trashed directly while selecting every result keeps cleanup options', () => scenario(async (a) => {
  const first = a.q('.message-select');
  const firstId = Number(first.closest('.message-row').dataset.id);
  const directActionMenu = a.q('#trash-options');
  first.checked = true;
  first.dispatchEvent(new a.w.Event('change'));
  await a.click('#bulk-trash');
  await until(() => a.run(`demoMessages.find((m) => m.id === ${firstId}).folder`) === 'TRASH');
  assert.equal(directActionMenu.hidden, true);
  await until(() => a.q('#trash-options'));

  await a.run('selectedMessageIds.clear(); messages.forEach((m) => selectedMessageIds.add(m.id)); renderMessageList()');
  const countBefore = a.run('demoMessages.filter((m) => m.folder === "TRASH").length');
  await a.click('#bulk-trash');
  assert.equal(a.q('#trash-options').hidden, false);
  assert.equal(a.run('demoMessages.filter((m) => m.folder === "TRASH").length'), countBefore);
}));

test('message detail trash button moves mail without a confirmation prompt', () => scenario(async (a) => {
  let confirmCalls = 0;
  a.w.confirm = () => { confirmCalls += 1; return false; };
  await a.open(3);
  await a.click('[data-action="trash"]');
  await until(() => a.run('demoMessages.find((m) => m.id === 3).folder') === 'TRASH');
  assert.equal(confirmCalls, 0);
}));

test('round 07: archive keeps mail retrievable through its dedicated filter', () => scenario(async (a) => {
  await a.run("api('/api/messages/1/archive', {method:'PATCH'})");
  const archived = await a.run("api('/api/messages?state=archive')");
  assert.ok(archived.some((m) => m.id === 1));
  await a.click('#category-settings'); await until(() => a.q('#rule-form'));
  const initialRules = a.all('.rule-card').length;
  for (const [name, value] of Object.entries({name:'測試規則',category:'測試分類',value:'bank'})) a.q(`#rule-form [name="${name}"]`).value = value;
  await a.submit('#rule-form'); await until(() => a.all('.rule-card').length === initialRules + 1);
  await a.click('.rule-card button'); await until(() => a.all('.rule-card').length === initialRules);
  await a.click('.inline-panel-close'); await until(() => !a.q('#settings-dialog').open);
  await a.click('#account-settings'); await until(() => a.q('#gmail-form'));
  assert.equal(a.q('#gmail-form button').disabled, true, 'unconfigured OAuth must not pretend to connect');
  assert.equal(a.q('#gmail-form [name="clientSecret"]'), null);
  await a.click('.sync-one'); await until(() => a.q('#notice').textContent.includes('已同步'));
  await a.click('.delete-account'); await until(() => a.q('#notice').textContent.includes('示範帳號'));
}));

test('round 08: manual unread survives returning to the list', () => scenario(async (a) => {
  await a.open(); await a.click('[data-action="read"]');
  assert.equal(a.q('[data-action="read"]').getAttribute('aria-pressed'), 'false');
  await a.click('[data-action="back"]');
  assert.ok(a.q('.message-row[data-id="1"]').classList.contains('unread'));
}));

test('round 09: keyboard on a checkbox does not open its parent message', () => scenario(async (a) => {
  a.q('.message-select').dispatchEvent(new a.w.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await tick();
  assert.ok(!a.w.document.body.classList.contains('message-open'));
}));

test('round 10: opening a missing message keeps the list usable', () => scenario(async (a) => {
  await assert.doesNotReject(a.open(999999));
  assert.match(a.q('#notice').textContent, /不存在|找不到/);
  assert.ok(!a.w.document.body.classList.contains('message-open'));
}));

test('round 11: reading supports direct wraparound and back restores one list entry', () => scenario(async (a) => {
  await a.open(1); const before = a.w.history.length;
  const last = a.run('messages.at(-1).id'); await a.open(last); await a.open(1);
  assert.equal(a.w.history.length, before);
  const detail = a.q('#message-detail');
  detail.ontouchstart({target:a.q('.mail-body'),touches:[{clientX:200,clientY:100}]});
  detail.ontouchend({changedTouches:[{clientX:50,clientY:100}]});
  await until(() => a.w.location.hash === `#inbox/message/${last}`);
  await a.click('[data-action="back"]');
  assert.equal(a.q('.mail-toolbar').hidden, false);
}));

test('round 12: demo compose cannot claim that a real message was sent', () => scenario(async (a) => {
  await a.run('openCompose()');
  a.q('#compose-form [name="to"]').value = 'recipient@example.com';
  a.q('#compose-form [name="subject"]').value = '測試';
  a.q('#compose-form [name="text"]').value = '內容';
  await a.submit('#compose-form');
  assert.doesNotMatch(a.q('#notice').textContent, /^郵件已寄出$/);
  assert.match(a.q('#notice').textContent, /示範|測試/);
  assert.equal(a.q('#compose-form [type="submit"]').disabled, false);
}));

test('round 13: forwarding includes the original sender, subject and content', () => scenario(async (a) => {
  await a.open(1); await a.click('[data-action="forward"]');
  const text = a.q('.inline-reply textarea').value;
  assert.match(text, /星河銀行|notice@bank.example/);
  assert.match(text, /信用卡|扣款/);
  await a.click('[data-inline-cancel]'); assert.equal(a.q('.mail-body').hidden, false);
  await a.click('[data-action="reply"]');
  assert.equal(a.q('.inline-reply [name="to"]').value, 'notice@bank.example');
  a.q('.inline-reply textarea').value = '回覆測試';
  await a.submit('.inline-reply form');
  assert.match(a.q('#notice').textContent, /示範/);
  assert.equal(a.q('.inline-reply [type="submit"]').disabled, false);
}));

test('round 14: closing help inside a message never reveals the compose button', () => scenario(async (a) => {
  await a.open(); await a.click('#help-button'); await a.click('#help-done');
  assert.equal(a.q('#compose-button').hidden, true);
}));

test('round 15: storage denial restores folder state and reports an actionable error', () => scenario(async (a) => {
  const oldCount = a.run('quickFolders.categories.length');
  a.w.Storage.prototype.setItem = () => { throw new a.w.DOMException('full', 'QuotaExceededError'); };
  // Exercise the same persistence operation invoked by folder forms.
  await a.run("quickFolders.categories.push({id:'test',name:'test'}); saveQuickFolders()");
  assert.equal(a.run('quickFolders.categories.length'), oldCount);
  assert.match(a.q('#notice').textContent, /儲存|空間/);
}));

test('round 16: dates accept explicit offsets and missing values without crashing', () => scenario(async (a) => {
  assert.equal(a.run("messageDate('2026-10-20T10:00:00+08:00').getTime()"), Date.parse('2026-10-20T10:00:00+08:00'));
  assert.equal(a.run('formatDate(null)'), '日期不明');
  assert.equal(a.run('formatMessageGroupDate(undefined)'), '日期不明');
}));

test('round 17: a previous notification timeout cannot erase a newer notification', () => scenario(async (a) => {
  const callbacks = new Map(); let next = 0;
  a.w.setTimeout = (fn) => { callbacks.set(++next, fn); return next; };
  a.w.clearTimeout = (id) => callbacks.delete(id);
  a.run("showNotice('第一個'); showNotice('第二個')");
  assert.equal(callbacks.size, 1);
  assert.match(a.q('#notice').textContent, /第二個/);
}));

test('round 18: repeated busy transitions restore the original button label', () => scenario(async (a) => {
  a.run("setBusy(composeButton,true,'處理中'); setBusy(composeButton,true,'處理中'); setBusy(composeButton,false)");
  assert.match(a.q('#compose-button').textContent, /寫信/);
}));

test('round 19: denied save picker never silently starts another download', () => scenario(async (a) => {
  a.w.showSaveFilePicker = async () => { throw new a.w.DOMException('denied', 'NotAllowedError'); };
  await assert.rejects(a.run("saveExportFiles([new File(['x'],'test.eml')])"), /denied/);
}));

test('round 20: MIME attachment preserves quoted-printable UTF-8 and invalid filenames fall back', () => scenario(async (a) => {
  const raw = 'Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename*=UTF-8\'\'%GG\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=E4=B8=AD=E6=96=87\r\n--b--\r\n';
  a.w.rawTestMime = raw;
  const files = a.run("parseMimeFiles(window.rawTestMime,'attachments')");
  assert.equal(files.length, 1); assert.equal(await files[0].text(), '中文');
  assert.ok(files[0].name);
}));
