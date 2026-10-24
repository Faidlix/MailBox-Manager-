# Android APK

MailBox Manager 的 Android 版是 Capacitor WebView 容器，固定載入 `capacitor.config.ts` 中的測試站網址。網站與 API 仍由雲端任務維護，Android 專案位於 `android/`。

## 建置

需求：Node.js 22、JDK 21、Android SDK 36。

```powershell
npm install
npm run android:debug
```

Debug APK 產生於：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

安裝到已開啟 USB 偵錯的手機：

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Android 行為

- 返回鍵依序關閉對話框、篩選抽屜、信件操作選單、信件詳情，最後才離開 App。
- `.eml` 會儲存到系統下載資料夾；Android 10 以上不要求儲存權限。
- Android 9 以下會在第一次下載時要求寫入下載資料夾權限。
- Blob 下載橋接只在 `mailbox-manager-test.fantasy02dreamer08.chatgpt.site` 啟用，檔名強制為 `.eml`，單檔上限 50 MB。
- App 啟動或回到前景時，最多每 6 小時檢查一次固定的公開更新清單；失敗後至少等待 30 分鐘，不建立背景服務或排程。
- 更新只接受 `faidlix.github.io/Web/mailbox-manager/downloads/` 下的 HTTPS APK，並驗證 metadata 欄位、版本碼、大小、SHA-256、套件名稱及既有簽章。
- 驗證通過後只會開啟 Android 系統安裝器，仍需使用者確認，且不會自動修改「允許此來源」設定。
- Google OAuth 必須由網站/API 改成外部瀏覽器加 App Link 或自訂 Scheme callback；目前的 localhost callback 無法在 APK 正式使用。

## 更新發佈

更新清單固定為：

```text
https://faidlix.github.io/Web/mailbox-manager/downloads/release.json
```

目前待發布候選為 `0.1.27`（versionCode 27）：

```text
B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.27-site26-debug.apk
SHA-256: 9221712bbbb3cf8bdf41b8809712a4d53f3b2e0f16857133c8b4a74a3ab5df16
Signer SHA-256: 5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12
```

公開 staging 位於 `B:\AI\MailBox\MailBox-Manager-APK\public-staging`，必須等共享 `Faidlix/Web` 工作區交接後才能發布。`0.1.19` 與 `0.1.26` 沒有原生更新器，第一次升級到 `0.1.27` 需要使用相同簽章的覆蓋安裝：

```powershell
adb install -r B:\AI\MailBox\MailBox-Manager-APK\mailbox-manager-0.1.27-site26-debug.apk
```

不得先解除安裝或清除資料。目前沒有連線的 Android 裝置，因此尚未完成實機覆蓋安裝、返回鍵、`.eml` 下載與資料保留驗證。
