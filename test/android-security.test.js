/*
 * Guards the Android release security contract without requiring an emulator.
 * Run through `npm test`; it checks manifest, FileProvider, updater cache, signing,
 * and version settings that must remain aligned for safe in-place updates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('release APK is non-debuggable, same-signer compatible, and versioned', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /versionCode\s+32\b/);
  assert.match(gradle, /versionName\s+"0\.1\.32"/);
  assert.match(gradle, /release\s*\{[\s\S]*?debuggable\s+false/);
  assert.match(gradle, /release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug/);
});

test('backup and cleartext are disabled while verified updates remain explicit', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const extractionRules = read('android/app/src/main/res/xml/data_extraction_rules.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(manifest, /androidx\.work\.impl\.foreground\.SystemForegroundService[\s\S]*?android:foregroundServiceType="dataSync"/);
  assert.match(extractionRules, /<cloud-backup>[\s\S]*?<exclude domain="database" path="\." \/>/);
  assert.match(extractionRules, /<device-transfer>[\s\S]*?<exclude domain="sharedpref" path="\." \/>/);
});

test('updates use persistent background work, resumable partials and post-install cleanup', () => {
  const gradle = read('android/app/build.gradle');
  const manager = read('android/app/src/main/java/com/faidlix/mailboxmanager/AppUpdateManager.java');
  const worker = read('android/app/src/main/java/com/faidlix/mailboxmanager/AppUpdateWorker.java');
  const resumable = read('android/app/src/main/java/com/faidlix/mailboxmanager/ResumableUpdateDownloader.java');
  assert.match(gradle, /androidx\.work:work-runtime/);
  assert.match(manager, /enqueueUniqueWork\(UPDATE_WORK_NAME, ExistingWorkPolicy\.KEEP/);
  assert.match(manager, /moveTaskToBack\(true\)/);
  assert.match(worker, /Result\.retry\(\)/);
  assert.match(worker, /getFilesDir\(\),\s*"verified-updates"/);
  assert.match(worker, /BinaryDelta\.apply/);
  assert.match(worker, /showReadyToInstall/);
  assert.match(resumable, /setRequestProperty\("Range", "bytes=" \+ existing \+ "-"\)/);
  assert.match(manager, /BuildConfig\.VERSION_CODE < pendingVersion/);
  assert.match(manager, /showPendingInstallIfReady\(\)/);
  assert.match(manager, /setTitle\("更新已下載完成"\)/);
  assert.match(manager, /installerIntent\(activity, verified\)/);
});

test('updater reads package signatures on both modern and Android 24-27 devices', () => {
  const updater = read('android/app/src/main/java/com/faidlix/mailboxmanager/AppUpdateManager.java');
  assert.match(updater, /SDK_INT >= Build\.VERSION_CODES\.P[\s\S]*?GET_SIGNING_CERTIFICATES[\s\S]*?GET_SIGNATURES/);
  assert.match(updater, /SDK_INT >= Build\.VERSION_CODES\.P[\s\S]*?info\.signingInfo[\s\S]*?info\.signatures/);
});

test('Capacitor boots bundled assets without a private Site login and keeps debugging disabled', () => {
  const config = read('capacitor.config.ts');
  assert.match(config, /webDir:\s*'public'/);
  assert.match(config, /hostname:\s*'localhost'/);
  assert.match(config, /androidScheme:\s*'https'/);
  assert.doesNotMatch(config, /\burl\s*:/);
  assert.doesNotMatch(config, /\ballowNavigation\s*:/);
  assert.match(config, /allowMixedContent:\s*false/);
  assert.match(config, /webContentsDebuggingEnabled:\s*false/);
});

test('FileProvider exposes only the verified updater and mail-share cache directories', () => {
  const paths = read('android/app/src/main/res/xml/file_paths.xml');
  const updater = read('android/app/src/main/java/com/faidlix/mailboxmanager/AppUpdateManager.java');
  const worker = read('android/app/src/main/java/com/faidlix/mailboxmanager/AppUpdateWorker.java');
  const activity = read('android/app/src/main/java/com/faidlix/mailboxmanager/MainActivity.java');
  assert.doesNotMatch(paths, /<external-path\b/);
  assert.doesNotMatch(paths, /path="\."/);
  assert.match(paths, /<cache-path\s+name="verified_updates"\s+path="verified-updates\/"\s*\/>/);
  assert.match(paths, /<files-path\s+name="persistent_verified_updates"\s+path="verified-updates\/"\s*\/>/);
  assert.match(paths, /<cache-path\s+name="shared_exports"\s+path="shared-exports\/"\s*\/>/);
  assert.match(worker, /getFilesDir\(\),\s*"verified-updates"/);
  assert.match(activity, /getCacheDir\(\),\s*"shared-exports"/);
  assert.match(activity, /Intent\.ACTION_SEND_MULTIPLE/);
  assert.match(activity, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(activity, /MailBoxAndroid\.shareFiles/);
});
