/*
 * Unit tests for Android-only filename handling.
 * Run with `cd android && gradlew.bat testDebugUnitTest` before packaging an APK.
 */
package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertEquals;

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
}
