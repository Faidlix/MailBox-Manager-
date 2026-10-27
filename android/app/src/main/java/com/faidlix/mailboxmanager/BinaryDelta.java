package com.faidlix.mailboxmanager;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

final class BinaryDelta {
    private static final byte[] MAGIC = "MBXDIFF1".getBytes(StandardCharsets.US_ASCII);
    private static final int MAX_COMMANDS = 2_000_000;
    private static final int BUFFER_SIZE = 32 * 1024;

    private BinaryDelta() {}

    static void apply(File oldFile, File patchFile, File outputFile, long expectedSize) throws IOException {
        if (expectedSize <= 0 || expectedSize > UpdateContract.MAX_APK_BYTES) throw new IOException("差分目標大小不合理");
        File parent = outputFile.getParentFile();
        if (parent == null || (!parent.exists() && !parent.mkdirs())) throw new IOException("無法建立差分輸出目錄");
        boolean completed = false;
        try (RandomAccessFile old = new RandomAccessFile(oldFile, "r");
             DataInputStream patch = new DataInputStream(new BufferedInputStream(new FileInputStream(patchFile)));
             BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(outputFile))) {
            byte[] magic = new byte[MAGIC.length];
            patch.readFully(magic);
            if (!Arrays.equals(MAGIC, magic)) throw new IOException("差分格式不符");
            long targetSize = patch.readLong();
            int commandCount = patch.readInt();
            if (targetSize != expectedSize || commandCount <= 0 || commandCount > MAX_COMMANDS) {
                throw new IOException("差分標頭不符");
            }
            long written = 0;
            byte[] buffer = new byte[BUFFER_SIZE];
            for (int command = 0; command < commandCount; command++) {
                int type = patch.readUnsignedByte();
                if (type == 0) {
                    long offset = patch.readLong();
                    int length = patch.readInt();
                    if (offset < 0 || length <= 0 || offset > old.length() - length) throw new IOException("差分複製範圍不符");
                    written = checkedTotal(written, length, targetSize);
                    old.seek(offset);
                    copyOld(old, output, buffer, length);
                } else if (type == 1) {
                    int length = patch.readInt();
                    if (length <= 0) throw new IOException("差分資料長度不符");
                    written = checkedTotal(written, length, targetSize);
                    copyLiteral(patch, output, buffer, length);
                } else {
                    throw new IOException("不支援的差分指令");
                }
            }
            if (written != targetSize || patch.read() != -1) throw new IOException("差分輸出大小或尾端資料不符");
            output.flush();
            completed = true;
        } catch (EOFException error) {
            throw new IOException("差分檔案不完整", error);
        } finally {
            if (!completed && outputFile.exists() && !outputFile.delete()) outputFile.deleteOnExit();
        }
    }

    private static long checkedTotal(long current, int length, long limit) throws IOException {
        long next = current + length;
        if (next < current || next > limit) throw new IOException("差分輸出超過目標大小");
        return next;
    }

    private static void copyOld(RandomAccessFile input, BufferedOutputStream output, byte[] buffer, int length) throws IOException {
        int remaining = length;
        while (remaining > 0) {
            int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) throw new EOFException();
            output.write(buffer, 0, read);
            remaining -= read;
        }
    }

    private static void copyLiteral(DataInputStream input, BufferedOutputStream output, byte[] buffer, int length) throws IOException {
        int remaining = length;
        while (remaining > 0) {
            int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
            if (read < 0) throw new EOFException();
            output.write(buffer, 0, read);
            remaining -= read;
        }
    }
}
