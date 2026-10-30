# Android APK

MailBox Manager 的 Android 版是 Capacitor WebView 容器。首次啟動載入 APK 內的 `public/` 完整介面；Google 登入完成後切換到雲端信箱並保留該模式。網站與 API 仍由雲端任務維護，Android 專案位於 `android/`。

## 建置

需求：Node.js 22、JDK 21、Android SDK 36。

```powershell
npm install
npm run android:release:signed
```

簽章 release APK 產生於：

```text
android/app/build/outputs/apk/release/app-release.apk
```

安裝到已開啟 USB 偵錯的手機：

```powershell
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

目前 release 為不可偵錯版本，但為了能在不解除安裝、不清除資料的前提下覆蓋既有測試版，仍沿用原 Android Debug 憑證。這不代表已改用正式商店簽章；若未來換成 production key，必須另行規劃資料與升級路徑。

## Android 行為

- 返回鍵依序關閉對話框、篩選抽屜、信件操作選單、信件詳情，最後才離開 App。
- `.eml` 會儲存到系統下載資料夾；Android 10 以上不要求儲存權限。
- Android 9 以下會在第一次下載時要求寫入下載資料夾權限。
- Blob 下載橋接只在 APK 內建的 `https://localhost` 或指定 MailBox 雲端主機啟用，檔名強制為 `.eml`，單檔上限 50 MB。
- JavaScript 下載橋接只在精確 HTTPS 主機頁面載入完成後啟用，且每次 App 執行使用不可預測 token 驗證呼叫；頁面開始切換時立即停用。
- WebView 停用偵錯、HTTP 明文與 mixed content；App 備份及 Android 12+ 裝置轉移均明確停用。
- FileProvider 僅分享 App 私有的 `verified-updates/` 與 cache 內的 `shared-exports/`，不暴露外部儲存空間或整個資料目錄。
- App 啟動或回到前景時，最多每 6 小時檢查一次固定的公開更新清單；不建立定期背景輪詢。使用者按下下載後才建立單次 WorkManager 背景工作並將 App 縮到背景。
- 背景更新會保留 `.part` 暫存並用 HTTP Range 接續下載；網路失敗採退避重試，不會每次從零下載。驗證完成的 APK 保留到新版首次啟動確認安裝成功後才移除。
- 新版優先使用精確綁定來源版本與舊 APK SHA-256 的 `.mbd` 差分；重建後仍須通過完整 APK 大小、SHA-256、套件名稱與簽章驗證。沒有可用差分時才下載完整 APK。
- 更新只接受 `faidlix.github.io/Web/mailbox-manager/downloads/` 下的 HTTPS APK，並驗證 metadata 欄位、版本碼、大小、SHA-256、套件名稱及既有簽章。
- 驗證通過後只會開啟 Android 系統安裝器，仍需使用者確認，且不會自動修改「允許此來源」設定。
- Google OAuth 由系統外部瀏覽器開啟，正式 App Link 為 `https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/app/oauth/callback`，並保留 `mailboxmanager://oauth/callback` 作為備援。
- App 只接受精確的回呼來源及 20 到 2048 字元的一次性代碼，再以 POST 送到 `/api/oauth/google/native/complete`；OAuth refresh token 與 client secret 不得放入 APK 或回呼網址。
- 雲端需讓一次性代碼具備短效期、單次使用並綁定原本的 PKCE/state，交換完成後設定 Secure、HttpOnly 工作階段 cookie，再導向 `/#inbox`。
- 雲端需提供 `/.well-known/assetlinks.json`，套件名稱為 `com.faidlix.mailboxmanager`，簽章 SHA-256 為 `5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12`。

## 更新發佈

更新清單固定為：

```text
https://faidlix.github.io/Web/mailbox-manager/downloads/release.json
```

差分清單固定為 `release-deltas.json`，保持 `release.json` 原格式，讓不支援差分的舊版仍可正常更新。建立差分檔：

```powershell
npm run android:delta -- old.apk new.apk mailbox-manager-old-to-new.mbd
```

目前開發版本為 `0.1.32`（versionCode 32），正式 APK 沿用既有測試簽章。完成建置後預定輸出：

```text
B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.32-oauth-release.apk
SHA-256: 2b7e8f0f109c9fb2b56420ee849fb80d14b4bca63054f51eeda0ee4b8e437dde
Signer SHA-256: 5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12
```

App 直接載入 APK 內的完整介面，冷啟動不需要私人 Sites 或 ChatGPT 登入；只有連結真實 Gmail／Yahoo 信箱時才需要各服務的授權流程。既有遠端 WebView 資料屬於不同 origin，尚未在實機驗證資料移轉。第一次從舊版升級時，可用相同簽章覆蓋安裝：

```powershell
adb install -r B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.32-oauth-release.apk
```

不得先解除安裝或清除資料。0.1.31 曾在 Android 34 模擬器驗證覆蓋安裝、離線載入、系統分享面板、返回及 `.eml` 儲存至 Downloads；0.1.32 仍需重新執行模擬器與手機驗收。沒有連線的 Android 實機時，不得宣稱已完成手機資料保留、分享、下載、Google OAuth 或 Play Protect 驗證。
