/*
 * Pure validation contract for MailBox APK updates.
 * Used by AppUpdateManager and local JVM tests; no network or installation occurs here.
 * The public feed and APK path are fixed to Faidlix/Web GitHub Pages.
 */
package com.faidlix.mailboxmanager;

import java.net.URI;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

final class UpdateContract {
    static final String FEED_URL = "https://faidlix.github.io/Web/mailbox-manager/downloads/release.json";
    static final String EXPECTED_PACKAGE = "com.faidlix.mailboxmanager";
    static final String EXPECTED_SIGNER_SHA256 = "5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12";
    static final long MAX_APK_BYTES = 100L * 1024L * 1024L;
    private static final Pattern VERSION_NAME = Pattern.compile("^[0-9]+\\.[0-9]+\\.[0-9]+$");
    private static final Pattern SHA256 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern APK_PATH = Pattern.compile("^/Web/mailbox-manager/downloads/mailbox-manager-[A-Za-z0-9._-]+\\.apk$");

    private UpdateContract() {}

    static ReleaseMetadata validate(ReleaseMetadata release, long installedVersionCode) {
        if (release.schemaVersion != 1) throw new IllegalArgumentException("不支援的更新 metadata schema");
        if (!EXPECTED_PACKAGE.equals(release.packageName)) throw new IllegalArgumentException("套件名稱不符");
        if (!VERSION_NAME.matcher(release.versionName).matches()) throw new IllegalArgumentException("版本名稱格式錯誤");
        if (release.versionCode <= installedVersionCode) throw new IllegalArgumentException("已阻擋相同或較舊版本");
        if (release.sizeBytes <= 0 || release.sizeBytes > MAX_APK_BYTES) throw new IllegalArgumentException("APK 大小不合理");
        String hash = normalizeHash(release.sha256);
        String signer = normalizeHash(release.signingCertificateSha256);
        if (!EXPECTED_SIGNER_SHA256.equals(signer)) throw new IllegalArgumentException("簽章指紋不符");
        if (!isAllowedApkUrl(release.downloadUrl)) throw new IllegalArgumentException("APK 網址不在允許範圍");
        return new ReleaseMetadata(release.schemaVersion, release.versionName, release.versionCode, release.packageName,
            release.downloadUrl, hash, release.sizeBytes, signer);
    }

    static boolean isAllowedApkUrl(String value) {
        try {
            URI uri = URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "faidlix.github.io".equalsIgnoreCase(uri.getHost())
                && uri.getPort() == -1
                && uri.getRawUserInfo() == null
                && uri.getRawQuery() == null
                && uri.getRawFragment() == null
                && APK_PATH.matcher(uri.getRawPath()).matches();
        } catch (RuntimeException error) {
            return false;
        }
    }

    static String normalizeHash(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!SHA256.matcher(normalized).matches()) throw new IllegalArgumentException("SHA-256 格式錯誤");
        return normalized;
    }

    record ReleaseMetadata(int schemaVersion, String versionName, long versionCode, String packageName,
        String downloadUrl, String sha256, long sizeBytes, String signingCertificateSha256) {}

    static final class SingleFlightGate {
        private final AtomicBoolean running = new AtomicBoolean(false);

        boolean begin() { return running.compareAndSet(false, true); }
        void end() { running.set(false); }
        boolean isRunning() { return running.get(); }
    }
}
