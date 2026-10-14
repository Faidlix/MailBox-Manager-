const view = document.querySelector('#view');
const title = document.querySelector('#page-title');
const noticeRoot = document.querySelector('#notice');
const syncButton = document.querySelector('#sync-button');
const composeButton = document.querySelector('#compose-button');
const composeDialog = document.querySelector('#compose-dialog');
const composeForm = document.querySelector('#compose-form');
const helpButton = document.querySelector('#help-button');
const helpDialog = document.querySelector('#help-dialog');
const messageActionMenu = document.querySelector('#message-action-menu');
let actionMessageId = null;
let accounts = [];
let messages = [];
const inboxFilters = { accountId: '', category: '', state: 'all' };
const demoMode = location.protocol === 'https:' || new URLSearchParams(location.search).has('demo');
const demoAccounts = [
  { id: 1, provider: 'gmail', email: 'personal.demo@gmail.com', display_name: '個人信箱', last_synced_at: new Date().toISOString() },
  { id: 2, provider: 'imap', email: 'work.demo@yahoo.com', display_name: '工作信箱', last_synced_at: new Date(Date.now() - 18 * 60_000).toISOString() },
];
let demoMessages = [
  { id: 1, account_id: 2, remote_id: 'demo-1', thread_id: 'demo-thread-1', folder: 'INBOX', sender_name: '星河銀行', sender_email: 'notice@bank.example', recipients: ['work.demo@yahoo.com'], subject: '信用卡自動扣款成功通知', snippet: '本期信用卡帳款已完成自動扣款，感謝您的使用。', text_body: '您好：\n\n本期信用卡帳款 NT$12,350 已於今日完成自動扣款。\n\n此為介面展示郵件，不含真實帳務資料。', html_body: '', received_at: new Date(Date.now() - 22 * 60_000).toISOString(), is_read: 0, is_starred: 1, has_attachments: 0, category: '銀行', account_email: 'work.demo@yahoo.com', provider: 'imap', labels: [] },
  { id: 2, account_id: 1, remote_id: 'demo-2', thread_id: 'demo-thread-2', folder: 'INBOX', sender_name: 'Steam', sender_email: 'noreply@steampowered.com', recipients: ['personal.demo@gmail.com'], subject: 'Wishlist item is on sale', snippet: '您願望清單中的遊戲正在特價，活動本週結束。', text_body: '願望清單中的遊戲現在享有 60% 折扣。\n\n此為介面展示郵件。', html_body: '', received_at: new Date(Date.now() - 3 * 3600_000).toISOString(), is_read: 0, is_starred: 0, has_attachments: 0, category: 'Steam', account_email: 'personal.demo@gmail.com', provider: 'gmail', labels: [] },
  { id: 3, account_id: 2, remote_id: 'demo-3', thread_id: 'demo-thread-3', folder: 'INBOX', sender_name: '專案小組', sender_email: 'team@company.example', recipients: ['work.demo@yahoo.com'], subject: 'Re: 下週專案會議', snippet: '會議時間調整為星期二下午兩點，附件為更新後的議程。', text_body: '大家好，\n\n會議時間調整為星期二下午兩點，請參考更新後的議程。\n\n此為介面展示郵件。', html_body: '', received_at: new Date(Date.now() - 26 * 3600_000).toISOString(), is_read: 1, is_starred: 0, has_attachments: 1, category: '專案', account_email: 'work.demo@yahoo.com', provider: 'imap', labels: [] },
  { id: 4, account_id: 1, remote_id: 'demo-4', thread_id: 'demo-thread-4', folder: 'ARCHIVE', sender_name: 'GitHub', sender_email: 'notifications@github.com', recipients: ['personal.demo@gmail.com'], subject: 'Repository activity summary', snippet: '這封郵件已封存，可從封存篩選中查看。', text_body: '本週專案活動摘要。\n\n此為介面展示郵件。', html_body: '', received_at: new Date(Date.now() - 42 * 3600_000).toISOString(), is_read: 1, is_starred: 0, has_attachments: 0, category: '專案', account_email: 'personal.demo@gmail.com', provider: 'gmail', labels: [] },
  { id: 5, account_id: 1, remote_id: 'demo-5', thread_id: 'demo-thread-5', folder: 'SPAM', sender_name: '優惠快報', sender_email: 'promo@unknown.example', recipients: ['personal.demo@gmail.com'], subject: '今日限定優惠', snippet: '系統已將這封郵件判定為垃圾郵件。', text_body: '此為垃圾郵件篩選介面展示。', html_body: '', received_at: new Date(Date.now() - 50 * 3600_000).toISOString(), is_read: 1, is_starred: 0, has_attachments: 0, category: '廣告', account_email: 'personal.demo@gmail.com', provider: 'gmail', labels: [] },
  { id: 6, account_id: 2, remote_id: 'demo-6', thread_id: 'demo-thread-6', folder: 'TRASH', sender_name: '購物通知', sender_email: 'order@shop.example', recipients: ['work.demo@yahoo.com'], subject: '已取消的訂單通知', snippet: '這封郵件位於垃圾桶。', text_body: '此為垃圾桶篩選介面展示。', html_body: '', received_at: new Date(Date.now() - 74 * 3600_000).toISOString(), is_read: 1, is_starred: 0, has_attachments: 0, category: '購物', account_email: 'work.demo@yahoo.com', provider: 'imap', labels: [] },
];
let demoRules = [
  { id: 1, name: '銀行帳務', field: 'sender', operator: 'contains', value: 'bank', category: '帳單', enabled: 1 },
  { id: 2, name: '遊戲通知', field: 'sender', operator: 'contains', value: 'Steam', category: '遊戲', enabled: 1 },
];

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const demoApi = async (url, options = {}) => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const method = options.method || 'GET';
  const parsed = new URL(url, location.origin);
  if (url === '/api/accounts') return structuredClone(demoAccounts);
  if (parsed.pathname === '/api/messages' && method === 'GET') {
    let result = [...demoMessages];
    const search = parsed.searchParams.get('search')?.toLowerCase();
    const accountId = parsed.searchParams.get('accountId');
    const category = parsed.searchParams.get('category');
    const state = parsed.searchParams.get('state') || 'all';
    if (search) result = result.filter((item) => `${item.subject} ${item.sender_name} ${item.sender_email} ${item.snippet}`.toLowerCase().includes(search));
    if (accountId) result = result.filter((item) => String(item.account_id) === accountId);
    if (category) result = result.filter((item) => item.category === category);
    if (state === 'unread') result = result.filter((item) => !item.is_read);
    if (state === 'starred') result = result.filter((item) => item.is_starred);
    if (state === 'archive') result = result.filter((item) => item.folder === 'ARCHIVE');
    if (state === 'spam') result = result.filter((item) => item.folder === 'SPAM');
    if (state === 'trash') result = result.filter((item) => item.folder === 'TRASH');
    if (state === 'all') result = result.filter((item) => !['SPAM', 'TRASH'].includes(item.folder));
    return structuredClone(result);
  }
  const messageMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (messageMatch && method === 'GET') return structuredClone(demoMessages.find((item) => item.id === Number(messageMatch[1])));
  const readMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/read$/);
  if (readMatch) { const item = demoMessages.find((message) => message.id === Number(readMatch[1])); if (item) item.is_read = JSON.parse(options.body).read ? 1 : 0; return { ok: true }; }
  const archiveMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/archive$/);
  if (archiveMatch && method === 'PATCH') { const item = demoMessages.find((message) => message.id === Number(archiveMatch[1])); if (item) item.folder = 'ARCHIVE'; return { ok: true }; }
  if (messageMatch && method === 'DELETE') { const item = demoMessages.find((message) => message.id === Number(messageMatch[1])); if (item) item.folder = 'TRASH'; return null; }
  if (url === '/api/sync') return demoAccounts.map((account) => ({ accountId: account.id, count: demoMessages.filter((message) => message.account_id === account.id).length, ok: true }));
  if (/^\/api\/accounts\/\d+\/sync$/.test(parsed.pathname)) return { count: demoMessages.length };
  if (url === '/api/send') return { ok: true };
  if (url === '/api/rules' && method === 'GET') return structuredClone(demoRules);
  if (url === '/api/rules' && method === 'POST') { const rule = { id: Date.now(), ...JSON.parse(options.body), enabled: 1 }; demoRules.unshift(rule); return { id: rule.id }; }
  const ruleMatch = parsed.pathname.match(/^\/api\/rules\/(\d+)$/);
  if (ruleMatch && method === 'DELETE') { demoRules = demoRules.filter((rule) => rule.id !== Number(ruleMatch[1])); return null; }
  if (url.includes('/auth-url') || url === '/api/accounts/imap') throw new Error('測試站不會連接真實帳號；正式版需在安全後端設定 OAuth 或應用程式密碼。');
  if (/^\/api\/accounts\/\d+$/.test(parsed.pathname) && method === 'DELETE') throw new Error('示範帳號保留供介面測試。');
  return { ok: true };
};
const api = async (url, options = {}) => {
  if (demoMode) return demoApi(url, options);
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `要求失敗 (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
};

if (demoMode) document.querySelector('#demo-label').hidden = false;

function showNotice(message, error = false) {
  noticeRoot.innerHTML = `<div class="notice ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  setTimeout(() => { noticeRoot.innerHTML = ''; }, 4200);
}

function setBusy(button, busy, label = '處理中…') {
  if (busy) { button.dataset.original = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.original || button.textContent; button.disabled = false; }
}

async function loadAccounts() {
  accounts = await api('/api/accounts');
  return accounts;
}

function formatDate(value) {
  const date = new Date(value.endsWith?.('Z') ? value : `${value}Z`);
  return new Intl.DateTimeFormat('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function accountOptions(selected = '') {
  return accounts.map((account) => `<option value="${account.id}" ${String(account.id) === String(selected) ? 'selected' : ''}>${escapeHtml(account.email)} · ${account.provider === 'gmail' ? 'Gmail' : 'IMAP'}</option>`).join('');
}

async function renderInbox() {
  title.textContent = '統一收件匣';
  view.append(document.querySelector('#inbox-template').content.cloneNode(true));
  await loadAccounts();
  const allMessages = await api('/api/messages?state=all');
  const categories = [...new Set(allMessages.map((message) => message.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const states = [['all', '全部郵件'], ['unread', '未讀'], ['starred', '星號'], ['archive', '封存'], ['spam', '垃圾郵件'], ['trash', '垃圾桶']];
  const inboxContent = document.querySelector('#inbox-content');
  const mailShell = () => '<div class="mail-layout"><div id="message-list" class="message-list card"></div><article id="message-detail" class="message-detail card empty-state"><div><b>選擇一封郵件</b><p>郵件內容會顯示在這裡。</p></div></article></div>';
  const setSettingsState = (active = '') => {
    document.querySelector('#account-settings').setAttribute('aria-pressed', String(active === 'accounts'));
    document.querySelector('#category-settings').setAttribute('aria-pressed', String(active === 'rules'));
  };
  const renderFilters = () => {
    document.querySelector('#account-filters').innerHTML = `<button class="filter-chip ${inboxFilters.accountId ? '' : 'active'}" data-account="">所有帳號</button>${accounts.map((account) => `<button class="filter-chip ${String(inboxFilters.accountId) === String(account.id) ? 'active' : ''}" data-account="${account.id}"><span class="chip-dot"></span>${escapeHtml(account.display_name || account.email)}</button>`).join('')}`;
    document.querySelector('#category-filters').innerHTML = `<button class="filter-chip ${inboxFilters.category ? '' : 'active'}" data-category="">所有分類</button>${categories.map((category) => `<button class="filter-chip ${inboxFilters.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}"><span class="chip-dot"></span>${escapeHtml(category)}</button>`).join('')}`;
    document.querySelector('#mail-filters').innerHTML = states.map(([value, label]) => `<button class="filter-chip ${inboxFilters.state === value ? 'active' : ''}" data-state="${value}">${label}</button>`).join('');
  };
  renderFilters();
  const update = async () => {
    if (!document.querySelector('#message-list')) inboxContent.innerHTML = mailShell();
    setSettingsState();
    const search = document.querySelector('#search-input').value;
    const query = new URLSearchParams({ ...(search && { search }), ...(inboxFilters.accountId && { accountId: inboxFilters.accountId }), ...(inboxFilters.category && { category: inboxFilters.category }), state: inboxFilters.state });
    document.querySelector('#message-list').innerHTML = '<div class="loading">載入郵件中…</div>';
    messages = await api(`/api/messages?${query}`);
    renderMessageList();
  };
  let timer;
  document.querySelector('#search-input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  document.querySelector('#account-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-account]'); if (!button) return; inboxFilters.accountId = button.dataset.account; renderFilters(); update(); });
  document.querySelector('#category-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; inboxFilters.category = button.dataset.category; renderFilters(); update(); });
  document.querySelector('#mail-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-state]'); if (!button) return; inboxFilters.state = button.dataset.state; renderFilters(); update(); });
  const openSettings = async (type) => {
    setSettingsState(type);
    if (type === 'accounts') await mountAccounts(inboxContent, true);
    else await mountRules(inboxContent, true);
    requestAnimationFrame(() => inboxContent.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  document.querySelector('#account-settings').addEventListener('click', () => openSettings('accounts'));
  document.querySelector('#category-settings').addEventListener('click', () => openSettings('rules'));
  document.querySelector('#add-account').addEventListener('click', () => openSettings('accounts'));
  document.querySelector('#add-category').addEventListener('click', () => openSettings('rules'));
  await update();
}

function renderMessageList() {
  const list = document.querySelector('#message-list');
  if (!messages.length) {
    list.innerHTML = `<div class="loading"><b>目前沒有郵件</b><p>${accounts.length ? '按「同步全部」取得最新郵件。' : '先到「信箱帳號」連線一個帳號。'}</p></div>`;
    return;
  }
  list.innerHTML = messages.map((message) => `
    <div class="message-swipe" data-id="${message.id}">
      <div class="swipe-action archive"><span>⇥</span>封存</div><div class="swipe-action delete">刪除<span>⌫</span></div>
      <div class="message-row ${message.is_read ? '' : 'unread'}" data-id="${message.id}" tabindex="0" role="button" aria-label="${escapeHtml(message.subject)}">
        <div class="row-top"><span class="sender">${escapeHtml(message.sender_name || message.sender_email)}</span><time class="date">${formatDate(message.received_at)}</time></div>
        <div class="subject">${escapeHtml(message.subject)}</div><div class="snippet">${escapeHtml(message.snippet)}</div>
        <span class="account-pill">${escapeHtml(message.account_email)}</span><span class="category-pill">${escapeHtml(message.category)}</span>
      </div>
    </div>`).join('');
  list.querySelectorAll('.message-row').forEach((row) => {
    const id = Number(row.dataset.id);
    const open = () => { if (!row.dataset.ignoreClick) openMessage(id); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') open(); });
    bindMessageGestures(row, id);
  });
}

function hideMessageMenu() {
  messageActionMenu.hidden = true;
  actionMessageId = null;
}

function showMessageMenu(id, x, y) {
  actionMessageId = id;
  messageActionMenu.hidden = false;
  const width = 224;
  const height = 72;
  messageActionMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  messageActionMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
}

async function archiveMessage(id) {
  try {
    await api(`/api/messages/${id}/archive`, { method: 'PATCH' });
    showNotice('郵件已封存');
    await renderRoute();
  } catch (error) { showNotice(error.message, true); }
}

async function trashMessage(id) {
  if (!confirm('確定將這封郵件移至垃圾桶？')) return false;
  try {
    await api(`/api/messages/${id}`, { method: 'DELETE' });
    showNotice('郵件已移至垃圾桶');
    await renderRoute();
    return true;
  } catch (error) { showNotice(error.message, true); return false; }
}

function bindMessageGestures(row, id) {
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let tracking = false;
  let moved = false;
  let longPressed = false;
  let pressTimer;
  const reset = () => { row.classList.remove('dragging'); row.style.transform = ''; };
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    tracking = true; moved = false; longPressed = false; deltaX = 0;
    startX = event.clientX; startY = event.clientY;
    row.setPointerCapture?.(event.pointerId);
    pressTimer = setTimeout(() => {
      longPressed = true;
      row.dataset.ignoreClick = 'true';
      reset();
      showMessageMenu(id, event.clientX, event.clientY);
      navigator.vibrate?.(25);
    }, 600);
  });
  row.addEventListener('pointermove', (event) => {
    if (!tracking || longPressed) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(pressTimer);
    if (Math.abs(dx) <= Math.abs(dy)) return;
    moved = Math.abs(dx) > 10;
    deltaX = Math.max(-150, Math.min(150, dx));
    row.classList.add('dragging');
    row.style.transform = `translateX(${deltaX}px)`;
  });
  const finish = async () => {
    if (!tracking) return;
    tracking = false;
    clearTimeout(pressTimer);
    if (longPressed) return;
    if (moved) {
      row.dataset.ignoreClick = 'true';
      setTimeout(() => { delete row.dataset.ignoreClick; }, 350);
    }
    if (deltaX <= -88) {
      row.style.transform = 'translateX(-100%)';
      if (!await trashMessage(id)) reset();
    } else if (deltaX >= 88) {
      row.style.transform = 'translateX(100%)';
      await archiveMessage(id);
    } else reset();
  };
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', () => { tracking = false; clearTimeout(pressTimer); reset(); });
  row.addEventListener('contextmenu', (event) => { event.preventDefault(); clearTimeout(pressTimer); showMessageMenu(id, event.clientX, event.clientY); });
}

function demoEml(message) {
  const bytes = new TextEncoder().encode(message.subject || '(無主旨)');
  let encoded = '';
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  const headers = [
    `From: ${message.sender_name ? `"${message.sender_name.replaceAll('"', '')}" ` : ''}<${message.sender_email}>`,
    `To: ${(message.recipients || []).join(', ')}`,
    `Date: ${new Date(message.received_at).toUTCString()}`,
    `Subject: =?UTF-8?B?${btoa(encoded)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${message.text_body || message.snippet || ''}`;
}

async function downloadMessage(id) {
  hideMessageMenu();
  try {
    let blob;
    let subject = `message-${id}`;
    if (demoMode) {
      const message = await api(`/api/messages/${id}`);
      subject = message.subject;
      blob = new Blob([demoEml(message)], { type: 'message/rfc822;charset=utf-8' });
    } else {
      const message = await api(`/api/messages/${id}`);
      subject = message.subject;
      const response = await fetch(`/api/messages/${id}/download`);
      if (!response.ok) throw new Error('下載信件失敗');
      blob = await response.blob();
    }
    const filename = `${String(subject || 'message').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80)}.eml`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showNotice('信件已下載');
  } catch (error) { showNotice(error.message, true); }
}

async function openMessage(id) {
  const message = await api(`/api/messages/${id}`);
  document.querySelectorAll('.message-row').forEach((row) => row.classList.toggle('selected', Number(row.dataset.id) === id));
  const detail = document.querySelector('#message-detail');
  detail.classList.remove('empty-state');
  detail.innerHTML = `
    <button class="ghost mobile-back" type="button" data-action="back">‹ 返回信件列表</button>
    <div><span class="account-pill">${escapeHtml(message.account_email)}</span><span class="category-pill">${escapeHtml(message.category)}</span></div>
    <h2>${escapeHtml(message.subject)}</h2>
    <div class="message-meta"><b>${escapeHtml(message.sender_name || message.sender_email)}</b> &lt;${escapeHtml(message.sender_email)}&gt;<br><small>${formatDate(message.received_at)}</small></div>
    <div class="message-actions">
      <button class="ghost" data-action="read">${message.is_read ? '標記未讀' : '標記已讀'}</button>
      <button class="ghost" data-action="reply">回覆</button>
      <button class="ghost" data-action="forward">轉寄</button>
      <button class="danger" data-action="trash">移至垃圾桶</button>
    </div>
    <div class="mail-body"></div>`;
  const layout = detail.closest('.mail-layout');
  layout.dataset.listScrollY = String(window.scrollY);
  layout.classList.add('mobile-detail-open');
  if (matchMedia('(max-width: 700px)').matches) requestAnimationFrame(() => detail.scrollIntoView({ block: 'start' }));
  detail.querySelector('[data-action="back"]').addEventListener('click', () => {
    layout.classList.remove('mobile-detail-open');
    detail.classList.add('empty-state');
    detail.innerHTML = '<div><b>選擇一封郵件</b><p>郵件內容會顯示在這裡。</p></div>';
    window.scrollTo({ top: Number(layout.dataset.listScrollY || 0), behavior: 'auto' });
  });
  const body = detail.querySelector('.mail-body');
  if (message.html_body) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', '');
    iframe.setAttribute('title', '郵件內容');
    iframe.srcdoc = `<base target="_blank">${message.html_body}`;
    body.append(iframe);
  } else body.innerHTML = `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(message.text_body || message.snippet)}</pre>`;
  detail.querySelector('[data-action="read"]').addEventListener('click', async (event) => {
    setBusy(event.currentTarget, true);
    try { await api(`/api/messages/${id}/read`, { method: 'PATCH', body: JSON.stringify({ read: !message.is_read }) }); await renderRoute(); }
    catch (error) { showNotice(error.message, true); setBusy(event.currentTarget, false); }
  });
  detail.querySelector('[data-action="trash"]').addEventListener('click', async (event) => {
    if (!confirm('確定將這封郵件移至遠端信箱的垃圾桶？')) return;
    setBusy(event.currentTarget, true);
    try { await api(`/api/messages/${id}`, { method: 'DELETE' }); showNotice('郵件已移至垃圾桶'); await renderRoute(); }
    catch (error) { showNotice(error.message, true); setBusy(event.currentTarget, false); }
  });
  detail.querySelector('[data-action="reply"]').addEventListener('click', () => {
    openCompose({ accountId: message.account_id, to: message.sender_email, subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`, text: `\n\n--- 原始郵件 ---\n${message.text_body || message.snippet}`, inReplyTo: message.thread_id });
  });
  detail.querySelector('[data-action="forward"]').addEventListener('click', () => {
    openCompose({ accountId: message.account_id, subject: message.subject.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`, text: `\n\n--- 轉寄郵件 ---\n寄件者：${message.sender_email}\n${message.text_body || message.snippet}` });
  });
  if (!message.is_read) {
    api(`/api/messages/${id}/read`, { method: 'PATCH', body: JSON.stringify({ read: true }) }).catch((error) => showNotice(error.message, true));
  }
}

async function openCompose(draft = {}) {
  await loadAccounts();
  composeForm.reset();
  composeForm.accountId.innerHTML = accountOptions(draft.accountId);
  composeForm.dataset.inReplyTo = draft.inReplyTo || '';
  for (const [key, value] of Object.entries(draft)) if (composeForm.elements[key] && key !== 'accountId') composeForm.elements[key].value = value;
  if (!composeDialog.open) composeDialog.showModal();
}

async function mountAccounts(target, embedded = false) {
  await loadAccounts();
  target.innerHTML = `<div class="inline-settings">
    ${embedded ? '<div class="inline-panel-head"><div><h2>信箱帳號設定</h2><p>管理現有帳號或新增 Gmail、Yahoo 與一般信箱。</p></div><button class="ghost inline-panel-close" type="button">完成</button></div>' : ''}
    <div class="account-grid">${accounts.length ? accounts.map((account) => `
      <div class="account-card card"><div class="account-icon">${account.provider === 'gmail' ? 'G' : 'IM'}</div><div class="account-info"><b>${escapeHtml(account.email)}</b><small>${account.provider === 'gmail' ? 'Google OAuth' : 'IMAP / SMTP'} · ${account.last_synced_at ? `上次同步 ${formatDate(account.last_synced_at)}` : '尚未同步'}</small></div><button class="ghost sync-one" data-id="${account.id}">同步</button><button class="danger delete-account" data-id="${account.id}">移除</button></div>`).join('') : '<div class="card loading">尚未加入任何信箱。</div>'}</div>
    <h2 class="section-title" style="margin-top:32px">新增信箱</h2>
    <div class="split">
      <form id="gmail-form" class="form-card card"><h3>Gmail</h3><p>使用 Google OAuth 授權，不會儲存 Gmail 密碼。請先建立「桌面應用程式」OAuth 憑證，並加入重新導向 URI：<br><span class="code">${escapeHtml(location.origin)}/api/oauth/google/callback</span></p><label>Google Client ID<input name="clientId" required autocomplete="off"></label><label>Google Client Secret<input name="clientSecret" type="password" required autocomplete="off"></label><div class="form-actions"><button class="primary" type="submit">連線 Gmail</button></div></form>
      <form id="imap-form" class="form-card card"><h3>Yahoo / 一般信箱</h3><p>Yahoo 請使用「應用程式密碼」，不要填入一般登入密碼。</p><label>Email<input name="email" type="email" required></label><label>應用程式密碼<input name="password" type="password" required autocomplete="off"></label><label>IMAP 主機<input name="imapHost" value="imap.mail.yahoo.com" required></label><label>SMTP 主機<input name="smtpHost" value="smtp.mail.yahoo.com" required></label><div class="split"><label>IMAP 連接埠<input name="imapPort" type="number" value="993"></label><label>SMTP 連接埠<input name="smtpPort" type="number" value="465"></label></div><div class="form-actions"><button class="primary" type="submit">加入信箱</button></div></form>
    </div></div>`;
  target.querySelector('.inline-panel-close')?.addEventListener('click', () => renderRoute());
  target.querySelector('#gmail-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true);
    try { const data = Object.fromEntries(new FormData(event.currentTarget)); const result = await api('/api/accounts/gmail/auth-url', { method: 'POST', body: JSON.stringify(data) }); window.open(result.url, '_blank', 'noopener'); showNotice('請在新視窗完成 Google 授權'); }
    catch (error) { showNotice(error.message, true); }
    finally { setBusy(button, false); }
  });
  target.querySelector('#imap-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true);
    try { const data = Object.fromEntries(new FormData(event.currentTarget)); await api('/api/accounts/imap', { method: 'POST', body: JSON.stringify(data) }); showNotice('信箱已加入'); await mountAccounts(target, embedded); }
    catch (error) { showNotice(error.message, true); }
    finally { setBusy(button, false); }
  });
  target.querySelectorAll('.sync-one').forEach((button) => button.addEventListener('click', async () => {
    setBusy(button, true, '同步中…'); try { const result = await api(`/api/accounts/${button.dataset.id}/sync`, { method: 'POST' }); showNotice(`已同步 ${result.count} 封郵件`); await mountAccounts(target, embedded); } catch (error) { showNotice(error.message, true); setBusy(button, false); }
  }));
  target.querySelectorAll('.delete-account').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('移除帳號與本機郵件索引？遠端信箱內容不會被刪除。')) return;
    try { await api(`/api/accounts/${button.dataset.id}`, { method: 'DELETE' }); showNotice('帳號已從本機移除'); await mountAccounts(target, embedded); } catch (error) { showNotice(error.message, true); }
  }));
}

async function renderAccounts() {
  title.textContent = '信箱帳號';
  await mountAccounts(view);
}

async function mountRules(target, embedded = false) {
  const rules = await api('/api/rules');
  target.innerHTML = `<div class="inline-settings">${embedded ? '<div class="inline-panel-head"><div><h2>自動分類設定</h2><p>依寄件者或主旨新增分類條件。</p></div><button class="ghost inline-panel-close" type="button">完成</button></div>' : ''}<form id="rule-form" class="form-card card narrow"><div class="split"><label>規則名稱<input name="name" placeholder="例如：購物通知" required></label><label>分類名稱<input name="category" placeholder="例如：購物" required></label></div><div class="split"><label>比對範圍<select name="field"><option value="sender">寄件者</option><option value="subject">主旨</option><option value="both">寄件者與主旨</option></select></label><label>比對方式<select name="operator"><option value="contains">包含</option><option value="equals">完全相同</option><option value="regex">正規表示式</option></select></label></div><label>比對文字<input name="value" placeholder="shopee 或 @company.com" required></label><div class="form-actions"><button class="primary">新增規則</button></div></form><h2 class="section-title" style="margin-top:32px">現有規則</h2><div class="rule-list">${rules.length ? rules.map((rule) => `<div class="rule-card card"><div><b>${escapeHtml(rule.name)}</b><div>${escapeHtml(rule.field)} ${escapeHtml(rule.operator)}「${escapeHtml(rule.value)}」→ ${escapeHtml(rule.category)}</div></div><button class="danger" data-id="${rule.id}">刪除</button></div>`).join('') : '<div class="card loading">還沒有分類規則。新規則會在下次同步時套用。</div>'}</div></div>`;
  target.querySelector('.inline-panel-close')?.addEventListener('click', () => renderRoute());
  target.querySelector('#rule-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api('/api/rules', { method: 'POST', body: JSON.stringify(data) }); showNotice('分類規則已新增'); await mountRules(target, embedded); } catch (error) { showNotice(error.message, true); } });
  target.querySelectorAll('.rule-card button').forEach((button) => button.addEventListener('click', async () => { await api(`/api/rules/${button.dataset.id}`, { method: 'DELETE' }); await mountRules(target, embedded); }));
}

async function renderRules() {
  title.textContent = '分類規則';
  await mountRules(view);
}

function renderHelp() {
  title.textContent = '說明與免責聲明';
  view.innerHTML = `<div class="help">
    <section class="card"><h2>開始使用</h2><ol><li>到「信箱帳號」加入 Gmail 或 Yahoo/IMAP 帳號。</li><li>按「同步全部」下載最近 200 封收件匣郵件的本機索引。</li><li>建立分類規則，下一次同步時自動分類。</li><li>刪除、已讀狀態與寄信會直接操作所選的遠端信箱。</li></ol><p>程式只監聽 <span class="code">127.0.0.1</span>。資料庫及加密金鑰位於專案的 <span class="code">data/</span> 目錄，已被 Git 忽略。</p></section>
    <section class="card"><h2>帳號安全</h2><p>Gmail 採用 OAuth 2.0，程式不會取得 Gmail 密碼。Yahoo 或一般 IMAP 帳號應使用服務商提供的應用程式密碼。請勿將 <span class="code">data/</span>、OAuth Client Secret 或應用程式密碼提交到 Git。</p><p>郵件中的 HTML 會在禁止腳本的隔離框架內顯示。開啟外部連結或下載附件前，仍應確認寄件者及網址。</p></section>
    <section class="card disclaimer"><h2>免責聲明</h2><p>MailBox Manager 是個人郵件管理工具，以「現狀」提供。使用者須自行確認 Google、Yahoo 及其他郵件服務商的服務條款、API 政策與帳號安全要求。</p><p>同步、標記已讀、寄送及刪除等操作可能直接變更遠端信箱。使用前請備份重要郵件並先以測試帳號驗證設定。開發者不保證郵件資料、同步結果、通知時效或第三方服務持續可用，亦不對誤刪、未送達、資料遺失、帳號限制、憑證外洩或任何直接與間接損失負責。</p><p>本工具不提供法律、財務或資安保證。若用於工作、受管制資料或多人環境，應先由組織管理者與專業人員完成權限、保存、隱私及合規審查。</p></section>
    <section class="card"><h2>目前範圍</h2><p>第一版支援 Gmail、Yahoo 與標準 IMAP/SMTP。LINE Bot、背景排程、附件管理及 Microsoft Graph 預留為後續功能。</p></section>
  </div>`;
}

async function renderRoute() {
  if (location.hash !== '#inbox') history.replaceState(null, '', '#inbox');
  view.innerHTML = '';
  syncButton.hidden = false;
  title.textContent = '統一收件匣';
  try { await renderInbox(); view.focus(); } catch (error) { view.innerHTML = `<div class="card loading">載入失敗：${escapeHtml(error.message)}</div>`; }
}

composeButton.addEventListener('click', () => openCompose());
composeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = composeForm.querySelector('[type="submit"]');
  setBusy(button, true, '寄送中…');
  const data = Object.fromEntries(new FormData(composeForm));
  data.cc = data.cc ? data.cc.split(',').map((value) => value.trim()).filter(Boolean) : [];
  if (composeForm.dataset.inReplyTo) data.inReplyTo = composeForm.dataset.inReplyTo;
  try {
    await api('/api/send', { method: 'POST', body: JSON.stringify(data) });
    composeDialog.close();
    composeForm.reset();
    showNotice('郵件已寄出');
  } catch (error) { showNotice(error.message, true); }
  finally { setBusy(button, false); }
});
document.querySelector('#compose-cancel').addEventListener('click', () => { composeDialog.close(); composeForm.reset(); });
document.querySelector('#compose-close').addEventListener('click', () => { composeDialog.close(); composeForm.reset(); });
helpButton.addEventListener('click', () => helpDialog.showModal());
document.querySelector('#help-close').addEventListener('click', () => helpDialog.close());
document.querySelector('#help-done').addEventListener('click', () => helpDialog.close());
[composeDialog, helpDialog].forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
document.querySelector('#download-message').addEventListener('click', () => { if (actionMessageId) downloadMessage(actionMessageId); });
document.addEventListener('pointerdown', (event) => { if (!messageActionMenu.hidden && !messageActionMenu.contains(event.target)) hideMessageMenu(); });
window.addEventListener('scroll', hideMessageMenu, { passive: true });

syncButton.addEventListener('click', async () => {
  setBusy(syncButton, true, '同步中…');
  try { const results = await api('/api/sync', { method: 'POST' }); const count = results.filter((x) => x.ok).reduce((sum, x) => sum + x.count, 0); const failed = results.filter((x) => !x.ok); showNotice(failed.length ? `同步 ${count} 封，${failed.length} 個帳號失敗：${failed[0].error}` : `已同步 ${count} 封郵件`, failed.length > 0); await renderRoute(); }
  catch (error) { showNotice(error.message, true); }
  finally { setBusy(syncButton, false); }
});
window.addEventListener('hashchange', renderRoute);
renderRoute();
