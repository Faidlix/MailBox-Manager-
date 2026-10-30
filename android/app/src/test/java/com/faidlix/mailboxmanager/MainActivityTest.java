/*
 * Unit tests for Android-only filename handling.
 * Run with `cd android && gradlew.bat testDebugUnitTest` before packaging an APK.
 */
package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MainActivityTest {

    @Test
    public void addsEmlExtensionAndRemovesUnsafeCharacters() {
        assertEquals("invoice_2026.eml", MainActivity.normalizeEmlFilename("invoice/2026"));
    }

    @Test
    public void keepsExistingExtensionCaseInsensitively() {
        assertEquals("message.EML", MainActivity.normalizeEmlFilename("message.EML"));
    }

    @Test
    public void suppliesFallbackForBlankFilename() {
        assertEquals("message.eml", MainActivity.normalizeEmlFilename("  "));
    }

    @Test
    public void sanitizesSharedFilenamesAndMimeTypes() {
        assertEquals("invoice_2026.pdf", MainActivity.normalizeSharedFilename("invoice/2026.pdf"));
        assertEquals("mailbox-file", MainActivity.normalizeSharedFilename(".."));
        assertEquals("image/png", MainActivity.normalizeMimeType("IMAGE/PNG"));
        assertEquals("application/octet-stream", MainActivity.normalizeMimeType("text/plain\r\nInjected: value"));
    }

    @Test
    public void acceptsOnlyBundledOrHostedHttpsOrigins() {
        assertTrue(MainActivity.isTrustedAppUrl("https://localhost/#inbox"));
        assertTrue(MainActivity.isTrustedAppUrl("https://localhost:443/message.eml"));
        assertTrue(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/#inbox"));
        assertFalse(MainActivity.isTrustedAppUrl("http://localhost/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://localhost.evil.example/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://localhost:8443/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://user:password@localhost/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site.evil.example/"));
        assertFalse(MainActivity.isTrustedAppUrl(null));
    }

    @Test
    public void acceptsOnlyExactOAuthCallbacks() {
        assertTrue(MainActivity.isTrustedOAuthCallback(
            "https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/app/oauth/callback?code=abcdefghijklmnopqrstuvwxyz"
        ));
        assertTrue(MainActivity.isTrustedOAuthCallback(
            "mailboxmanager://oauth/callback?code=abcdefghijklmnopqrstuvwxyz"
        ));
        assertFalse(MainActivity.isTrustedOAuthCallback(
            "https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site.evil.example/app/oauth/callback?code=abcdefghijklmnopqrstuvwxyz"
        ));
        assertFalse(MainActivity.isTrustedOAuthCallback(
            "mailboxmanager://oauth/other?code=abcdefghijklmnopqrstuvwxyz"
        ));
        assertFalse(MainActivity.isTrustedOAuthCallback(
            "mailboxmanager://user:password@oauth/callback?code=abcdefghijklmnopqrstuvwxyz"
        ));
    }
}
