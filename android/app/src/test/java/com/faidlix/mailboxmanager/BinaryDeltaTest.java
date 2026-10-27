package com.faidlix.mailboxmanager;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BinaryDeltaTest {
    @Rule public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void rebuildsTargetFromCopyAndLiteralCommands() throws Exception {
        File oldFile = temporaryFolder.newFile("old.apk");
        File patchFile = temporaryFolder.newFile("update.mbd");
        File outputFile = new File(temporaryFolder.getRoot(), "new.apk");
        Files.write(oldFile.toPath(), "ABCDEFGHIJ".getBytes());
        Files.write(patchFile.toPath(), patch(11, out -> {
            out.writeByte(0); out.writeLong(2); out.writeInt(4);
            out.writeByte(1); out.writeInt(3); out.write("xyz".getBytes());
            out.writeByte(0); out.writeLong(6); out.writeInt(4);
        }, 3));
        BinaryDelta.apply(oldFile, patchFile, outputFile, 11);
        assertArrayEquals("CDEFxyzGHIJ".getBytes(), Files.readAllBytes(outputFile.toPath()));
    }

    @Test
    public void rejectsOutOfRangeAndTrailingDataAndRemovesOutput() throws Exception {
        File oldFile = temporaryFolder.newFile("old-invalid.apk");
        Files.write(oldFile.toPath(), "old".getBytes());
        File patchFile = temporaryFolder.newFile("invalid.mbd");
        Files.write(patchFile.toPath(), patch(4, out -> {
            out.writeByte(0); out.writeLong(2); out.writeInt(4);
        }, 1));
        File output = new File(temporaryFolder.getRoot(), "invalid-output.apk");
        assertThrows(IOException.class, () -> BinaryDelta.apply(oldFile, patchFile, output, 4));
        assertFalse(output.exists());

        Files.write(patchFile.toPath(), patch(3, out -> {
            out.writeByte(1); out.writeInt(3); out.write("new".getBytes()); out.writeByte(9);
        }, 1));
        assertThrows(IOException.class, () -> BinaryDelta.apply(oldFile, patchFile, output, 3));
        assertFalse(output.exists());
    }

    private static byte[] patch(long targetSize, Writer writer, int commands) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream output = new DataOutputStream(bytes)) {
            output.write("MBXDIFF1".getBytes());
            output.writeLong(targetSize);
            output.writeInt(commands);
            writer.write(output);
        }
        return bytes.toByteArray();
    }

    @FunctionalInterface private interface Writer { void write(DataOutputStream output) throws Exception; }
}
