/*
 * Downloads one allowlisted APK and verifies its declared size and SHA-256.
 * AppUpdateManager supplies the fixed release contract; tests may inject a fake connection.
 * Partial files are deleted after interruption, network errors, or verification failures.
 */
package com.faidlix.mailboxmanager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class SecureUpdateDownloader {
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }

    private SecureUpdateDownloader() {}

    static void downloadVerified(UpdateContract.ReleaseMetadata release, File destination,
        ConnectionFactory connectionFactory) throws IOException {
        HttpURLConnection connection = null;
        boolean completed = false;
        try {
            connection = connectionFactory.open(new URL(release.downloadUrl()));
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("APK HTTP 狀態：" + status);
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength >= 0 && declaredLength != release.sizeBytes()) throw new IOException("APK Content-Length 不符");
            File parent = destination.getParentFile();
            if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new IOException("無法建立更新暫存資料夾");
            MessageDigest digest = sha256Digest();
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新下載已中斷");
                    total += read;
                    if (total > release.sizeBytes()) throw new IOException("APK 大小超過 metadata");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            if (total != release.sizeBytes()) throw new IOException("APK 下載大小不符");
            String actualHash = toHex(digest.digest());
            if (!actualHash.equals(release.sha256())) throw new IOException("APK SHA-256 不符");
            completed = true;
        } finally {
            if (connection != null) connection.disconnect();
            if (!completed && destination.exists() && !destination.delete()) destination.deleteOnExit();
        }
    }

    private static MessageDigest sha256Digest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException("系統不支援 SHA-256", error); }
    }

    static String toHex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return output.toString();
    }
}
