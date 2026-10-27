package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ResumableUpdateDownloaderTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void resumesFromVerifiedPartialBytesWithRange() throws Exception {
        byte[] full = "0123456789abcdef".getBytes();
        File partial = temporaryFolder.newFile("update.part");
        Files.write(partial.toPath(), "012345".getBytes());
        FakeConnection connection = new FakeConnection(new URL("https://example.test/update.apk"),
            "6789abcdef".getBytes(), HttpURLConnection.HTTP_PARTIAL, "bytes 6-15/16");
        ResumableUpdateDownloader.download(connection.getURL().toString(), full.length, sha256(full), partial,
            "application/octet-stream", ignored -> connection);
        assertEquals("bytes=6-", connection.getRequestProperty("Range"));
        assertArrayEquals(full, Files.readAllBytes(partial.toPath()));
    }

    @Test
    public void serverIgnoringRangeSafelyRestartsTheSameFile() throws Exception {
        byte[] full = "replacement bytes".getBytes();
        File partial = temporaryFolder.newFile("restart.part");
        Files.write(partial.toPath(), "stale prefix".getBytes());
        FakeConnection connection = new FakeConnection(new URL("https://example.test/update.apk"),
            full, HttpURLConnection.HTTP_OK, null);
        ResumableUpdateDownloader.download(connection.getURL().toString(), full.length, sha256(full), partial,
            "application/octet-stream", ignored -> connection);
        assertArrayEquals(full, Files.readAllBytes(partial.toPath()));
    }

    @Test
    public void transientFailureKeepsPartialButIntegrityFailureDeletesIt() throws Exception {
        byte[] full = "full update".getBytes();
        File transientPartial = temporaryFolder.newFile("transient.part");
        Files.write(transientPartial.toPath(), "full".getBytes());
        FakeConnection transientConnection = new FakeConnection(new URL("https://example.test/update.apk"),
            " update".getBytes(), HttpURLConnection.HTTP_PARTIAL, "bytes 4-10/11");
        transientConnection.input = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("offline"); }
        };
        assertThrows(IOException.class, () -> ResumableUpdateDownloader.download(transientConnection.getURL().toString(),
            full.length, sha256(full), transientPartial, "application/octet-stream", ignored -> transientConnection));
        assertTrue(transientPartial.exists());

        File corrupt = temporaryFolder.newFile("corrupt.part");
        FakeConnection corruptConnection = new FakeConnection(new URL("https://example.test/update.apk"),
            full, HttpURLConnection.HTTP_OK, null);
        assertThrows(ResumableUpdateDownloader.PermanentDownloadException.class,
            () -> ResumableUpdateDownloader.download(corruptConnection.getURL().toString(), full.length,
                "0".repeat(64), corrupt, "application/octet-stream", ignored -> corruptConnection));
        assertFalse(corrupt.exists());
    }

    private static String sha256(byte[] body) throws Exception {
        return SecureUpdateDownloader.toHex(MessageDigest.getInstance("SHA-256").digest(body));
    }

    private static final class FakeConnection extends HttpURLConnection {
        private final byte[] body;
        private final int status;
        private final String contentRange;
        private InputStream input;

        FakeConnection(URL url, byte[] body, int status, String contentRange) {
            super(url); this.body = body; this.status = status; this.contentRange = contentRange;
        }
        @Override public int getResponseCode() { return status; }
        @Override public long getContentLengthLong() { return body.length; }
        @Override public String getHeaderField(String name) { return "Content-Range".equalsIgnoreCase(name) ? contentRange : null; }
        @Override public InputStream getInputStream() { return input == null ? new ByteArrayInputStream(body) : input; }
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }
}
