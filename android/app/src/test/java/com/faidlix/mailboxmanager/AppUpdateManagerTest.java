/*
 * Tests strict release.json parsing for the native updater.
 * Run with `cd android && gradlew.bat testDebugUnitTest`; no Android device is required.
 */
package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONException;
import org.junit.Test;

public class AppUpdateManagerTest {
    private static final String VALID = """
        {
          "schemaVersion": 1,
          "versionName": "0.1.27",
          "versionCode": 27,
          "packageName": "com.faidlix.mailboxmanager",
          "downloadUrl": "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.27-site26-debug.apk",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "sizeBytes": 1024,
          "signingCertificateSha256": "5f74b5df9e4c21fdbb590e39a807111578aa22cb0286558d0d6d1721174d0a12"
        }
        """;

    @Test
    public void parsesExactSchema() throws Exception {
        UpdateContract.ReleaseMetadata release = AppUpdateManager.parseRelease(VALID);
        assertEquals(27, release.versionCode());
        assertEquals("0.1.27", release.versionName());
    }

    @Test
    public void rejectsMissingExtraAndWrongTypeFields() {
        assertThrows(JSONException.class, () -> AppUpdateManager.parseRelease(VALID.replace("\"sha256\":", "\"ignored\":")));
        assertThrows(JSONException.class, () -> AppUpdateManager.parseRelease(VALID.replace("\n}", ",\n\"extra\": true\n}")));
        assertThrows(JSONException.class, () -> AppUpdateManager.parseRelease(VALID.replace("\"versionCode\": 27", "\"versionCode\": \"27\"")));
        assertThrows(JSONException.class, () -> AppUpdateManager.parseRelease(VALID.replace("\"versionCode\": 27", "\"versionCode\": 27.5")));
    }
}
