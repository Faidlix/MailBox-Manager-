/*
 * Tests successful download verification plus network, interruption, size, and hash failures.
 * Run with `cd android && gradlew.bat testDebugUnitTest`; no external network is used.
 */
package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class SecureUpdateDownloaderTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    private static UpdateContract.ReleaseMetadata release(byte[] body, String hash) {
        return new UpdateContract.ReleaseMetadata(
            1, "0.1.27", 27, UpdateContract.EXPECTED_PACKAGE,
            "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.27-site26-debug.apk",
            hash, body.length, UpdateContract.EXPECTED_SIGNER_SHA256
        );
    }

    private static String sha256(byte[] body) throws Exception {
        return SecureUpdateDownloader.toHex(MessageDigest.getInstance("SHA-256").digest(body));
    }

    @Test
    public void writesOnlyCompleteHashMatchedDownload() throws Exception {
        byte[] body = "verified apk bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        File target = new File(temporaryFolder.getRoot(), "update.part");
        SecureUpdateDownloader.downloadVerified(release(body, sha256(body)), target,
            url -> new FakeConnection(url, body, HttpURLConnection.HTTP_OK, null));
        assertArrayEquals(body, Files.readAllBytes(target.toPath()));
    }

    @Test
    public void networkFailureRemovesPartialFile() throws Exception {
        byte[] body = "apk".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        File target = new File(temporaryFolder.getRoot(), "update.part");
        assertThrows(IOException.class, () -> SecureUpdateDownloader.downloadVerified(
            release(body, sha256(body)), target, url -> { throw new IOException("offline"); }));
        assertFalse(target.exists());
    }

    @Test
    public void interruptedDownloadRemovesPartialFile() throws Exception {
        byte[] body = "apk bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        File target = new File(temporaryFolder.getRoot(), "update.part");
        InputStream interrupted = new InputStream() {
            private int reads;
            @Override public int read() throws IOException {
                if (reads++ > 1) throw new InterruptedIOException("interrupted");
                return 'a';
            }
        };
        assertThrows(IOException.class, () -> SecureUpdateDownloader.downloadVerified(
            release(body, sha256(body)), target,
            url -> new FakeConnection(url, body, HttpURLConnection.HTTP_OK, interrupted)));
        assertFalse(target.exists());
    }

    @Test
    public void hashMismatchAndDeclaredLengthMismatchAreRejected() throws Exception {
        byte[] body = "apk bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        File hashTarget = new File(temporaryFolder.getRoot(), "hash.part");
        assertThrows(IOException.class, () -> SecureUpdateDownloader.downloadVerified(
            release(body, "0".repeat(64)), hashTarget,
            url -> new FakeConnection(url, body, HttpURLConnection.HTTP_OK, null)));
        assertFalse(hashTarget.exists());

        File lengthTarget = new File(temporaryFolder.getRoot(), "length.part");
        byte[] shorter = "short".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        assertThrows(IOException.class, () -> SecureUpdateDownloader.downloadVerified(
            release(body, sha256(body)), lengthTarget,
            url -> new FakeConnection(url, shorter, HttpURLConnection.HTTP_OK, null)));
        assertFalse(lengthTarget.exists());
    }

    private static final class FakeConnection extends HttpURLConnection {
        private final byte[] body;
        private final int status;
        private final InputStream customInput;

        FakeConnection(URL url, byte[] body, int status, InputStream customInput) {
            super(url);
            this.body = body;
            this.status = status;
            this.customInput = customInput;
        }

        @Override public int getResponseCode() { return status; }
        @Override public long getContentLengthLong() { return body.length; }
        @Override public InputStream getInputStream() { return customInput == null ? new ByteArrayInputStream(body) : customInput; }
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }
}
