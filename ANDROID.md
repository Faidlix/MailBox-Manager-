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
- Google OAuth 必須由網站/API 改成外部瀏覽器加 App Link 或自訂 Scheme callback；目前的 localhost callback 無法在 APK 正式使用。
