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
    public void acceptsOnlyTheExactHttpsSiteOrigin() {
        assertTrue(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/#inbox"));
        assertTrue(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site:443/api/messages/1"));
        assertFalse(MainActivity.isTrustedAppUrl("http://mailbox-manager-test.fantasy02dreamer08.chatgpt.site/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site.evil.example/"));
        assertFalse(MainActivity.isTrustedAppUrl("https://mailbox-manager-test.fantasy02dreamer08.chatgpt.site:8443/"));
        assertFalse(MainActivity.isTrustedAppUrl(null));
    }
}
