/*
 * Checks the fixed public MailBox release feed on launch/foreground with throttling.
 * Downloads one verified APK, validates package/version/signer, then opens Android's installer.
 * It never polls in the background, changes security settings, or performs silent installation.
 */
package com.faidlix.mailboxmanager;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

final class AppUpdateManager implements AutoCloseable {
    private static final String TAG = "MailBoxUpdate";
    private static final String PREFS = "mailbox-update";
    private static final String LAST_ATTEMPT = "last-attempt";
    private static final String LAST_SUCCESS = "last-success";
    private static final long SUCCESS_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final long FAILURE_INTERVAL_MS = 30L * 60L * 1000L;
    private static final int MAX_FEED_BYTES = 64 * 1024;
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final Set<String> RELEASE_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "schemaVersion", "versionName", "versionCode", "packageName",
        "downloadUrl", "sha256", "sizeBytes", "signingCertificateSha256"
    )));

    private final MainActivity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final UpdateContract.SingleFlightGate checkGate = new UpdateContract.SingleFlightGate();
    private final UpdateContract.SingleFlightGate downloadGate = new UpdateContract.SingleFlightGate();
    private final SharedPreferences preferences;

    AppUpdateManager(MainActivity activity) {
        this.activity = activity;
        this.preferences = activity.getSharedPreferences(PREFS, 0);
    }

    void checkIfDue() {
        long now = System.currentTimeMillis();
        long lastAttempt = preferences.getLong(LAST_ATTEMPT, 0);
        long lastSuccess = preferences.getLong(LAST_SUCCESS, 0);
        long interval = lastSuccess >= lastAttempt ? SUCCESS_INTERVAL_MS : FAILURE_INTERVAL_MS;
        if (now - lastAttempt < interval || !checkGate.begin()) return;
        preferences.edit().putLong(LAST_ATTEMPT, now).apply();
        executor.execute(() -> {
            try {
                UpdateContract.ReleaseMetadata release = fetchRelease();
                preferences.edit().putLong(LAST_SUCCESS, System.currentTimeMillis()).apply();
                activity.runOnUiThread(() -> showUpdatePrompt(release));
            } catch (NoUpdateAvailable ignored) {
                preferences.edit().putLong(LAST_SUCCESS, System.currentTimeMillis()).apply();
            } catch (Exception error) {
                Log.w(TAG, "Update check failed closed", error);
            } finally {
                checkGate.end();
            }
        });
    }

    private UpdateContract.ReleaseMetadata fetchRelease() throws IOException, JSONException, NoUpdateAvailable {
        HttpURLConnection connection = (HttpURLConnection) new URL(UpdateContract.FEED_URL).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("Feed HTTP 狀態：" + status);
            long length = connection.getContentLengthLong();
            if (length > MAX_FEED_BYTES) throw new IOException("Feed 過大");
            String body = readLimited(connection.getInputStream(), MAX_FEED_BYTES);
            UpdateContract.ReleaseMetadata release = parseRelease(body);
            if (release.versionCode() <= BuildConfig.VERSION_CODE) throw new NoUpdateAvailable();
            return UpdateContract.validate(release, BuildConfig.VERSION_CODE);
        } finally {
            connection.disconnect();
        }
    }

    static UpdateContract.ReleaseMetadata parseRelease(String body) throws JSONException {
        JSONObject json = new JSONObject(body);
        Set<String> keys = new HashSet<>();
        Iterator<String> iterator = json.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        if (!keys.equals(RELEASE_KEYS)) throw new JSONException("更新 metadata 欄位不符");
        Object schema = json.get("schemaVersion");
        Object versionCode = json.get("versionCode");
        Object sizeBytes = json.get("sizeBytes");
        if (!isJsonInteger(schema) || !isJsonInteger(versionCode) || !isJsonInteger(sizeBytes)) {
            throw new JSONException("更新 metadata 數值型別錯誤");
        }
        return new UpdateContract.ReleaseMetadata(
            ((Number) schema).intValue(), json.getString("versionName"), ((Number) versionCode).longValue(),
            json.getString("packageName"), json.getString("downloadUrl"), json.getString("sha256"),
            ((Number) sizeBytes).longValue(), json.getString("signingCertificateSha256")
        );
    }

    private static boolean isJsonInteger(Object value) {
        return value instanceof Integer || value instanceof Long;
    }

    private void showUpdatePrompt(UpdateContract.ReleaseMetadata release) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        new AlertDialog.Builder(activity)
            .setTitle("有新版 MailBox Manager")
            .setMessage("版本 " + release.versionName() + " 已可下載。Android 仍會要求你確認安裝。")
            .setNegativeButton("稍後", null)
            .setPositiveButton("下載更新", (dialog, which) -> downloadAndInstall(release))
            .show();
    }

    private void downloadAndInstall(UpdateContract.ReleaseMetadata release) {
        if (!downloadGate.begin()) {
            Toast.makeText(activity, "更新已在下載中", Toast.LENGTH_SHORT).show();
            return;
        }
        Toast.makeText(activity, "開始下載更新", Toast.LENGTH_SHORT).show();
        executor.execute(() -> {
            File directory = new File(activity.getCacheDir(), "verified-updates");
            File partial = new File(directory, "mailbox-update.part");
            File verified = new File(directory, "mailbox-manager-" + release.versionName() + ".apk");
            try {
                SecureUpdateDownloader.downloadVerified(release, partial, url -> (HttpURLConnection) url.openConnection());
                verifyArchive(partial, release);
                moveVerified(partial, verified);
                activity.runOnUiThread(() -> openInstaller(verified));
            } catch (Exception error) {
                Log.w(TAG, "Update download rejected", error);
                activity.runOnUiThread(() -> Toast.makeText(activity, "更新失敗或驗證未通過，請稍後再試", Toast.LENGTH_LONG).show());
            } finally {
                if (partial.exists() && !partial.delete()) partial.deleteOnExit();
                downloadGate.end();
            }
        });
    }

    private void verifyArchive(File apk, UpdateContract.ReleaseMetadata release) throws IOException {
        PackageManager packageManager = activity.getPackageManager();
        PackageInfo info;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
        } else {
            info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        }
        if (info == null || !UpdateContract.EXPECTED_PACKAGE.equals(info.packageName)) throw new IOException("下載套件名稱不符");
        long archiveVersionCode = PackageInfoCompat.getLongVersionCode(info);
        if (archiveVersionCode != release.versionCode() || archiveVersionCode <= BuildConfig.VERSION_CODE) {
            throw new IOException("下載套件版本不符或倒退");
        }
        Signature[] signers = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        if (signers == null || signers.length != 1) throw new IOException("下載套件簽章數量不符");
        String signer = certificateSha256(signers[0]);
        if (!UpdateContract.EXPECTED_SIGNER_SHA256.equals(signer) || !release.signingCertificateSha256().equals(signer)) {
            throw new IOException("下載套件簽章不符");
        }
    }

    private void openInstaller(File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(activity, BuildConfig.APPLICATION_ID + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.w(TAG, "System installer unavailable", error);
            Toast.makeText(activity, "無法開啟系統安裝確認，請檢查是否允許此來源安裝", Toast.LENGTH_LONG).show();
        }
    }

    private static void moveVerified(File source, File destination) throws IOException {
        if (destination.exists() && !destination.delete()) throw new IOException("無法替換舊更新暫存檔");
        if (source.renameTo(destination)) return;
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.getFD().sync();
        }
        if (!source.delete()) source.deleteOnExit();
    }

    private static String certificateSha256(Signature signature) {
        try { return SecureUpdateDownloader.toHex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException("系統不支援 SHA-256", error); }
    }

    private static String readLimited(InputStream input, int limit) throws IOException {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int total = 0;
            int read;
            while ((read = source.read(buffer)) != -1) {
                total += read;
                if (total > limit) throw new IOException("Feed 過大");
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Override
    public void close() { executor.shutdownNow(); }

    private static final class NoUpdateAvailable extends Exception {}
}
