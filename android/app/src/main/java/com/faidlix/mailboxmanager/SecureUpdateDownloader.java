/*
 * Downloads one allowlisted APK and verifies its declared size and SHA-256.
 * AppUpdateManager supplies the fixed release contract; tests may inject a fake connection.
 * Partial files are deleted after interruption, network errors, or verification failures.
 */
package com.faidlix.mailboxmanager;

import java.io.File;
import java.io.FileInputStream;
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
        downloadVerifiedArtifact(release.downloadUrl(), release.sizeBytes(), release.sha256(), destination,
            "application/vnd.android.package-archive, application/octet-stream", connectionFactory);
    }

    static void downloadVerifiedPatch(UpdateContract.PatchMetadata patch, File destination,
        ConnectionFactory connectionFactory) throws IOException {
        downloadVerifiedArtifact(patch.downloadUrl(), patch.sizeBytes(), patch.sha256(), destination,
            "application/octet-stream", connectionFactory);
    }

    private static void downloadVerifiedArtifact(String downloadUrl, long expectedSize, String expectedSha256,
        File destination, String accept, ConnectionFactory connectionFactory) throws IOException {
        HttpURLConnection connection = null;
        boolean completed = false;
        try {
            connection = connectionFactory.open(new URL(downloadUrl));
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", accept);
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("更新檔 HTTP 狀態：" + status);
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength >= 0 && declaredLength != expectedSize) throw new IOException("更新檔 Content-Length 不符");
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
                    if (total > expectedSize) throw new IOException("更新檔大小超過 metadata");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            if (total != expectedSize) throw new IOException("更新檔下載大小不符");
            String actualHash = toHex(digest.digest());
            if (!actualHash.equals(expectedSha256)) throw new IOException("更新檔 SHA-256 不符");
            completed = true;
        } finally {
            if (connection != null) connection.disconnect();
            if (!completed && destination.exists() && !destination.delete()) destination.deleteOnExit();
        }
    }

    static String sha256(File file) throws IOException {
        MessageDigest digest = sha256Digest();
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return toHex(digest.digest());
    }

    static void verifyFile(File file, long expectedSize, String expectedSha256) throws IOException {
        if (!file.isFile() || file.length() != expectedSize) throw new IOException("更新檔大小不符");
        if (!sha256(file).equals(expectedSha256)) throw new IOException("更新檔 SHA-256 不符");
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
