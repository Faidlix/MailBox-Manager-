/*
 * Tests the fixed update schema, origin/path allowlist, downgrade protection, and single-flight gate.
 * Run with `cd android && gradlew.bat testDebugUnitTest`.
 */
package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class UpdateContractTest {
    private static UpdateContract.ReleaseMetadata release(long versionCode, String url) {
        return new UpdateContract.ReleaseMetadata(
            1,
            "0.1.27",
            versionCode,
            UpdateContract.EXPECTED_PACKAGE,
            url,
            "a".repeat(64),
            1024,
            UpdateContract.EXPECTED_SIGNER_SHA256
        );
    }

    @Test
    public void acceptsOnlyPinnedPublicPagesPath() {
        String allowed = "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.27-site26-debug.apk";
        assertTrue(UpdateContract.isAllowedApkUrl(allowed));
        assertFalse(UpdateContract.isAllowedApkUrl("https://example.com/mailbox-manager-0.1.27.apk"));
        assertFalse(UpdateContract.isAllowedApkUrl(allowed + "?redirect=1"));
        assertFalse(UpdateContract.isAllowedApkUrl("https://faidlix.github.io/Web/other/update.apk"));
    }

    @Test
    public void acceptsOnlyPinnedDeltaPathAndMatchingSource() {
        String apkUrl = "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.32-bundled-release.apk";
        UpdateContract.ReleaseMetadata target = new UpdateContract.ReleaseMetadata(
            1, "0.1.32", 32, UpdateContract.EXPECTED_PACKAGE, apkUrl, "a".repeat(64), 4096,
            UpdateContract.EXPECTED_SIGNER_SHA256);
        String patchUrl = "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.31-to-0.1.32.mbd";
        UpdateContract.PatchMetadata patch = new UpdateContract.PatchMetadata(31, "b".repeat(64), patchUrl, "c".repeat(64), 1024);
        assertTrue(UpdateContract.isAllowedPatchUrl(patchUrl));
        assertFalse(UpdateContract.isAllowedPatchUrl(patchUrl + "?download=1"));
        assertFalse(UpdateContract.isAllowedPatchUrl("https://example.com/update.mbd"));
        assertEquals(patchUrl, UpdateContract.validatePatch(patch, 31, "b".repeat(64), target).downloadUrl());
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validatePatch(patch, 30, "b".repeat(64), target));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validatePatch(patch, 31, "d".repeat(64), target));
    }

    @Test
    public void blocksVersionCodeDowngradeOrReuse() {
        String url = "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.27-site26-debug.apk";
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(release(26, url), 26));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(release(25, url), 26));
    }

    @Test
    public void rejectsInvalidSchemaPackageHashSizeAndSigner() {
        String url = "https://faidlix.github.io/Web/mailbox-manager/downloads/mailbox-manager-0.1.27-site26-debug.apk";
        UpdateContract.ReleaseMetadata valid = release(27, url);
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(new UpdateContract.ReleaseMetadata(
            2, valid.versionName(), valid.versionCode(), valid.packageName(), valid.downloadUrl(), valid.sha256(),
            valid.sizeBytes(), valid.signingCertificateSha256()), 26));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(new UpdateContract.ReleaseMetadata(
            1, valid.versionName(), valid.versionCode(), "other.package", valid.downloadUrl(), valid.sha256(),
            valid.sizeBytes(), valid.signingCertificateSha256()), 26));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(new UpdateContract.ReleaseMetadata(
            1, valid.versionName(), valid.versionCode(), valid.packageName(), valid.downloadUrl(), "weak",
            valid.sizeBytes(), valid.signingCertificateSha256()), 26));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(new UpdateContract.ReleaseMetadata(
            1, valid.versionName(), valid.versionCode(), valid.packageName(), valid.downloadUrl(), valid.sha256(),
            0, valid.signingCertificateSha256()), 26));
        assertThrows(IllegalArgumentException.class, () -> UpdateContract.validate(new UpdateContract.ReleaseMetadata(
            1, valid.versionName(), valid.versionCode(), valid.packageName(), valid.downloadUrl(), valid.sha256(),
            valid.sizeBytes(), "b".repeat(64)), 26));
    }

    @Test
    public void repeatedClickCannotStartSecondDownload() {
        UpdateContract.SingleFlightGate gate = new UpdateContract.SingleFlightGate();
        assertTrue(gate.begin());
        assertFalse(gate.begin());
        assertTrue(gate.isRunning());
        gate.end();
        assertTrue(gate.begin());
    }
}
