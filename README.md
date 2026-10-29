# MailBox Manager

本機優先的個人多信箱管理器。目前支援 Gmail OAuth、Yahoo 與標準 IMAP/SMTP，並以 SQLite 建立統一收件匣。

## 已完成功能

- 多個 Gmail、Yahoo 或 IMAP 帳號
- Gmail OAuth 2.0，不儲存 Google 密碼
- IMAP 收信、SMTP 寄信，支援 Yahoo App Password
- SQLite 統一收件匣、跨帳號搜尋與未讀篩選
- 已讀/未讀同步、移至遠端垃圾桶
- 選擇寄件帳號、回覆與轉寄
- 依寄件者或主旨建立分類規則
- 本機 AES-256-GCM 加密帳號憑證
- 說明頁、帳號安全指南與免責聲明

## 執行需求

- Node.js 22.5 以上（使用內建 `node:sqlite`）

```bash
npm install
npm start
```

開啟 <http://127.0.0.1:4141>。服務預設只監聽本機位址。

## Gmail 設定

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立專案並啟用 Gmail API。
2. 設定 OAuth consent screen。若應用程式仍在測試，將自己的 Google 帳號加入 Test users。
3. 建立 OAuth 2.0 Client ID（Web application）。
4. 將正式網站的 `/api/oauth/google/callback` 加入 Authorized redirect URIs；本機開發才使用 `http://127.0.0.1:4141/api/oauth/google/callback`。
5. 管理者透過安全後端設定提供 `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET` 與 `MAILBOX_PUBLIC_ORIGIN`。使用者只需在「信箱帳號」按「使用 Google 登入」，不在網頁填入應用程式憑證。

OAuth client 設定、Token 交換與加密保存都在後端執行，state 綁定瀏覽器 Cookie、有效期十分鐘，搭配 PKCE 並只使用一次。正式 callback 必須由動態後端處理；靜態 Sites 不會執行 `src/server.js`。目前正式啟用條件與限制見 `OAUTH-SETUP.txt`，尚未完成 Google 真實登入驗證。

Gmail 的 `gmail.modify` 屬敏感或受限制權限。若只供自己使用，可以維持測試模式；若公開給其他人使用，須依 Google 當時的驗證要求處理。

## Yahoo 設定

使用者只需在「信箱帳號」的 Yahoo 標題旁按「連結」，介面不收集 Yahoo Email 或應用程式密碼。目前按鈕開啟 Yahoo 官方登入頁；若要在登入後自動返回並同步信件，仍須註冊 Yahoo OAuth 用戶端，並由安全後端完成 callback、Token 交換與保存。不得把 Yahoo Client Secret 放入前端或 APK。

## 資料與安全

本機資料位於 `data/`：

- `mailbox.db`：郵件索引、分類與規則
- `.vault-key`：加密帳號 Token 或 App Password 的本機金鑰

整個目錄已由 `.gitignore` 排除。備份時須同時保護這兩個檔案；遺失 `.vault-key` 後，原有憑證無法解密。

郵件 HTML 在不允許腳本的 sandbox iframe 顯示。程式仍在早期版本，建議先以測試帳號驗證。

## 免責聲明

本軟體依 MIT License 以「現狀」提供。同步、標記已讀、寄送與刪除可能直接變更遠端信箱。使用者應先備份重要郵件，並自行遵守郵件服務商條款、隱私政策與組織規範。開發者不對誤刪、郵件未送達、資料遺失、帳號限制、憑證外洩或其他直接及間接損失負責。完整內容可在程式內的「說明與免責聲明」頁查看。

## 後續規劃

- Microsoft Graph（Outlook / Hotmail）
- 附件預覽與下載
- 背景定時同步與 Windows 通知
- LINE Official Account 重要郵件通知與指令
- 增量同步與分頁，取代目前每帳號最近 200 封郵件的同步方式
