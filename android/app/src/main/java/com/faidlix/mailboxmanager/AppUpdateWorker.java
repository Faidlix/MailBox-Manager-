package com.faidlix.mailboxmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.pm.ServiceInfo;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Data;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONException;

public final class AppUpdateWorker extends Worker {
    private static final String TAG = "MailBoxUpdateWorker";
    private static final String CHANNEL_ID = "mailbox-updates";
    private static final int NOTIFICATION_ID = 4110;
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String KEY_VERSION_NAME = "version-name";
    private static final String KEY_VERSION_CODE = "version-code";
    private static final String KEY_PACKAGE_NAME = "package-name";
    private static final String KEY_DOWNLOAD_URL = "download-url";
    private static final String KEY_SHA256 = "sha256";
    private static final String KEY_SIZE_BYTES = "size-bytes";
    private static final String KEY_SIGNER = "signer";

    public AppUpdateWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static Data inputData(UpdateContract.ReleaseMetadata release) {
        return new Data.Builder()
            .putString(KEY_VERSION_NAME, release.versionName())
            .putLong(KEY_VERSION_CODE, release.versionCode())
            .putString(KEY_PACKAGE_NAME, release.packageName())
            .putString(KEY_DOWNLOAD_URL, release.downloadUrl())
            .putString(KEY_SHA256, release.sha256())
            .putLong(KEY_SIZE_BYTES, release.sizeBytes())
            .putString(KEY_SIGNER, release.signingCertificateSha256())
            .build();
    }

    @NonNull @Override public Result doWork() {
        createNotificationChannel();
        setForegroundAsync(foregroundInfo("準備下載更新…"));
        UpdateContract.ReleaseMetadata release;
        try {
            release = releaseFromInput();
        } catch (RuntimeException error) {
            Log.w(TAG, "Rejected update work input", error);
            showFailureNotification("更新資料驗證失敗");
            return Result.failure();
        }

        File directory = new File(getApplicationContext().getFilesDir(), "verified-updates");
        File fullPartial = new File(directory, "mailbox-" + release.versionCode() + ".apk.part");
        File patchPartial = new File(directory, "mailbox-" + BuildConfig.VERSION_CODE + "-to-" + release.versionCode() + ".mbd.part");
        File rebuiltPartial = new File(directory, "mailbox-" + release.versionCode() + ".rebuilt.part");
        File verified = new File(directory, "mailbox-manager-" + release.versionName() + ".apk");
        try {
            if (verified.isFile()) {
                try {
                    SecureUpdateDownloader.verifyFile(verified, release.sizeBytes(), release.sha256());
                    AppUpdateManager.verifyArchive(getApplicationContext(), verified, release);
                    markPendingInstall(release);
                    showReadyToInstall(verified, release);
                    return Result.success();
                } catch (IOException error) {
                    Log.w(TAG, "Discarding invalid verified update cache", error);
                    delete(verified);
                }
            }

            File candidate = tryDelta(release, patchPartial, rebuiltPartial);
            if (candidate == null) {
                setForegroundAsync(foregroundInfo("下載完整更新…"));
                ResumableUpdateDownloader.download(release.downloadUrl(), release.sizeBytes(), release.sha256(), fullPartial,
                    APK_MIME + ", application/octet-stream", url -> (HttpURLConnection) url.openConnection());
                candidate = fullPartial;
            }
            try {
                AppUpdateManager.verifyArchive(getApplicationContext(), candidate, release);
            } catch (IOException error) {
                delete(candidate);
                throw new ResumableUpdateDownloader.PermanentDownloadException("更新 APK 套件驗證失敗", error);
            }
            AppUpdateManager.moveVerified(candidate, verified);
            markPendingInstall(release);
            showReadyToInstall(verified, release);
            delete(patchPartial);
            delete(rebuiltPartial);
            return Result.success();
        } catch (ResumableUpdateDownloader.PermanentDownloadException | IllegalArgumentException | JSONException error) {
            Log.w(TAG, "Update rejected permanently", error);
            showFailureNotification("更新驗證失敗，已停止重試");
            return Result.failure();
        } catch (IOException error) {
            Log.w(TAG, "Update interrupted; partial download retained", error);
            if (getRunAttemptCount() < 5) return Result.retry();
            showFailureNotification("下載暫停；再次按更新可接續下載");
            return Result.failure();
        }
    }

    private File tryDelta(UpdateContract.ReleaseMetadata release, File patchPartial, File rebuiltPartial)
        throws IOException, JSONException {
        UpdateContract.PatchMetadata patch;
        try {
            patch = fetchDeltaPatch(release);
        } catch (IOException error) {
            Log.w(TAG, "Delta feed unavailable; using full APK", error);
            return null;
        }
        if (patch == null) return null;
        setForegroundAsync(foregroundInfo("下載差分更新…"));
        try {
            ResumableUpdateDownloader.download(patch.downloadUrl(), patch.sizeBytes(), patch.sha256(), patchPartial,
                "application/octet-stream", url -> (HttpURLConnection) url.openConnection());
        } catch (ResumableUpdateDownloader.PermanentDownloadException error) {
            Log.w(TAG, "Delta artifact invalid; using full APK", error);
            delete(patchPartial);
            return null;
        }
        try {
            BinaryDelta.apply(new File(getApplicationContext().getApplicationInfo().sourceDir), patchPartial,
                rebuiltPartial, release.sizeBytes());
            SecureUpdateDownloader.verifyFile(rebuiltPartial, release.sizeBytes(), release.sha256());
            return rebuiltPartial;
        } catch (IOException error) {
            Log.w(TAG, "Delta reconstruction invalid; using full APK", error);
            delete(patchPartial);
            delete(rebuiltPartial);
            return null;
        }
    }

    private UpdateContract.PatchMetadata fetchDeltaPatch(UpdateContract.ReleaseMetadata release) throws IOException, JSONException {
        File installedApk = new File(getApplicationContext().getApplicationInfo().sourceDir);
        String installedHash = SecureUpdateDownloader.sha256(installedApk);
        HttpURLConnection connection = (HttpURLConnection) new URL(UpdateContract.DELTA_FEED_URL).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status == HttpURLConnection.HTTP_NOT_FOUND) return null;
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("差分 feed HTTP 狀態：" + status);
            long length = connection.getContentLengthLong();
            if (length > AppUpdateManager.MAX_FEED_BYTES) throw new IOException("差分 feed 過大");
            AppUpdateManager.DeltaManifest manifest = AppUpdateManager.parseDeltaManifest(
                AppUpdateManager.readLimited(connection.getInputStream(), AppUpdateManager.MAX_FEED_BYTES));
            if (manifest.targetVersionCode() != release.versionCode()
                || !manifest.targetSha256().equals(release.sha256())) return null;
            for (UpdateContract.PatchMetadata patch : manifest.patches()) {
                if (patch.fromVersionCode() == BuildConfig.VERSION_CODE
                    && UpdateContract.normalizeHash(patch.fromSha256()).equals(installedHash)) {
                    return UpdateContract.validatePatch(patch, BuildConfig.VERSION_CODE, installedHash, release);
                }
            }
            return null;
        } finally {
            connection.disconnect();
        }
    }

    private UpdateContract.ReleaseMetadata releaseFromInput() {
        Data input = getInputData();
        UpdateContract.ReleaseMetadata release = new UpdateContract.ReleaseMetadata(
            1, input.getString(KEY_VERSION_NAME), input.getLong(KEY_VERSION_CODE, -1), input.getString(KEY_PACKAGE_NAME),
            input.getString(KEY_DOWNLOAD_URL), input.getString(KEY_SHA256), input.getLong(KEY_SIZE_BYTES, -1),
            input.getString(KEY_SIGNER));
        return UpdateContract.validate(release, BuildConfig.VERSION_CODE);
    }

    private void markPendingInstall(UpdateContract.ReleaseMetadata release) {
        getApplicationContext().getSharedPreferences(AppUpdateManager.PREFS, 0).edit()
            .putLong(AppUpdateManager.PENDING_VERSION_CODE, release.versionCode())
            .putString(AppUpdateManager.PENDING_VERSION_NAME, release.versionName())
            .apply();
    }

    private Notification progressNotification(String text) {
        return new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("MailBox Manager 更新")
            .setContentText(text)
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private ForegroundInfo foregroundInfo(String text) {
        Notification notification = progressNotification(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        }
        return new ForegroundInfo(NOTIFICATION_ID, notification);
    }

    private void showReadyToInstall(File apk, UpdateContract.ReleaseMetadata release) {
        Intent installer = AppUpdateManager.installerIntent(getApplicationContext(), apk);
        PendingIntent action = PendingIntent.getActivity(getApplicationContext(), 0, installer,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("MailBox Manager " + release.versionName() + " 已下載")
            .setContentText("點一下開啟 Android 安裝確認")
            .setContentIntent(action)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build();
        notificationManager().notify(NOTIFICATION_ID, notification);
        try { getApplicationContext().startActivity(installer); }
        catch (RuntimeException error) { Log.i(TAG, "Background installer launch deferred to notification", error); }
    }

    private void showFailureNotification(String text) {
        Notification notification = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("MailBox Manager 更新未完成")
            .setContentText(text)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build();
        notificationManager().notify(NOTIFICATION_ID, notification);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "App 更新", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("下載完成後通知安裝 MailBox Manager 更新");
        notificationManager().createNotificationChannel(channel);
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static void delete(File file) {
        if (file.exists() && !file.delete()) file.deleteOnExit();
    }
}
