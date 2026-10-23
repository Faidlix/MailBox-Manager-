const view = document.querySelector('#view');
const title = document.querySelector('#page-title');
const noticeRoot = document.querySelector('#notice');
const syncButton = document.querySelector('#sync-button');
const composeButton = document.querySelector('#compose-button');
const composeDialog = document.querySelector('#compose-dialog');
const composeForm = document.querySelector('#compose-form');
const helpButton = document.querySelector('#help-button');
const helpDialog = document.querySelector('#help-dialog');
const quickFolderDialog = document.querySelector('#quick-folder-dialog');
const quickFolderForm = document.querySelector('#quick-folder-form');
const cleanupDialog = document.querySelector('#cleanup-dialog');
const cleanupForm = document.querySelector('#cleanup-form');
const messageFilterDialog = document.querySelector('#message-filter-dialog');
const messageFilterForm = document.querySelector('#message-filter-form');
const filterDrawerToggle = document.querySelector('#filter-drawer-toggle');
const filterDrawerBackdrop = document.querySelector('#filter-drawer-backdrop');
const messageActionMenu = document.querySelector('#message-action-menu');
let actionMessageId = null;
let accounts = [];
let messages = [];
const MESSAGE_PAGE_SIZE = 100;
let messagePage = 1;
let selectionScopeRequested = false;
const selectedMessageIds = new Set();
const QUICK_FOLDERS_KEY = 'mailbox-manager-quick-folders-v1';
const loadQuickFolders = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(QUICK_FOLDERS_KEY));
    return { accounts: Array.isArray(saved?.accounts) ? saved.accounts : [], categories: Array.isArray(saved?.categories) ? saved.categories : [] };
  } catch { return { accounts: [], categories: [] }; }
};
let quickFolders = loadQuickFolders();
let quickFolderType = 'accounts';
let cleanupMode = 'date';
let activeDetailOutsideHandler = null;
const saveQuickFolders = () => localStorage.setItem(QUICK_FOLDERS_KEY, JSON.stringify(quickFolders));
let loadedMessages = [];
const messageViewFilter = { fromDate: '', toDate: '', sender: '', subject: '' };
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
const demoTemplates = [
  ['銀行', '遠山銀行', 'bank@demo.example', '帳戶交易通知', '您的帳戶有一筆新的交易紀錄。'],
  ['Steam', 'Steam', 'noreply@steampowered.com', '願望清單遊戲特價通知', '您追蹤的遊戲推出新的限時優惠。'],
  ['專案', '專案小組', 'project@company.example', '專案進度更新', '本週里程碑與待辦事項已更新。'],
  ['購物', '購物平台', 'order@shop.example', '訂單配送進度', '您的訂單已有新的物流狀態。'],
  ['帳單', '公共事業帳務中心', 'billing@utility.example', '本月電子帳單', '本月電子帳單已產生，請確認繳費期限。'],
  ['社群', '社群通知', 'updates@social.example', '您有新的互動通知', '朋友在您的貼文中留下了新回覆。'],
  ['工作', '人資系統', 'hr@company.example', '公司內部公告', '請查看本週最新的內部公告內容。'],
  ['旅遊', '旅程服務', 'booking@travel.example', '行程提醒與資訊更新', '您的預訂行程有新的提醒資訊。'],
];
for (let id = 7; id <= 1000; id += 1) {
  const [category, senderName, senderEmail, subject, snippet] = demoTemplates[(id - 7) % demoTemplates.length];
  const accountId = id % 2 ? 1 : 2;
  const folder = id % 211 === 0 ? 'TRASH' : id % 157 === 0 ? 'SPAM' : id % 43 === 0 ? 'ARCHIVE' : 'INBOX';
  demoMessages.push({ id, account_id: accountId, remote_id: `demo-${id}`, thread_id: `demo-thread-${id}`, folder, sender_name: senderName, sender_email: senderEmail, recipients: [accountId === 1 ? 'personal.demo@gmail.com' : 'work.demo@yahoo.com'], subject: `${subject} #${String(id).padStart(4, '0')}`, snippet, text_body: `您好：\n\n${snippet}\n\n這是第 ${id} 封介面壓力測試範例郵件。`, html_body: '', received_at: new Date(Date.now() - id * 5 * 60_000).toISOString(), is_read: id % 3 === 0 ? 0 : 1, is_starred: id % 17 === 0 ? 1 : 0, has_attachments: id % 29 === 0 ? 1 : 0, category, account_email: accountId === 1 ? 'personal.demo@gmail.com' : 'work.demo@yahoo.com', provider: accountId === 1 ? 'gmail' : 'imap', labels: [] });
}
let demoRules = [
  { id: 1, name: '銀行帳務', field: 'sender', operator: 'contains', value: 'bank', category: '帳單', enabled: 1 },
  { id: 2, name: '遊戲通知', field: 'sender', operator: 'contains', value: 'Steam', category: '遊戲', enabled: 1 },
];

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const toBase64 = (value = '') => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const wrapBase64 = (value) => value.match(/.{1,76}/g)?.join('\r\n') || '';
const DEMO_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="24" fill="#194c39"/><rect x="19" y="27" width="58" height="43" rx="5" fill="#fffefa"/><path d="m21 31 27 22 27-22" fill="none" stroke="#c9e667" stroke-width="7" stroke-linejoin="round"/></svg>';
const demoHtml = (message) => `<!doctype html><html><body style="margin:0;background:#f3f4ee;font-family:Arial,'Noto Sans TC',sans-serif;color:#17231d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4ee;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fffefa;border:1px solid #dde1d8;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 28px;background:#194c39;color:#fff"><img src="data:image/svg+xml;base64,${toBase64(DEMO_MARK_SVG)}" width="48" height="48" alt="MailBox Manager" style="display:block;margin-bottom:16px"><div style="font-size:13px;letter-spacing:2px;color:#c9e667;font-weight:bold">MAILBOX MANAGER DEMO</div><h1 style="margin:8px 0 0;font-size:27px;line-height:1.3;color:#fff">${escapeHtml(message.subject)}</h1></td></tr><tr><td style="padding:28px;font-size:16px;line-height:1.8"><p style="margin-top:0;color:#66736b">寄件者：${escapeHtml(message.sender_name || message.sender_email)}</p>${String(message.text_body || message.snippet || '').split(/\n\n+/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('')}<div style="margin-top:28px;padding:14px 16px;border-radius:10px;background:#eef2e9;color:#365747;font-size:13px">此為介面展示郵件；下載後可由支援 EML 的郵件程式開啟。</div></td></tr></table></td></tr></table></body></html>`;
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
    const limit = Math.min(Math.max(Number(parsed.searchParams.get('limit')) || 1000, 1), 1000);
    return structuredClone(result.slice(0, limit));
  }
  const messageMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (messageMatch && method === 'GET') {
    const message = demoMessages.find((item) => item.id === Number(messageMatch[1]));
    return structuredClone(message ? { ...message, html_body: message.html_body || demoHtml(message) } : null);
  }
  const readMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/read$/);
  if (readMatch) { const item = demoMessages.find((message) => message.id === Number(readMatch[1])); if (item) item.is_read = JSON.parse(options.body).read ? 1 : 0; return { ok: true }; }
  const starMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/star$/);
  if (starMatch && method === 'PATCH') { const item = demoMessages.find((message) => message.id === Number(starMatch[1])); if (item) item.is_starred = JSON.parse(options.body).starred ? 1 : 0; return { ok: true }; }
  const categoryMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/category$/);
  if (categoryMatch && method === 'PATCH') { const item = demoMessages.find((message) => message.id === Number(categoryMatch[1])); if (item) item.category = JSON.parse(options.body).category || '未分類'; return { ok: true }; }
  const moveMatch = parsed.pathname.match(/^\/api\/messages\/(\d+)\/move$/);
  if (moveMatch && method === 'PATCH') { const item = demoMessages.find((message) => message.id === Number(moveMatch[1])); if (item) item.folder = JSON.parse(options.body).folder; return { ok: true }; }
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
  const openDialog = document.querySelector('dialog[open]');
  (openDialog || document.body).append(noticeRoot);
  noticeRoot.innerHTML = `<div class="notice ${error ? 'error' : ''}">${escapeHtml(message)}</div>`;
  setTimeout(() => { noticeRoot.innerHTML = ''; }, 4200);
}

function setComposeVisibility(visible) {
  composeButton.hidden = !visible;
  document.body.classList.toggle('compose-available', visible);
}

function setFilterDrawer(open) {
  document.body.classList.toggle('filters-open', open);
  filterDrawerToggle.setAttribute('aria-expanded', String(open));
  filterDrawerToggle.setAttribute('aria-label', open ? '關閉信件篩選選單' : '開啟信件篩選選單');
  filterDrawerToggle.querySelector('span').textContent = open ? '×' : '☰';
  filterDrawerBackdrop.hidden = !open;
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

function messageDate(value) {
  return new Date(value.endsWith?.('Z') ? value : `${value}Z`);
}

function messageDateKey(value) {
  const date = messageDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMessageGroupDate(value) {
  const date = messageDate(value);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}（${weekday}）`;
}

function accountOptions(selected = '') {
  return accounts.map((account) => `<option value="${account.id}" ${String(account.id) === String(selected) ? 'selected' : ''}>${escapeHtml(account.email)} · ${account.provider === 'gmail' ? 'Gmail' : 'IMAP'}</option>`).join('');
}

function openQuickFolderDialog(type) {
  setFilterDrawer(false);
  setComposeVisibility(false);
  quickFolderType = type;
  quickFolderForm.reset();
  const isAccount = type === 'accounts';
  document.querySelector('#quick-folder-title').textContent = isAccount ? '新增信箱資料夾' : '新增分類資料夾';
  document.querySelector('#quick-folder-name').placeholder = isAccount ? '例如：工作信箱' : '例如：銀行';
  document.querySelector('#quick-folder-hint').textContent = isAccount ? '先建立名稱，再從標題旁的齒輪設定信箱連線。' : '先建立名稱，再從標題旁的齒輪設定自動分類規則。';
  quickFolderDialog.showModal();
  requestAnimationFrame(() => document.querySelector('#quick-folder-name').focus());
}

function quickFolderSection(type) {
  const folders = quickFolders[type];
  if (!folders.length) return '';
  const isAccount = type === 'accounts';
  return `<section class="quick-folder-section"><h3>${isAccount ? '待設定的信箱資料夾' : '分類資料夾'}</h3><div class="quick-folder-list">${folders.map((folder) => `<div class="quick-folder-item"><span>${escapeHtml(folder.name)}</span><button class="danger quick-folder-delete" type="button" data-folder-type="${type}" data-folder-id="${escapeHtml(folder.id)}" aria-label="刪除 ${escapeHtml(folder.name)}">刪除</button></div>`).join('')}</div><p class="quick-folder-note">${isAccount ? '使用下方的 Gmail 或 IMAP 表單完成連線。' : '使用下方規則，把符合條件的郵件歸入這些分類。'}</p></section>`;
}

function bindQuickFolderDeletes(target, refresh) {
  target.querySelectorAll('.quick-folder-delete').forEach((button) => button.addEventListener('click', async () => {
    const type = button.dataset.folderType;
    quickFolders[type] = quickFolders[type].filter((folder) => folder.id !== button.dataset.folderId);
    saveQuickFolders();
    showNotice('資料夾已刪除');
    await refresh();
  }));
}

function applyMessageViewFilter(source) {
  const from = messageViewFilter.fromDate ? new Date(`${messageViewFilter.fromDate}T00:00:00`).getTime() : null;
  const to = messageViewFilter.toDate ? new Date(`${messageViewFilter.toDate}T23:59:59.999`).getTime() : null;
  const sender = messageViewFilter.sender.toLocaleLowerCase();
  const subject = messageViewFilter.subject.toLocaleLowerCase();
  return source.filter((message) => {
    const received = new Date(message.received_at).getTime();
    const senderText = `${message.sender_name || ''} ${message.sender_email || ''}`.toLocaleLowerCase();
    const subjectText = String(message.subject || '').toLocaleLowerCase();
    return (!from || received >= from) && (!to || received <= to) && (!sender || senderText.includes(sender)) && (!subject || subjectText.includes(subject));
  });
}

function openMessageFilterDialog() {
  messageFilterForm.fromDate.value = messageViewFilter.fromDate;
  messageFilterForm.toDate.value = messageViewFilter.toDate;
  messageFilterForm.sender.value = messageViewFilter.sender;
  messageFilterForm.subject.value = messageViewFilter.subject;
  messageFilterDialog.showModal();
}

async function renderInbox() {
  setFilterDrawer(false);
  title.textContent = '統一收件匣';
  view.append(document.querySelector('#inbox-template').content.cloneNode(true));
  await loadAccounts();
  const allMessages = await api('/api/messages?state=all');
  const categories = [...new Set([...allMessages.map((message) => message.category).filter(Boolean), ...quickFolders.categories.map((folder) => folder.name)])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const states = [['all', '全部郵件'], ['unread', '未讀'], ['starred', '星號'], ['archive', '封存'], ['spam', '垃圾郵件'], ['trash', '垃圾桶']];
  const inboxContent = document.querySelector('#inbox-content');
  const mailShell = () => `<div class="mail-toolbar card" aria-label="信件操作列">
    <label class="select-all-control"><input id="select-all-messages" type="checkbox"><span>全選</span></label>
    <button id="message-filter" class="toolbar-action" type="button"><span aria-hidden="true">☷</span><span id="message-filter-label">篩選</span></button><button id="message-filter-reset" class="toolbar-action filter-reset" type="button" aria-label="重設全部篩選" title="重設全部篩選" hidden>×</button>
    <span id="selected-count" class="selected-count">未選取</span><div id="selection-scope" class="selection-scope" hidden><span>選取：</span><button id="select-current-page" type="button">本頁 100 封</button><button id="select-all-results" type="button">全部信件</button></div>
    <button id="bulk-star" class="toolbar-action icon-only" type="button" disabled aria-label="切換星號" title="星號"><span aria-hidden="true">★</span></button>
    <div class="toolbar-menu-wrap"><button id="bulk-move" class="toolbar-action" type="button" disabled>分類</button><div id="move-options" class="toolbar-menu" hidden><button type="button" data-bulk-category="__new__">＋ 新增分類</button>${categories.map((category) => `<button type="button" data-bulk-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')}<button type="button" data-bulk-category="未分類">未分類</button></div></div>
    <button id="bulk-spam" class="toolbar-action" type="button" disabled>垃圾信</button>
    <div class="toolbar-menu-wrap"><button id="bulk-trash" class="toolbar-action danger-action icon-only" type="button" aria-label="垃圾桶" title="垃圾桶"><svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button><div id="trash-options" class="toolbar-menu trash-menu" hidden><button type="button" data-trash-mode="all"><b>全部信件</b><small>移除目前選取的全部信件</small></button><button type="button" data-trash-mode="unstarred"><b>排除星號</b><small>保留已加星的選取信件</small></button><button type="button" data-trash-mode="date"><b>指定日期之前</b><small>設定日期並清理較早的信件</small></button><button type="button" data-trash-mode="filter"><b>寄件者／關鍵字</b><small>依寄件者或信件內容條件清理</small></button></div></div>
  </div><div class="mail-layout"><div id="message-list" class="message-list card"><nav id="message-pagination" class="message-pagination" aria-label="信件分頁" hidden></nav><div id="message-list-scroll" class="message-list-scroll"></div></div><article id="message-detail" class="message-detail card empty-state"><div><b>選擇一封郵件</b><p>郵件內容會顯示在這裡。</p></div></article></div>`;
  const setSettingsState = (active = '') => {
    document.querySelector('#account-settings').setAttribute('aria-pressed', String(active === 'accounts'));
    document.querySelector('#category-settings').setAttribute('aria-pressed', String(active === 'rules'));
  };
  const renderFilters = () => {
    document.querySelector('#account-filters').innerHTML = `<button class="filter-chip ${inboxFilters.accountId ? '' : 'active'}" data-account="">所有帳號</button>${accounts.map((account) => `<button class="filter-chip ${String(inboxFilters.accountId) === String(account.id) ? 'active' : ''}" data-account="${account.id}"><span class="chip-dot"></span>${escapeHtml(account.display_name || account.email)}</button>`).join('')}${quickFolders.accounts.map((folder) => `<button class="filter-chip quick-folder-chip" data-quick-account="${escapeHtml(folder.id)}"><span class="chip-dot"></span>${escapeHtml(folder.name)}</button>`).join('')}`;
    document.querySelector('#category-filters').innerHTML = `<button class="filter-chip ${inboxFilters.category ? '' : 'active'}" data-category="">所有分類</button>${categories.map((category) => `<button class="filter-chip ${inboxFilters.category === category ? 'active' : ''}" data-category="${escapeHtml(category)}"><span class="chip-dot"></span>${escapeHtml(category)}</button>`).join('')}`;
    document.querySelector('#mail-filters').innerHTML = states.map(([value, label]) => `<button class="filter-chip ${inboxFilters.state === value ? 'active' : ''}" data-state="${value}">${label}</button>`).join('');
  };
  inboxContent.innerHTML = mailShell();
  bindBulkToolbar();
  renderFilters();
  const update = async () => {
    if (!document.querySelector('#message-list')) { inboxContent.innerHTML = mailShell(); bindBulkToolbar(); }
    setSettingsState();
    const search = document.querySelector('#search-input').value;
    const query = new URLSearchParams({ ...(search && { search }), ...(inboxFilters.accountId && { accountId: inboxFilters.accountId }), ...(inboxFilters.category && { category: inboxFilters.category }), state: inboxFilters.state, limit: '1000' });
    document.querySelector('#message-pagination').hidden = true;
    document.querySelector('#message-list-scroll').innerHTML = '<div class="loading">載入郵件中…</div>';
    loadedMessages = await api(`/api/messages?${query}`);
    messages = applyMessageViewFilter(loadedMessages);
    messagePage = 1;
    selectionScopeRequested = false;
    selectedMessageIds.clear();
    renderMessageList();
  };
  let timer;
  document.querySelector('#search-input').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  document.querySelector('#search-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') setFilterDrawer(false); });
  document.querySelector('#account-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-account]'); if (!button) return; inboxFilters.accountId = button.dataset.account; renderFilters(); update(); setFilterDrawer(false); });
  document.querySelector('#account-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-quick-account]'); if (!button) return; const folder = quickFolders.accounts.find((item) => item.id === button.dataset.quickAccount); if (folder) showNotice(`「${folder.name}」已新增，請按標題旁的齒輪完成信箱連線。`); });
  document.querySelector('#category-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; inboxFilters.category = button.dataset.category; renderFilters(); update(); setFilterDrawer(false); });
  document.querySelector('#mail-filters').addEventListener('click', (event) => { const button = event.target.closest('[data-state]'); if (!button) return; inboxFilters.state = button.dataset.state; renderFilters(); update(); setFilterDrawer(false); });
  const openSettings = async (type) => {
    setFilterDrawer(false);
    setComposeVisibility(false);
    document.body.classList.add('settings-open');
    setSettingsState(type);
    if (type === 'accounts') await mountAccounts(inboxContent, true);
    else await mountRules(inboxContent, true);
    requestAnimationFrame(() => inboxContent.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  document.querySelector('#account-settings').addEventListener('click', () => openSettings('accounts'));
  document.querySelector('#category-settings').addEventListener('click', () => openSettings('rules'));
  document.querySelector('#add-account').addEventListener('click', () => openQuickFolderDialog('accounts'));
  document.querySelector('#add-category').addEventListener('click', () => openQuickFolderDialog('categories'));
  await update();
}

function updateBulkToolbar() {
  const selected = messages.filter((message) => selectedMessageIds.has(message.id));
  const pageStart = (messagePage - 1) * MESSAGE_PAGE_SIZE;
  const pageMessages = messages.slice(pageStart, pageStart + MESSAGE_PAGE_SIZE);
  const selectedOnPage = pageMessages.filter((message) => selectedMessageIds.has(message.id));
  const selectAll = document.querySelector('#select-all-messages');
  if (!selectAll) return;
  selectAll.checked = pageMessages.length > 0 && selectedOnPage.length === pageMessages.length;
  selectAll.indeterminate = selectedOnPage.length > 0 && selectedOnPage.length < pageMessages.length;
  document.querySelector('#selected-count').textContent = selected.length ? `已選 ${selected.length} 封` : `共 ${messages.length} 封`;
  const selectionScope = document.querySelector('#selection-scope');
  selectionScope.hidden = !selectionScopeRequested;
  document.querySelector('#select-current-page').textContent = `本頁 ${pageMessages.length} 封`;
  const selectAllResults = document.querySelector('#select-all-results');
  selectAllResults.textContent = `全部 ${messages.length} 封`;
  selectAllResults.hidden = messages.length <= pageMessages.length;
  const filterActive = Object.values(messageViewFilter).some(Boolean) || Boolean(inboxFilters.accountId || inboxFilters.category || inboxFilters.state !== 'all' || document.querySelector('#search-input')?.value);
  const filterLabels = [];
  if (inboxFilters.category) filterLabels.push(inboxFilters.category);
  if (inboxFilters.accountId) {
    const account = accounts.find((item) => String(item.id) === String(inboxFilters.accountId));
    if (account) filterLabels.push(account.display_name || account.email);
  }
  if (messageViewFilter.sender) filterLabels.push(messageViewFilter.sender);
  if (messageViewFilter.fromDate && messageViewFilter.fromDate === messageViewFilter.toDate) filterLabels.push(formatMessageGroupDate(`${messageViewFilter.fromDate}T12:00:00`));
  else if (messageViewFilter.fromDate || messageViewFilter.toDate) filterLabels.push('日期');
  if (messageViewFilter.subject) filterLabels.push(messageViewFilter.subject);
  const stateLabels = { unread: '未讀', starred: '星號', archive: '封存', spam: '垃圾郵件', trash: '垃圾桶' };
  if (stateLabels[inboxFilters.state]) filterLabels.push(stateLabels[inboxFilters.state]);
  const searchText = document.querySelector('#search-input')?.value.trim();
  if (searchText) filterLabels.push(searchText);
  document.querySelector('#message-filter-label').textContent = filterLabels.length ? `篩選：${filterLabels.join('、')}` : '篩選';
  document.querySelector('#message-filter').classList.toggle('active', filterActive);
  document.querySelector('#message-filter').setAttribute('aria-pressed', String(filterActive));
  document.querySelector('#message-filter-reset').hidden = !filterActive;
  document.querySelectorAll('.toolbar-action').forEach((button) => { button.disabled = selected.length === 0 && !['bulk-trash', 'message-filter', 'message-filter-reset'].includes(button.id); });
  document.querySelector('#bulk-star span').textContent = selected.length && selected.every((message) => message.is_starred) ? '☆' : '★';
}

async function toggleMessageStar(id) {
  const message = messages.find((item) => item.id === id);
  if (!message) return;
  const starred = !message.is_starred;
  try {
    await api(`/api/messages/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) });
    message.is_starred = starred ? 1 : 0;
    const demoMessage = demoMode && demoMessages.find((item) => item.id === id);
    if (demoMessage) demoMessage.is_starred = message.is_starred;
    renderMessageList();
    showNotice(starred ? '已加上星號' : '已移除星號');
  } catch (error) { showNotice(error.message, true); }
}

async function moveSelectedMessages(folder, excludeStarred = false) {
  const selected = messages.filter((message) => selectedMessageIds.has(message.id));
  const targets = excludeStarred ? selected.filter((message) => !message.is_starred) : selected;
  if (!targets.length) { showNotice(excludeStarred ? '選取的信件都有星號，未移動任何信件' : '請先選取信件', true); return; }
  await moveMessages(targets, folder);
}

async function categorizeSelectedMessages(category) {
  const selected = messages.filter((message) => selectedMessageIds.has(message.id));
  if (!selected.length) { showNotice('請先選取信件', true); return; }
  if (category === '__new__') {
    category = prompt('輸入新分類名稱', '')?.trim();
    if (!category) return;
    if (!quickFolders.categories.some((folder) => folder.name === category)) {
      quickFolders.categories.push({ id: `category-${Date.now()}`, name: category });
      saveQuickFolders();
    }
  }
  try {
    await runInBatches(selected, (message) => api(`/api/messages/${message.id}/category`, { method: 'PATCH', body: JSON.stringify({ category }) }));
    selected.forEach((message) => {
      message.category = category;
      const loaded = loadedMessages.find((item) => item.id === message.id);
      if (loaded) loaded.category = category;
      const demo = demoMessages.find((item) => item.id === message.id);
      if (demo) demo.category = category;
    });
    selectedMessageIds.clear();
    renderMessageList();
    showNotice(`已將 ${selected.length} 封信件分類為「${category}」`);
  } catch (error) { showNotice(error.message, true); }
}

async function runInBatches(items, task, size = 20) {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(task));
}

async function moveMessages(targets, folder) {
  try {
    await runInBatches(targets, (message) => api(`/api/messages/${message.id}/move`, { method: 'PATCH', body: JSON.stringify({ folder }) }));
    selectedMessageIds.clear();
    const labels = { INBOX: '收件匣', ARCHIVE: '封存', SPAM: '垃圾郵件', TRASH: '垃圾桶' };
    showNotice(`已將 ${targets.length} 封信件移至${labels[folder]}`);
    await renderRoute();
  } catch (error) { showNotice(error.message, true); }
}

function openCleanupDialog(mode) {
  cleanupMode = mode;
  cleanupForm.reset();
  const byDate = mode === 'date';
  document.querySelector('#cleanup-title').textContent = byDate ? '刪除指定日期之前的信件' : '依寄件者或關鍵字刪除';
  document.querySelector('#cleanup-date-fields').hidden = !byDate;
  document.querySelector('#cleanup-filter-fields').hidden = byDate;
  document.querySelector('#cleanup-before-date').required = byDate;
  cleanupDialog.showModal();
}

function bindBulkToolbar() {
  const selectAll = document.querySelector('#select-all-messages');
  if (!selectAll) return;
  selectAll.addEventListener('change', () => {
    selectionScopeRequested = selectAll.checked;
    const pageStart = (messagePage - 1) * MESSAGE_PAGE_SIZE;
    messages.slice(pageStart, pageStart + MESSAGE_PAGE_SIZE).forEach((message) => {
      if (selectAll.checked) selectedMessageIds.add(message.id); else selectedMessageIds.delete(message.id);
    });
    renderMessageList();
  });
  document.querySelector('#select-current-page').addEventListener('click', () => {
    selectedMessageIds.clear();
    const pageStart = (messagePage - 1) * MESSAGE_PAGE_SIZE;
    messages.slice(pageStart, pageStart + MESSAGE_PAGE_SIZE).forEach((message) => selectedMessageIds.add(message.id));
    renderMessageList();
  });
  document.querySelector('#select-all-results').addEventListener('click', () => {
    selectedMessageIds.clear();
    messages.forEach((message) => selectedMessageIds.add(message.id));
    renderMessageList();
  });
  document.querySelector('#message-filter').addEventListener('click', openMessageFilterDialog);
  document.querySelector('#message-filter-reset').addEventListener('click', async () => {
    Object.assign(messageViewFilter, { fromDate: '', toDate: '', sender: '', subject: '' });
    Object.assign(inboxFilters, { accountId: '', category: '', state: 'all' });
    const search = document.querySelector('#search-input');
    if (search) search.value = '';
    selectedMessageIds.clear();
    selectionScopeRequested = false;
    await renderRoute();
    showNotice('已重設全部篩選');
  });
  document.querySelector('#bulk-star').addEventListener('click', async () => {
    const selected = messages.filter((message) => selectedMessageIds.has(message.id));
    const starred = !selected.every((message) => message.is_starred);
    try {
      await runInBatches(selected, (message) => api(`/api/messages/${message.id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }));
      selected.forEach((message) => { message.is_starred = starred ? 1 : 0; });
      renderMessageList();
      showNotice(starred ? '已為選取信件加上星號' : '已移除選取信件的星號');
    } catch (error) { showNotice(error.message, true); }
  });
  const moveMenu = document.querySelector('#move-options');
  const trashMenu = document.querySelector('#trash-options');
  const toggleToolbarMenu = (menu, otherMenu, trigger) => {
    const opening = menu.hidden;
    otherMenu.hidden = true;
    otherMenu.classList.remove('floating-toolbar-menu');
    menu.hidden = !opening;
    if (!opening) { menu.classList.remove('floating-toolbar-menu'); return; }
    if (matchMedia('(max-width:700px)').matches) {
      const rect = trigger.getBoundingClientRect();
      menu.classList.add('floating-toolbar-menu');
      menu.style.setProperty('--menu-top', `${Math.min(rect.bottom + 6, innerHeight * .55)}px`);
    }
    setTimeout(() => document.addEventListener('click', (event) => {
      if (!event.target.closest('.toolbar-menu-wrap')) {
        menu.hidden = true;
        menu.classList.remove('floating-toolbar-menu');
      }
    }, { once: true }), 0);
  };
  const moveTrigger = document.querySelector('#bulk-move');
  const trashTrigger = document.querySelector('#bulk-trash');
  moveTrigger.addEventListener('click', () => toggleToolbarMenu(moveMenu, trashMenu, moveTrigger));
  trashTrigger.addEventListener('click', () => toggleToolbarMenu(trashMenu, moveMenu, trashTrigger));
  moveMenu.querySelectorAll('[data-bulk-category]').forEach((button) => button.addEventListener('click', () => { moveMenu.hidden = true; categorizeSelectedMessages(button.dataset.bulkCategory); }));
  trashMenu.querySelectorAll('[data-trash-mode]').forEach((button) => button.addEventListener('click', () => {
    trashMenu.hidden = true;
    const mode = button.dataset.trashMode;
    if (mode === 'date' || mode === 'filter') openCleanupDialog(mode);
    else moveSelectedMessages('TRASH', mode === 'unstarred');
  }));
  document.querySelector('#bulk-spam').addEventListener('click', () => moveSelectedMessages('SPAM'));
  updateBulkToolbar();
}

function renderMessageList() {
  const list = document.querySelector('#message-list-scroll');
  const pagination = document.querySelector('#message-pagination');
  if (!messages.length) {
    pagination.hidden = true;
    pagination.innerHTML = '';
    list.innerHTML = `<div class="loading"><b>目前沒有郵件</b><p>${accounts.length ? '按「同步全部」取得最新郵件。' : '先到「信箱帳號」連線一個帳號。'}</p></div>`;
    updateBulkToolbar();
    return;
  }
  const totalPages = Math.max(1, Math.ceil(messages.length / MESSAGE_PAGE_SIZE));
  messagePage = Math.min(Math.max(messagePage, 1), totalPages);
  const pageStart = (messagePage - 1) * MESSAGE_PAGE_SIZE;
  const pageMessages = messages.slice(pageStart, pageStart + MESSAGE_PAGE_SIZE);
  pagination.hidden = false;
  pagination.innerHTML = `<button type="button" data-page-direction="previous" ${messagePage === 1 ? 'disabled' : ''}>上一頁</button><span>第 ${messagePage} / ${totalPages} 頁 · 本頁 ${pageMessages.length} 封 · 共 ${messages.length} 封</span><button type="button" data-page-direction="next" ${messagePage === totalPages ? 'disabled' : ''}>下一頁</button>`;
  const messageRow = (message) => `
    <div class="message-swipe" data-id="${message.id}">
      <div class="swipe-action archive"><span>⇥</span>封存</div><div class="swipe-action delete">刪除<span>⌫</span></div>
      <div class="message-row ${message.is_read ? '' : 'unread'} ${selectedMessageIds.has(message.id) ? 'batch-selected' : ''}" data-id="${message.id}" tabindex="0" role="button" aria-label="${escapeHtml(message.subject)}">
        <div class="message-primary-line"><input class="message-select" type="checkbox" ${selectedMessageIds.has(message.id) ? 'checked' : ''} aria-label="選取 ${escapeHtml(message.subject)}"><button class="message-star ${message.is_starred ? 'active' : ''}" type="button" aria-label="${message.is_starred ? '移除' : '加上'}星號" aria-pressed="${Boolean(message.is_starred)}">${message.is_starred ? '★' : '☆'}</button><div class="subject">${escapeHtml(message.subject)}</div><button class="date message-date-filter" type="button" data-date-filter="${messageDateKey(message.received_at)}" aria-label="只顯示 ${formatMessageGroupDate(message.received_at)} 的信件">${formatMessageGroupDate(message.received_at)}</button></div>
        <div class="message-secondary-line"><span class="snippet">${escapeHtml(message.snippet)}</span><button class="sender message-source-filter" type="button" data-sender-filter="${escapeHtml(message.sender_name || message.sender_email)}">${escapeHtml(message.sender_name || message.sender_email)}</button><button class="category-pill message-category-filter" type="button" data-category-filter="${escapeHtml(message.category)}">${escapeHtml(message.category)}</button></div>
      </div>
    </div>`;
  list.innerHTML = pageMessages.map(messageRow).join('');
  pagination.querySelectorAll('[data-page-direction]').forEach((button) => button.addEventListener('click', () => {
    messagePage += button.dataset.pageDirection === 'next' ? 1 : -1;
    renderMessageList();
    list.scrollTop = 0;
  }));
  list.querySelectorAll('.message-source-filter').forEach((button) => button.addEventListener('click', () => {
    const sender = button.dataset.senderFilter;
    messageViewFilter.sender = messageViewFilter.sender === sender ? '' : sender;
    messages = applyMessageViewFilter(loadedMessages);
    messagePage = 1;
    selectionScopeRequested = false;
    selectedMessageIds.clear();
    renderMessageList();
    showNotice(messageViewFilter.sender ? `只顯示「${sender}」的信件` : '已取消寄件來源篩選');
  }));
  list.querySelectorAll('.message-category-filter').forEach((button) => button.addEventListener('click', () => {
    const category = inboxFilters.category === button.dataset.categoryFilter ? '' : button.dataset.categoryFilter;
    const target = [...document.querySelectorAll('#category-filters [data-category]')].find((item) => item.dataset.category === category);
    if (target) target.click();
  }));
  list.querySelectorAll('.message-date-filter').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.dateFilter;
    const active = messageViewFilter.fromDate === key && messageViewFilter.toDate === key;
    messageViewFilter.fromDate = active ? '' : key;
    messageViewFilter.toDate = active ? '' : key;
    messages = applyMessageViewFilter(loadedMessages);
    messagePage = 1;
    selectionScopeRequested = false;
    selectedMessageIds.clear();
    renderMessageList();
    showNotice(active ? '已取消日期篩選' : `只顯示 ${button.textContent.trim()} 的信件`);
  }));
  list.querySelectorAll('.message-row').forEach((row) => {
    const id = Number(row.dataset.id);
    const open = (event) => { if (!row.dataset.ignoreClick && !event?.target.closest('button,input')) openMessage(id); };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') open(); });
    row.querySelector('.message-select').addEventListener('change', (event) => {
      if (event.currentTarget.checked) selectedMessageIds.add(id); else selectedMessageIds.delete(id);
      row.classList.toggle('batch-selected', event.currentTarget.checked);
      updateBulkToolbar();
    });
    row.querySelector('.message-star').addEventListener('click', () => toggleMessageStar(id));
    bindMessageGestures(row, id);
  });
  updateBulkToolbar();
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
    return true;
  } catch (error) { showNotice(error.message, true); return false; }
}

async function trashMessage(id) {
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
  let committed = false;
  let rowWidth = 0;
  let pressTimer;
  const swipe = row.closest('.message-swipe');
  const reset = () => { row.classList.remove('dragging'); row.style.transform = ''; swipe.classList.remove('swipe-left', 'swipe-right'); swipe.style.removeProperty('--swipe-progress'); };
  const commit = async (direction) => {
    if (committed) return;
    committed = true;
    tracking = false;
    clearTimeout(pressTimer);
    row.dataset.ignoreClick = 'true';
    row.classList.remove('dragging');
    row.style.transform = `translateX(${direction === 'delete' ? '-' : ''}100%)`;
    navigator.vibrate?.(20);
    const ok = direction === 'delete' ? await trashMessage(id) : await archiveMessage(id);
    if (!ok) { committed = false; reset(); setTimeout(() => { delete row.dataset.ignoreClick; }, 350); }
  };
  row.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button,input')) return;
    tracking = true; moved = false; longPressed = false; committed = false; deltaX = 0; rowWidth = row.getBoundingClientRect().width;
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
    deltaX = Math.max(-rowWidth, Math.min(rowWidth, dx));
    swipe.classList.toggle('swipe-left', deltaX < 0);
    swipe.classList.toggle('swipe-right', deltaX > 0);
    row.classList.add('dragging');
    row.style.transform = `translateX(${deltaX}px)`;
    const actionThreshold = rowWidth * 0.75;
    swipe.style.setProperty('--swipe-progress', String(Math.min(1, Math.abs(deltaX) / actionThreshold)));
    if (Math.abs(deltaX) >= actionThreshold) void commit(deltaX < 0 ? 'delete' : 'archive');
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
    reset();
  };
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', () => { if (committed) return; tracking = false; clearTimeout(pressTimer); reset(); });
  row.addEventListener('contextmenu', (event) => { event.preventDefault(); clearTimeout(pressTimer); showMessageMenu(id, event.clientX, event.clientY); });
}

function demoEml(message) {
  const relatedBoundary = `mailbox-related-${message.id}`;
  const alternativeBoundary = `mailbox-alternative-${message.id}`;
  const html = (message.html_body || demoHtml(message)).replace(/data:image\/svg\+xml;base64,[^"']+/g, 'cid:mailbox-demo-mark');
  const headers = [
    `From: ${message.sender_name ? `"${message.sender_name.replaceAll('"', '')}" ` : ''}<${message.sender_email}>`,
    `To: ${(message.recipients || []).join(', ')}`,
    `Date: ${new Date(message.received_at).toUTCString()}`,
    `Subject: =?UTF-8?B?${toBase64(message.subject || '(無主旨)')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
  ];
  const parts = [
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, '',
    `--${alternativeBoundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrapBase64(toBase64(message.text_body || message.snippet || '')),
    `--${alternativeBoundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrapBase64(toBase64(html)),
    `--${alternativeBoundary}--`,
    `--${relatedBoundary}`, 'Content-Type: image/svg+xml; name="mailbox-mark.svg"', 'Content-Transfer-Encoding: base64', 'Content-ID: <mailbox-demo-mark>', 'Content-Disposition: inline; filename="mailbox-mark.svg"', '', wrapBase64(toBase64(DEMO_MARK_SVG)),
  ];
  if (message.has_attachments) parts.push(`--${relatedBoundary}`, 'Content-Type: text/plain; name="demo-attachment.txt"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="demo-attachment.txt"', '', wrapBase64(toBase64('MailBox Manager 示範附件\n')));
  parts.push(`--${relatedBoundary}--`, '');
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
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
  if (activeDetailOutsideHandler) {
    document.removeEventListener('click', activeDetailOutsideHandler);
    activeDetailOutsideHandler = null;
  }
  const message = await api(`/api/messages/${id}`);
  document.querySelectorAll('.message-row').forEach((row) => row.classList.toggle('selected', Number(row.dataset.id) === id));
  const detail = document.querySelector('#message-detail');
  const categories = [...new Set([...loadedMessages.map((item) => item.category).filter(Boolean), ...quickFolders.categories.map((folder) => folder.name)])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const messageIndex = messages.findIndex((item) => item.id === id);
  detail.classList.remove('empty-state');
  detail.innerHTML = `
    <div class="detail-navigation"><button class="ghost mobile-back" type="button" data-action="back">‹ 返回信件列表</button><div class="detail-picker message-jump"><button class="detail-picker-trigger" type="button" aria-expanded="false" aria-haspopup="menu"><span class="detail-picker-label">${escapeHtml(message.subject)}</span><span aria-hidden="true">⌄</span></button><div class="detail-picker-menu" role="menu" hidden>${messages.map((item) => `<button type="button" role="menuitem" data-message-id="${item.id}" ${item.id === id ? 'aria-current="true"' : ''}>${escapeHtml(item.subject)}</button>`).join('')}</div></div></div>
    <div class="message-recipient"><span>收件信箱</span><b>${escapeHtml(message.account_email)}</b></div>
    <h2>${escapeHtml(message.subject)}</h2>
    <div class="message-meta"><div class="message-meta-line"><span class="sender-identity"><b>${escapeHtml(message.sender_name || message.sender_email)}</b>${message.sender_name && message.sender_name !== message.sender_email ? `<span>${escapeHtml(message.sender_email)}</span>` : ''}</span><small>${formatDate(message.received_at)}</small></div></div>
    <div class="message-actions">
      <button class="ghost compact-action" data-action="star" aria-label="${message.is_starred ? '取消星號' : '加上星號'}" title="${message.is_starred ? '取消星號' : '加上星號'}">${message.is_starred ? '★' : '☆'}</button>
      <button class="ghost compact-action" data-action="read"><span>${message.is_read ? '標記未讀' : '標記已讀'}</span></button>
      <div class="detail-picker category-picker"><button class="detail-picker-trigger" type="button" aria-expanded="false" aria-haspopup="menu"><span class="detail-picker-label">${escapeHtml(message.category || '選擇分類')}</span><span aria-hidden="true">⌄</span></button><div class="detail-picker-menu" role="menu" hidden><button type="button" role="menuitem" data-category="__new__">＋ 新增分類</button>${categories.map((category) => `<button type="button" role="menuitem" data-category="${escapeHtml(category)}" ${category === message.category ? 'aria-current="true"' : ''}>${escapeHtml(category)}</button>`).join('')}<button type="button" role="menuitem" data-category="未分類">未分類</button></div></div>
      <button class="ghost compact-action" data-action="reply"><span>回覆</span></button>
      <button class="ghost compact-action" data-action="forward"><span>轉寄</span></button>
      <button class="ghost compact-action" data-action="spam"><span>標為垃圾信</span></button>
      <button class="danger compact-action trash-action" data-action="trash" aria-label="移至垃圾桶" title="移至垃圾桶"><svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>
    </div>
    <div class="message-content-scroll"><div class="mail-body"></div><div class="inline-reply" hidden></div></div>`;
  const layout = detail.closest('.mail-layout');
  layout.dataset.listScrollY = String(document.querySelector('#message-list-scroll')?.scrollTop || 0);
  layout.classList.add('mobile-detail-open');
  document.body.classList.add('message-open');
  document.querySelector('.mail-toolbar').hidden = true;
  setComposeVisibility(true);
  detail.scrollTop = 0;
  detail.querySelector('[data-action="back"]').addEventListener('click', () => {
    if (activeDetailOutsideHandler) document.removeEventListener('click', activeDetailOutsideHandler);
    activeDetailOutsideHandler = null;
    layout.classList.remove('mobile-detail-open');
    document.body.classList.remove('message-open');
    document.querySelector('.mail-toolbar').hidden = false;
    detail.classList.add('empty-state');
    detail.innerHTML = '<div><b>選擇一封郵件</b><p>郵件內容會顯示在這裡。</p></div>';
    const list = document.querySelector('#message-list-scroll');
    if (list) list.scrollTop = Number(layout.dataset.listScrollY || 0);
  });
  const closeDetailPickers = (except = null) => detail.querySelectorAll('.detail-picker').forEach((picker) => {
    if (picker === except) return;
    const menu = picker.querySelector('.detail-picker-menu');
    menu.hidden = true;
    menu.classList.remove('floating-detail-menu');
    menu.style.removeProperty('--picker-top');
    menu.style.removeProperty('--picker-left');
    picker.querySelector('.detail-picker-trigger').setAttribute('aria-expanded', 'false');
  });
  detail.querySelectorAll('.detail-picker-trigger').forEach((trigger) => trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const picker = trigger.closest('.detail-picker');
    const menu = picker.querySelector('.detail-picker-menu');
    const opening = menu.hidden;
    closeDetailPickers(picker);
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening && picker.classList.contains('category-picker')) {
      const rect = trigger.getBoundingClientRect();
      const menuWidth = Math.min(innerWidth * .5, 320);
      menu.classList.add('floating-detail-menu');
      menu.style.setProperty('--picker-top', `${Math.min(rect.bottom + 6, innerHeight * .65)}px`);
      menu.style.setProperty('--picker-left', `${Math.min(Math.max(8, rect.left), innerWidth - menuWidth - 8)}px`);
    }
  }));
  const outsidePickerHandler = (event) => { if (!detail.contains(event.target) || !event.target.closest('.detail-picker')) closeDetailPickers(); };
  activeDetailOutsideHandler = outsidePickerHandler;
  document.addEventListener('click', outsidePickerHandler);
  detail.querySelectorAll('.message-jump [data-message-id]').forEach((button) => button.addEventListener('click', () => {
    document.removeEventListener('click', outsidePickerHandler);
    activeDetailOutsideHandler = null;
    openMessage(Number(button.dataset.messageId));
  }));
  detail.querySelectorAll('.category-picker [data-category]').forEach((button) => button.addEventListener('click', async () => {
    let category = button.dataset.category;
    if (category === '__new__') {
      category = prompt('輸入新分類名稱', '')?.trim();
      if (!category) { closeDetailPickers(); return; }
      if (!quickFolders.categories.some((folder) => folder.name === category)) {
        quickFolders.categories.push({ id: `category-${Date.now()}`, name: category });
        saveQuickFolders();
      }
    }
    try {
      await api(`/api/messages/${id}/category`, { method: 'PATCH', body: JSON.stringify({ category }) });
      const local = demoMessages.find((item) => item.id === id); if (local) local.category = category;
      const loaded = loadedMessages.find((item) => item.id === id); if (loaded) loaded.category = category;
      showNotice(`已分類為「${category}」`);
      document.removeEventListener('click', outsidePickerHandler);
      activeDetailOutsideHandler = null;
      await openMessage(id);
    } catch (error) { showNotice(error.message, true); }
  }));
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
  detail.querySelector('[data-action="star"]').addEventListener('click', async () => { await toggleMessageStar(id); await openMessage(id); });
  detail.querySelector('[data-action="spam"]').addEventListener('click', async () => {
    try { await api(`/api/messages/${id}/move`, { method: 'PATCH', body: JSON.stringify({ folder: 'SPAM' }) }); showNotice('已標為垃圾信'); await renderRoute(); }
    catch (error) { showNotice(error.message, true); }
  });
  detail.querySelector('[data-action="trash"]').addEventListener('click', async (event) => {
    if (!confirm('確定將這封郵件移至遠端信箱的垃圾桶？')) return;
    setBusy(event.currentTarget, true);
    try { await api(`/api/messages/${id}`, { method: 'DELETE' }); showNotice('郵件已移至垃圾桶'); await renderRoute(); }
    catch (error) { showNotice(error.message, true); setBusy(event.currentTarget, false); }
  });
  const openInlineComposer = (mode) => {
    const reply = detail.querySelector('.inline-reply');
    body.hidden = true;
    reply.hidden = false;
    const isReply = mode === 'reply';
    reply.innerHTML = `<form class="inline-compose-form"><h3>${isReply ? '回覆' : '轉寄'}</h3><label>收件者<input name="to" type="email" value="${isReply ? escapeHtml(message.sender_email) : ''}" required></label><label>主旨<input name="subject" value="${escapeHtml(isReply ? (message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`) : (message.subject.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`))}" required></label><label>內容<textarea name="text" rows="8" required></textarea></label><div class="form-actions"><button class="ghost" type="button" data-inline-cancel>取消</button><button class="primary" type="submit">寄出</button></div></form>`;
    reply.querySelector('[data-inline-cancel]').addEventListener('click', () => { reply.hidden = true; reply.innerHTML = ''; body.hidden = false; });
    reply.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); setBusy(button, true, '寄送中…');
      const data = Object.fromEntries(new FormData(event.currentTarget)); data.accountId = message.account_id; data.cc = []; if (isReply) data.inReplyTo = message.thread_id;
      try { await api('/api/send', { method: 'POST', body: JSON.stringify(data) }); showNotice('郵件已寄出'); reply.hidden = true; reply.innerHTML = ''; body.hidden = false; }
      catch (error) { showNotice(error.message, true); setBusy(button, false); }
    });
    requestAnimationFrame(() => reply.querySelector('textarea').focus());
  };
  detail.querySelector('[data-action="reply"]').addEventListener('click', () => openInlineComposer('reply'));
  detail.querySelector('[data-action="forward"]').addEventListener('click', () => openInlineComposer('forward'));
  let detailTouchStart = null;
  detail.addEventListener('touchstart', (event) => { if (!event.target.closest('input,textarea,select,button')) detailTouchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }, { passive: true });
  detail.addEventListener('touchend', (event) => {
    if (!detailTouchStart) return;
    const dx = event.changedTouches[0].clientX - detailTouchStart.x; const dy = event.changedTouches[0].clientY - detailTouchStart.y; detailTouchStart = null;
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    if (!messages.length || messageIndex < 0) return;
    const targetIndex = dx < 0
      ? (messageIndex - 1 + messages.length) % messages.length
      : (messageIndex + 1) % messages.length;
    openMessage(messages[targetIndex].id);
  }, { passive: true });
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
  setComposeVisibility(false);
  await loadAccounts();
  target.innerHTML = `<div class="inline-settings">
    ${embedded ? '<div class="inline-panel-head"><div><h2>信箱帳號設定</h2><p>管理現有帳號或新增 Gmail、Yahoo 與一般信箱。</p></div><button class="ghost inline-panel-close" type="button">完成</button></div>' : ''}
    ${quickFolderSection('accounts')}
    <div class="account-grid">${accounts.length ? accounts.map((account) => `
      <div class="account-card card"><div class="account-icon">${account.provider === 'gmail' ? 'G' : 'IM'}</div><div class="account-info"><b>${escapeHtml(account.email)}</b><small>${account.provider === 'gmail' ? 'Google OAuth' : 'IMAP / SMTP'} · ${account.last_synced_at ? `上次同步 ${formatDate(account.last_synced_at)}` : '尚未同步'}</small></div><button class="ghost sync-one" data-id="${account.id}">同步</button><button class="danger delete-account" data-id="${account.id}">移除</button></div>`).join('') : '<div class="card loading">尚未加入任何信箱。</div>'}</div>
    <h2 class="section-title" style="margin-top:32px">新增信箱</h2>
    <div class="split">
      <form id="gmail-form" class="form-card card provider-connect-card"><h3>Gmail</h3><p>透過 Google 官方 OAuth 頁面授權，不會儲存 Gmail 密碼。</p><button id="google-oauth-console" class="ghost provider-external" type="button">開啟 Google OAuth 設定 ↗</button><label>Google Client ID<input name="clientId" required autocomplete="off"></label><label>Google Client Secret<input name="clientSecret" type="password" required autocomplete="off"></label><p class="quick-folder-note">Callback：<span class="code">${escapeHtml(location.origin)}/api/oauth/google/callback</span></p><div class="form-actions"><button class="primary provider-connect" type="submit">連結 Gmail ↗</button></div></form>
      <form id="imap-form" class="form-card card provider-connect-card"><h3>Yahoo</h3><p>先到 Yahoo 官方帳號安全頁建立應用程式密碼，再回來完成連線。</p><button id="yahoo-authorize" class="ghost provider-external" type="button">開啟 Yahoo 授權頁 ↗</button><label>Yahoo Email<input name="email" type="email" required></label><label>應用程式密碼<input name="password" type="password" required autocomplete="off"></label><input name="imapHost" type="hidden" value="imap.mail.yahoo.com"><input name="smtpHost" type="hidden" value="smtp.mail.yahoo.com"><input name="imapPort" type="hidden" value="993"><input name="smtpPort" type="hidden" value="465"><div class="form-actions"><button class="primary provider-connect" type="submit">連結 Yahoo</button></div></form>
    </div></div>`;
  target.querySelector('.inline-panel-close')?.addEventListener('click', () => renderRoute());
  bindQuickFolderDeletes(target, () => mountAccounts(target, embedded));
  target.querySelector('#gmail-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); setBusy(button, true);
    try { const data = Object.fromEntries(new FormData(event.currentTarget)); const result = await api('/api/accounts/gmail/auth-url', { method: 'POST', body: JSON.stringify(data) }); window.open(result.url, '_blank', 'noopener'); showNotice('請在新視窗完成 Google 授權'); }
    catch (error) { showNotice(error.message, true); }
    finally { setBusy(button, false); }
  });
  target.querySelector('#google-oauth-console').addEventListener('click', () => { window.open('https://console.cloud.google.com/apis/credentials', '_blank', 'noopener'); showNotice('請在 Google Cloud 建立 OAuth 用戶端並登記畫面上的 Callback'); });
  target.querySelector('#yahoo-authorize').addEventListener('click', () => { window.open('https://login.yahoo.com/account/security', '_blank', 'noopener'); showNotice('請在 Yahoo 官方頁面建立應用程式密碼，再回到此頁完成連線'); });
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
  target.innerHTML = `<div class="inline-settings">${embedded ? '<div class="inline-panel-head"><div><h2>自動分類設定</h2><p>依寄件者或主旨新增分類條件。</p></div><button class="ghost inline-panel-close" type="button">完成</button></div>' : ''}${quickFolderSection('categories')}<form id="rule-form" class="form-card card narrow"><div class="split"><label>規則名稱<input name="name" placeholder="例如：購物通知" required></label><label>分類名稱<input name="category" list="category-folder-options" placeholder="例如：購物" required><datalist id="category-folder-options">${quickFolders.categories.map((folder) => `<option value="${escapeHtml(folder.name)}"></option>`).join('')}</datalist></label></div><div class="split"><label>比對範圍<select name="field"><option value="sender">寄件者</option><option value="subject">主旨</option><option value="both">寄件者與主旨</option></select></label><label>比對方式<select name="operator"><option value="contains">包含</option><option value="equals">完全相同</option><option value="regex">正規表示式</option></select></label></div><label>比對文字<input name="value" placeholder="shopee 或 @company.com" required></label><div class="form-actions"><button class="primary">新增規則</button></div></form><h2 class="section-title" style="margin-top:32px">現有規則</h2><div class="rule-list">${rules.length ? rules.map((rule) => `<div class="rule-card card"><div><b>${escapeHtml(rule.name)}</b><div>${escapeHtml(rule.field)} ${escapeHtml(rule.operator)}「${escapeHtml(rule.value)}」→ ${escapeHtml(rule.category)}</div></div><button class="danger" data-id="${rule.id}">刪除</button></div>`).join('') : '<div class="card loading">還沒有分類規則。新規則會在下次同步時套用。</div>'}</div></div>`;
  target.querySelector('.inline-panel-close')?.addEventListener('click', () => renderRoute());
  bindQuickFolderDeletes(target, () => mountRules(target, embedded));
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
    <section class="card"><h2>開始使用</h2><ol><li>到「信箱帳號」加入 Gmail 或 Yahoo/IMAP 帳號。</li><li>按「同步全部」下載最近 1,000 封收件匣郵件的本機索引。</li><li>建立分類規則，下一次同步時自動分類。</li><li>刪除、已讀狀態與寄信會直接操作所選的遠端信箱。</li></ol><p>程式只監聽 <span class="code">127.0.0.1</span>。資料庫及加密金鑰位於專案的 <span class="code">data/</span> 目錄，已被 Git 忽略。</p></section>
    <section class="card"><h2>帳號安全</h2><p>Gmail 採用 OAuth 2.0，程式不會取得 Gmail 密碼。Yahoo 或一般 IMAP 帳號應使用服務商提供的應用程式密碼。請勿將 <span class="code">data/</span>、OAuth Client Secret 或應用程式密碼提交到 Git。</p><p>郵件中的 HTML 會在禁止腳本的隔離框架內顯示。開啟外部連結或下載附件前，仍應確認寄件者及網址。</p></section>
    <section class="card disclaimer"><h2>免責聲明</h2><p>MailBox Manager 是個人郵件管理工具，以「現狀」提供。使用者須自行確認 Google、Yahoo 及其他郵件服務商的服務條款、API 政策與帳號安全要求。</p><p>同步、標記已讀、寄送及刪除等操作可能直接變更遠端信箱。使用前請備份重要郵件並先以測試帳號驗證設定。開發者不保證郵件資料、同步結果、通知時效或第三方服務持續可用，亦不對誤刪、未送達、資料遺失、帳號限制、憑證外洩或任何直接與間接損失負責。</p><p>本工具不提供法律、財務或資安保證。若用於工作、受管制資料或多人環境，應先由組織管理者與專業人員完成權限、保存、隱私及合規審查。</p></section>
    <section class="card"><h2>目前範圍</h2><p>第一版支援 Gmail、Yahoo 與標準 IMAP/SMTP。LINE Bot、背景排程、附件管理及 Microsoft Graph 預留為後續功能。</p></section>
  </div>`;
}

async function renderRoute() {
  if (location.hash !== '#inbox') history.replaceState(null, '', '#inbox');
  view.innerHTML = '';
  document.body.classList.remove('settings-open', 'message-open');
  syncButton.hidden = false;
  setComposeVisibility(true);
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
quickFolderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = quickFolderForm.folderName.value.trim();
  if (!name) return;
  if (quickFolders[quickFolderType].some((folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showNotice('已有相同名稱的資料夾', true);
    return;
  }
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  quickFolders[quickFolderType].push({ id, name });
  saveQuickFolders();
  quickFolderDialog.close();
  showNotice(`已新增「${name}」`);
  await renderRoute();
});
document.querySelector('#quick-folder-cancel').addEventListener('click', () => { quickFolderDialog.close(); setComposeVisibility(!document.body.classList.contains('settings-open')); });
document.querySelector('#quick-folder-close').addEventListener('click', () => { quickFolderDialog.close(); setComposeVisibility(!document.body.classList.contains('settings-open')); });
cleanupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(cleanupForm));
  let targets = [];
  if (cleanupMode === 'date') {
    const cutoff = new Date(`${data.beforeDate}T00:00:00`).getTime();
    targets = messages.filter((message) => new Date(message.received_at).getTime() < cutoff);
  } else {
    const sender = String(data.sender || '').trim().toLocaleLowerCase();
    const keyword = String(data.keyword || '').trim().toLocaleLowerCase();
    if (!sender && !keyword) { showNotice('請輸入寄件者或信件關鍵字', true); return; }
    targets = messages.filter((message) => {
      const senderText = `${message.sender_name || ''} ${message.sender_email || ''}`.toLocaleLowerCase();
      const contentText = `${message.subject || ''} ${message.snippet || ''}`.toLocaleLowerCase();
      return (!sender || senderText.includes(sender)) && (!keyword || contentText.includes(keyword));
    });
  }
  if (!targets.length) { showNotice('目前清單中沒有符合條件的信件', true); return; }
  cleanupDialog.close();
  await moveMessages(targets, 'TRASH');
});
document.querySelector('#cleanup-cancel').addEventListener('click', () => cleanupDialog.close());
document.querySelector('#cleanup-close').addEventListener('click', () => cleanupDialog.close());
messageFilterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(messageFilterForm));
  if (data.fromDate && data.toDate && data.fromDate > data.toDate) { showNotice('開始日期不可晚於結束日期', true); return; }
  Object.assign(messageViewFilter, {
    fromDate: String(data.fromDate || ''),
    toDate: String(data.toDate || ''),
    sender: String(data.sender || '').trim(),
    subject: String(data.subject || '').trim(),
  });
  messages = applyMessageViewFilter(loadedMessages);
  messagePage = 1;
  selectedMessageIds.clear();
  messageFilterDialog.close();
  renderMessageList();
  showNotice(`已顯示 ${messages.length} 封符合條件的信件`);
});
document.querySelector('#message-filter-clear').addEventListener('click', () => {
  Object.assign(messageViewFilter, { fromDate: '', toDate: '', sender: '', subject: '' });
  messages = [...loadedMessages];
  messagePage = 1;
  selectedMessageIds.clear();
  messageFilterDialog.close();
  renderMessageList();
  showNotice('已清除信件篩選');
});
document.querySelector('#message-filter-cancel').addEventListener('click', () => messageFilterDialog.close());
document.querySelector('#message-filter-close').addEventListener('click', () => messageFilterDialog.close());
const closeHelp = () => { helpDialog.close(); setComposeVisibility(!document.body.classList.contains('settings-open')); };
helpButton.addEventListener('click', () => { setComposeVisibility(false); helpDialog.showModal(); });
document.querySelector('#help-close').addEventListener('click', closeHelp);
document.querySelector('#help-done').addEventListener('click', closeHelp);
[composeDialog, helpDialog, quickFolderDialog, cleanupDialog, messageFilterDialog].forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
helpDialog.addEventListener('close', () => setComposeVisibility(!document.body.classList.contains('settings-open')));
quickFolderDialog.addEventListener('close', () => setComposeVisibility(!document.body.classList.contains('settings-open')));
filterDrawerToggle.addEventListener('click', () => setFilterDrawer(!document.body.classList.contains('filters-open')));
filterDrawerBackdrop.addEventListener('click', () => setFilterDrawer(false));
document.addEventListener('pointerdown', (event) => {
  if (!document.body.classList.contains('filters-open')) return;
  const drawer = document.querySelector('#inbox-filters');
  if (drawer?.contains(event.target) || filterDrawerToggle.contains(event.target)) return;
  setFilterDrawer(false);
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('filters-open')) setFilterDrawer(false); });
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
