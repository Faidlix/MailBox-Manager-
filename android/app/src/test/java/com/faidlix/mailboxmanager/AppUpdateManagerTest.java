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
    private static final String VALID_DELTA = """
        {
          "schemaVersion": 1,
          "targetVersionCode": 32,
          "targetSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "patches": [{
            "fromVersionCode": 31,
            "fromSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "downloadUrl": "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.31-to-0.1.32.mbd",
            "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "sizeBytes": 512
          }]
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

    @Test
    public void parsesStrictCompanionDeltaSchemaWithoutChangingLegacyReleaseSchema() throws Exception {
        AppUpdateManager.DeltaManifest manifest = AppUpdateManager.parseDeltaManifest(VALID_DELTA);
        assertEquals(32, manifest.targetVersionCode());
        assertEquals(1, manifest.patches().size());
        assertEquals(31, manifest.patches().get(0).fromVersionCode());
        assertThrows(JSONException.class, () -> AppUpdateManager.parseDeltaManifest(VALID_DELTA.replace("\n}", ",\n\"extra\": true\n}")));
        assertThrows(JSONException.class, () -> AppUpdateManager.parseDeltaManifest(VALID_DELTA.replace("\"sizeBytes\": 512", "\"sizeBytes\": \"512\"")));
    }
}
