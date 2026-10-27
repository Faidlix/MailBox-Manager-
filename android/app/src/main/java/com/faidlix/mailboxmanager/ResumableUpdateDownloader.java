package com.faidlix.mailboxmanager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ResumableUpdateDownloader {
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    static final class PermanentDownloadException extends IOException {
        PermanentDownloadException(String message) { super(message); }
    }

    private static final Pattern CONTENT_RANGE = Pattern.compile("^bytes ([0-9]+)-([0-9]+)/([0-9]+)$");

    private ResumableUpdateDownloader() {}

    static void download(String url, long expectedSize, String expectedSha256, File destination, String accept,
        ConnectionFactory connections) throws IOException {
        File parent = destination.getParentFile();
        if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new IOException("無法建立更新暫存資料夾");
        long existing = destination.isFile() ? destination.length() : 0;
        if (existing > expectedSize) { delete(destination); existing = 0; }
        if (existing == expectedSize && existing > 0) {
            if (SecureUpdateDownloader.sha256(destination).equals(expectedSha256)) return;
            delete(destination); existing = 0;
        }

        HttpURLConnection connection = connections.open(new URL(url));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestProperty("Accept", accept);
        if (existing > 0) connection.setRequestProperty("Range", "bytes=" + existing + "-");
        try {
            int status = connection.getResponseCode();
            boolean append = existing > 0 && status == HttpURLConnection.HTTP_PARTIAL;
            if (existing > 0 && status == HttpURLConnection.HTTP_OK) { existing = 0; append = false; }
            else if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
                throw new IOException("更新檔 HTTP 狀態：" + status);
            }
            if (append) {
                try { validateContentRange(connection.getHeaderField("Content-Range"), existing, expectedSize); }
                catch (PermanentDownloadException error) { delete(destination); throw error; }
            }
            long expectedResponseBytes = expectedSize - existing;
            long contentLength = connection.getContentLengthLong();
            if (contentLength >= 0 && contentLength != expectedResponseBytes) {
                throw permanent(destination, "更新檔 Content-Length 不符");
            }

            long total = existing;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination, append)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新下載已中斷");
                    total += read;
                    if (total > expectedSize) throw permanent(destination, "更新檔大小超過 metadata");
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
            }
            if (total != expectedSize) throw new IOException("更新檔尚未下載完整");
            if (!SecureUpdateDownloader.sha256(destination).equals(expectedSha256)) {
                throw permanent(destination, "更新檔 SHA-256 不符");
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void validateContentRange(String value, long existing, long expectedSize) throws PermanentDownloadException {
        Matcher matcher = value == null ? null : CONTENT_RANGE.matcher(value);
        boolean valid = matcher != null && matcher.matches();
        try {
            valid = valid
                && Long.parseLong(matcher.group(1)) == existing
                && Long.parseLong(matcher.group(2)) == expectedSize - 1
                && Long.parseLong(matcher.group(3)) == expectedSize;
        } catch (NumberFormatException error) { valid = false; }
        if (!valid) {
            throw new PermanentDownloadException("更新檔 Content-Range 不符");
        }
    }

    private static PermanentDownloadException permanent(File destination, String message) {
        delete(destination);
        return new PermanentDownloadException(message);
    }

    private static void delete(File file) {
        if (file.exists() && !file.delete()) file.deleteOnExit();
    }
}
