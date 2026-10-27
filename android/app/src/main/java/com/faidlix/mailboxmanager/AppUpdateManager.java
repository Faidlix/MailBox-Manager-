/*
 * Checks the fixed public MailBox release feed on launch/foreground with throttling.
 * Schedules one resumable update when the user accepts, validates package/version/signer,
 * then opens Android's installer. It never polls periodically or performs silent installation.
 */
package com.faidlix.mailboxmanager;

import android.Manifest;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.net.Uri;
import android.util.Log;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class AppUpdateManager implements AutoCloseable {
    private static final String TAG = "MailBoxUpdate";
    static final String PREFS = "mailbox-update";
    static final String PENDING_VERSION_CODE = "pending-version-code";
    static final String PENDING_VERSION_NAME = "pending-version-name";
    static final String UPDATE_WORK_NAME = "mailbox-apk-update";
    static final int NOTIFICATION_PERMISSION_REQUEST = 4109;
    private static final String LAST_ATTEMPT = "last-attempt";
    private static final String LAST_SUCCESS = "last-success";
    private static final long SUCCESS_INTERVAL_MS = 6L * 60L * 60L * 1000L;
    private static final long FAILURE_INTERVAL_MS = 30L * 60L * 1000L;
    static final int MAX_FEED_BYTES = 64 * 1024;
    private static final Set<String> RELEASE_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "schemaVersion", "versionName", "versionCode", "packageName",
        "downloadUrl", "sha256", "sizeBytes", "signingCertificateSha256"
    )));
    private static final Set<String> DELTA_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "schemaVersion", "targetVersionCode", "targetSha256", "patches"
    )));
    private static final Set<String> PATCH_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "fromVersionCode", "fromSha256", "downloadUrl", "sha256", "sizeBytes"
    )));

    private final MainActivity activity;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final UpdateContract.SingleFlightGate checkGate = new UpdateContract.SingleFlightGate();
    private final SharedPreferences preferences;
    private UpdateContract.ReleaseMetadata pendingPermissionRelease;

    AppUpdateManager(MainActivity activity) {
        this.activity = activity;
        this.preferences = activity.getSharedPreferences(PREFS, 0);
        cleanupAfterCompletedInstall(activity, preferences);
    }

    void checkIfDue() {
        if (showPendingInstallIfReady()) return;
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

    static DeltaManifest parseDeltaManifest(String body) throws JSONException {
        JSONObject json = new JSONObject(body);
        if (!keysOf(json).equals(DELTA_KEYS)) throw new JSONException("差分 metadata 欄位不符");
        Object schema = json.get("schemaVersion");
        Object targetVersionCode = json.get("targetVersionCode");
        if (!isJsonInteger(schema) || !isJsonInteger(targetVersionCode) || ((Number) schema).intValue() != 1) {
            throw new JSONException("差分 metadata 數值型別錯誤");
        }
        JSONArray array = json.getJSONArray("patches");
        if (array.length() > 64) throw new JSONException("差分項目過多");
        List<UpdateContract.PatchMetadata> patches = new ArrayList<>();
        for (int index = 0; index < array.length(); index++) {
            JSONObject item = array.getJSONObject(index);
            if (!keysOf(item).equals(PATCH_KEYS)) throw new JSONException("差分項目欄位不符");
            Object fromVersionCode = item.get("fromVersionCode");
            Object sizeBytes = item.get("sizeBytes");
            if (!isJsonInteger(fromVersionCode) || !isJsonInteger(sizeBytes)) throw new JSONException("差分項目數值型別錯誤");
            patches.add(new UpdateContract.PatchMetadata(
                ((Number) fromVersionCode).longValue(), item.getString("fromSha256"), item.getString("downloadUrl"),
                item.getString("sha256"), ((Number) sizeBytes).longValue()
            ));
        }
        return new DeltaManifest(((Number) targetVersionCode).longValue(),
            UpdateContract.normalizeHash(json.getString("targetSha256")), patches);
    }

    private static Set<String> keysOf(JSONObject json) {
        Set<String> keys = new HashSet<>();
        Iterator<String> iterator = json.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        return keys;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingPermissionRelease = release;
            ActivityCompat.requestPermissions(activity,
                new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
            return;
        }
        enqueueBackgroundUpdate(release);
    }

    boolean handlePermissionResult(int requestCode) {
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return false;
        UpdateContract.ReleaseMetadata release = pendingPermissionRelease;
        pendingPermissionRelease = null;
        if (release != null) enqueueBackgroundUpdate(release);
        return true;
    }

    private void enqueueBackgroundUpdate(UpdateContract.ReleaseMetadata release) {
        Data input = AppUpdateWorker.inputData(release);
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest work = new OneTimeWorkRequest.Builder(AppUpdateWorker.class)
            .setInputData(input)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(activity).enqueueUniqueWork(UPDATE_WORK_NAME, ExistingWorkPolicy.KEEP, work);
        Toast.makeText(activity, "更新會在背景下載，完成後通知安裝", Toast.LENGTH_LONG).show();
        activity.moveTaskToBack(true);
    }

    private boolean showPendingInstallIfReady() {
        long pendingVersion = preferences.getLong(PENDING_VERSION_CODE, 0);
        String pendingName = preferences.getString(PENDING_VERSION_NAME, "");
        if (pendingVersion <= BuildConfig.VERSION_CODE || pendingName == null || pendingName.isBlank()) return false;
        File verified = new File(new File(activity.getFilesDir(), "verified-updates"),
            "mailbox-manager-" + pendingName + ".apk");
        if (!verified.isFile()) return false;
        if (activity.isFinishing() || activity.isDestroyed()) return true;
        new AlertDialog.Builder(activity)
            .setTitle("更新已下載完成")
            .setMessage("MailBox Manager " + pendingName + " 已暫存完成，請由 Android 確認安裝。")
            .setNegativeButton("稍後", null)
            .setPositiveButton("安裝", (dialog, which) -> activity.startActivity(installerIntent(activity, verified)))
            .show();
        return true;
    }

    static Intent installerIntent(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".fileprovider", apk);
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    static void verifyArchive(Context context, File apk, UpdateContract.ReleaseMetadata release) throws IOException {
        PackageManager packageManager = context.getPackageManager();
        PackageInfo info;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES));
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        } else {
            info = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
        }
        if (info == null || !UpdateContract.EXPECTED_PACKAGE.equals(info.packageName)) throw new IOException("下載套件名稱不符");
        long archiveVersionCode = PackageInfoCompat.getLongVersionCode(info);
        if (archiveVersionCode != release.versionCode() || archiveVersionCode <= BuildConfig.VERSION_CODE) {
            throw new IOException("下載套件版本不符或倒退");
        }
        Signature[] signers;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signers = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signers = info.signatures;
        }
        if (signers == null || signers.length != 1) throw new IOException("下載套件簽章數量不符");
        String signer = certificateSha256(signers[0]);
        if (!UpdateContract.EXPECTED_SIGNER_SHA256.equals(signer) || !release.signingCertificateSha256().equals(signer)) {
            throw new IOException("下載套件簽章不符");
        }
    }

    static void moveVerified(File source, File destination) throws IOException {
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

    static String readLimited(InputStream input, int limit) throws IOException {
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

    private static void cleanupAfterCompletedInstall(Context context, SharedPreferences preferences) {
        long pendingVersion = preferences.getLong(PENDING_VERSION_CODE, 0);
        if (pendingVersion <= 0 || BuildConfig.VERSION_CODE < pendingVersion) return;
        deleteRecursively(new File(context.getFilesDir(), "verified-updates"));
        preferences.edit().remove(PENDING_VERSION_CODE).remove(PENDING_VERSION_NAME).apply();
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        if (file.exists() && !file.delete()) file.deleteOnExit();
    }

    private static final class NoUpdateAvailable extends Exception {}

    record DeltaManifest(long targetVersionCode, String targetSha256, List<UpdateContract.PatchMetadata> patches) {}
}
