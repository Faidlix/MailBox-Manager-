# Android APK

MailBox Manager 的 Android 版是 Capacitor WebView 容器，固定載入 `capacitor.config.ts` 中的測試站網址。網站與 API 仍由雲端任務維護，Android 專案位於 `android/`。

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
- Blob 下載橋接只在 `mailbox-manager-test.fantasy02dreamer08.chatgpt.site` 啟用，檔名強制為 `.eml`，單檔上限 50 MB。
- JavaScript 下載橋接只在精確 HTTPS 主機頁面載入完成後啟用，且每次 App 執行使用不可預測 token 驗證呼叫；頁面開始切換時立即停用。
- WebView 停用偵錯、HTTP 明文與 mixed content；App 備份及 Android 12+ 裝置轉移均明確停用。
- FileProvider 只分享 App 私有 cache 內的 `verified-updates/`，不再暴露外部儲存空間或整個 cache。
- App 啟動或回到前景時，最多每 6 小時檢查一次固定的公開更新清單；失敗後至少等待 30 分鐘，不建立背景服務或排程。
- 更新只接受 `faidlix.github.io/Web/mailbox-manager/downloads/` 下的 HTTPS APK，並驗證 metadata 欄位、版本碼、大小、SHA-256、套件名稱及既有簽章。
- 驗證通過後只會開啟 Android 系統安裝器，仍需使用者確認，且不會自動修改「允許此來源」設定。
- Google OAuth 必須由網站/API 改成外部瀏覽器加 App Link 或自訂 Scheme callback；目前的 localhost callback 無法在 APK 正式使用。

## 更新發佈

更新清單固定為：

```text
https://faidlix.github.io/Web/mailbox-manager/downloads/release.json
```

目前版本為 `0.1.29`（versionCode 29）：

```text
B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.29-site27-release.apk
SHA-256: 211bbe1e24d4b7ace96dc88ecbf9b4c883322e0dc1ba8fe73c330c25825d73b3
Signer SHA-256: 5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12
```

App 固定載入私有 Site 版本 27，來源 commit `e8144f63e17ab05036aaa74a189eb879b145b083`；0.1.29 僅更新 Android 原生容器安全設定，沒有重新部署私有 Site。第一次從沒有原生更新器的舊版升級時，可用相同簽章覆蓋安裝：

```powershell
adb install -r B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.29-site27-release.apk
```

不得先解除安裝或清除資料。目前沒有連線的 Android 裝置，因此尚未完成實機覆蓋安裝、資料保留、返回鍵、`.eml` 下載及 Play Protect 驗證；不能宣稱 Google 警告成因已確認或警告已解除。Google OAuth 與 App 返回流程也仍需網站/API 正式啟用後才能驗收。
