import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('switching messages keeps one history entry; back restores the existing list and position', () => {
  let open = false;
  const location = { hash: '#inbox' };
  const entries = [{ state: { mailboxView: 'list' }, hash: '#inbox' }];
  let cursor = 0;
  const history = {
    get state() { return entries[cursor].state; },
    pushState(state, _title, hash) { entries.splice(++cursor, entries.length, { state, hash }); location.hash = hash; },
    replaceState(state, _title, hash) { entries[cursor] = { state, hash }; location.hash = hash; },
    back() { location.hash = entries[--cursor].hash; },
  };
  const list = { scrollTop: 0 };
  const layout = { dataset: { listScrollY: '420' }, classList: { remove() {} } };
  const detail = { closest: () => layout, classList: { add() {} }, innerHTML: 'message' };
  const toolbar = { hidden: true };
  const context = vm.createContext({
    history, location, handledHash: '#inbox', activeMessageRequest: 0, activeDetailOutsideHandler: null, autoSyncRefreshPending: false,
    document: {
      body: { classList: { contains: () => open, remove: () => { open = false; } } },
      querySelector: (selector) => ({ '#message-detail': detail, '#message-list-scroll': list, '.mail-toolbar': toolbar })[selector],
    },
    setComposeVisibility() {}, messages: [], loadedMessages: [], selectedMessageIds: new Set(),
    applyMessageViewFilter: (items) => items, renderMessageList() {},
  });
  vm.runInContext(source.slice(source.indexOf('function updateMessageHistory'), source.indexOf('async function openMessage(id)')), context);
  vm.runInContext('updateMessageHistory(1)', context);
  open = true;
  vm.runInContext('updateMessageHistory(2); updateMessageHistory(1000)', context);
  assert.equal(entries.length, 2);
  assert.equal(location.hash, '#inbox/message/1000');
  vm.runInContext('returnToMessageList()', context);
  assert.equal(location.hash, '#inbox');
  assert.equal(list.scrollTop, 420);
  assert.equal(toolbar.hidden, false);
  assert.equal(open, false);
});

test('system/browser back closes detail without rebuilding the filtered list', async () => {
  let closed = 0;
  const context = vm.createContext({
    location: { hash: '#inbox' }, handledHash: '#inbox/message/99',
    document: { body: { classList: { contains: () => true } } },
    closeMessageDetail() { closed++; },
    renderRoute() { throw new Error('must retain the existing filtered list'); },
  });
  vm.runInContext(source.slice(source.indexOf('async function handleMailboxNavigation'), source.indexOf('async function initializeAppDownload')), context);
  await vm.runInContext('handleMailboxNavigation();', context);
  assert.equal(closed, 1);
  await vm.runInContext('handleMailboxNavigation();', context);
  assert.equal(closed, 1, 'hashchange and popstate must not handle the same navigation twice');
});

test('right swipe goes to next, left swipe to previous, including direct wraparound', () => {
  const expression = source.slice(source.indexOf('const targetIndex = dx < 0'), source.indexOf('    detailTouchStart = null;', source.indexOf('const targetIndex = dx < 0')));
  for (const [messageIndex, dx, expected] of [[0, -100, 999], [999, 100, 0], [50, 100, 51], [50, -100, 49]]) {
    const context = vm.createContext({ messageIndex, dx, messages: Array(1000) });
    assert.equal(vm.runInContext(expression + '\ntargetIndex', context), expected);
  }
});

test('automatic synchronization preserves list state and defers refresh while reading', async () => {
  let reading = false;
  const refreshes = [];
  const context = vm.createContext({
    autoSyncRunning: false, lastAutoSync: 0, autoSyncRefreshPending: false, accounts: [{}],
    document: { hidden: false, body: { classList: { contains: () => reading } }, querySelector: () => null },
    api: async () => [{ ok: true }],
    refreshInboxData: async (options) => refreshes.push(options),
    showNotice() {},
  });
  vm.runInContext(source.slice(source.indexOf('async function syncInboxAutomatically'), source.indexOf('async function handleMailboxNavigation')), context);
  await vm.runInContext('syncInboxAutomatically()', context);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0].preserve, true);
  reading = true;
  await vm.runInContext('syncInboxAutomatically()', context);
  assert.equal(refreshes.length, 1);
  assert.equal(context.autoSyncRefreshPending, true);
  assert.equal(context.autoSyncRunning, false);
});
