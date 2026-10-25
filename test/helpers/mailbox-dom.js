import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
export const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
export async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await tick(); }
  assert.ok(check(), 'DOM action did not reach the expected state');
}

// DOM simulation only: no layout engine, real Google/Yahoo, native bridge or PDF canvas.
export async function boot(options = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'https://localhost/#inbox', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const w = dom.window;
  Object.assign(w, { structuredClone, TextEncoder, TextDecoder, Blob, File, Response, AbortSignal });
  w.matchMedia = () => ({ matches: true });
  w.confirm = () => true;
  w.prompt = () => '新分類';
  w.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
  w.URL.createObjectURL = () => 'blob:simulated-export';
  w.URL.revokeObjectURL = () => {};
  w.HTMLElement.prototype.setPointerCapture = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new w.Event('close')); };
  // jsdom intentionally lacks browser legacy form named properties.
  for (const name of ['accountId', 'fromDate', 'toDate', 'sender', 'subject', 'folderName']) {
    Object.defineProperty(w.HTMLFormElement.prototype, name, { configurable: true, get() { return this.elements.namedItem(name); } });
  }
  const originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, delay, ...args) => originalTimeout(fn, delay === 180 || delay === 250 ? 0 : delay, ...args);
  if (options.storage) w.localStorage.setItem('mailbox-manager-quick-folders-v1', options.storage);
  const program = source.replace("import { createMessagePdf } from './message-export.js';", "const createMessagePdf = () => { throw new Error('PDF canvas is outside DOM simulation'); };");
  await w.eval(`(async () => { ${program}\nwindow.mailboxTest = { run: (code) => eval(code) }; })()`);
  await until(() => w.document.querySelectorAll('.message-row').length || w.document.querySelector('#view').textContent.includes('載入失敗'));
  const app = {
    w, dom, errors, q: (s) => w.document.querySelector(s), all: (s) => [...w.document.querySelectorAll(s)],
    run: (code) => w.mailboxTest.run(code),
    async click(selector) { const e = typeof selector === 'string' ? app.q(selector) : selector; assert.ok(e, String(selector)); e.click(); await tick(); },
    async submit(selector) { app.q(selector).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); },
    async open(id = 1) { await app.run(`openMessage(${id})`); },
    close() { w.close(); },
  };
  return app;
}
