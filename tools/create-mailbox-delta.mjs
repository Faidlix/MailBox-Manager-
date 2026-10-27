import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('MBXDIFF1', 'ascii');
const BASE = 257;

function rollingPower(length) {
  let value = 1;
  for (let index = 1; index < length; index += 1) value = Math.imul(value, BASE) >>> 0;
  return value;
}

function windowHash(buffer, start, length) {
  let hash = 0;
  for (let index = 0; index < length; index += 1) hash = (Math.imul(hash, BASE) + buffer[start + index] + 1) >>> 0;
  return hash;
}

function sameWindow(left, leftOffset, right, rightOffset, length) {
  return left.subarray(leftOffset, leftOffset + length).equals(right.subarray(rightOffset, rightOffset + length));
}

export function createDelta(oldFile, newFile, { windowSize = 8192, stride = 4096 } = {}) {
  if (!Buffer.isBuffer(oldFile) || !Buffer.isBuffer(newFile)) throw new TypeError('oldFile and newFile must be Buffer values');
  if (!Number.isSafeInteger(windowSize) || windowSize < 256 || !Number.isSafeInteger(stride) || stride < 1) {
    throw new RangeError('invalid delta window settings');
  }
  const commands = [];
  if (oldFile.length >= windowSize && newFile.length >= windowSize) {
    const oldWindows = new Map();
    for (let offset = 0; offset + windowSize <= oldFile.length; offset += stride) {
      const hash = windowHash(oldFile, offset, windowSize);
      const offsets = oldWindows.get(hash) || [];
      offsets.push(offset);
      oldWindows.set(hash, offsets);
    }
    const power = rollingPower(windowSize);
    let position = 0;
    let literalStart = 0;
    let hash = windowHash(newFile, 0, windowSize);
    while (position + windowSize <= newFile.length) {
      const candidates = oldWindows.get(hash) || [];
      let matchOffset = -1;
      for (const candidate of candidates) {
        if (sameWindow(oldFile, candidate, newFile, position, windowSize)) { matchOffset = candidate; break; }
      }
      if (matchOffset >= 0) {
        if (position > literalStart) commands.push({ type: 'literal', data: newFile.subarray(literalStart, position) });
        let length = windowSize;
        while (matchOffset + length < oldFile.length && position + length < newFile.length
          && oldFile[matchOffset + length] === newFile[position + length]) length += 1;
        commands.push({ type: 'copy', offset: matchOffset, length });
        position += length;
        literalStart = position;
        if (position + windowSize <= newFile.length) hash = windowHash(newFile, position, windowSize);
        continue;
      }
      if (position + windowSize >= newFile.length) break;
      const outgoing = newFile[position] + 1;
      const incoming = newFile[position + windowSize] + 1;
      hash = (Math.imul((hash - Math.imul(outgoing, power)) >>> 0, BASE) + incoming) >>> 0;
      position += 1;
    }
    if (literalStart < newFile.length) commands.push({ type: 'literal', data: newFile.subarray(literalStart) });
  } else if (newFile.length) {
    commands.push({ type: 'literal', data: newFile });
  }
  if (!commands.length) commands.push({ type: 'literal', data: Buffer.alloc(0) });

  const parts = [];
  const header = Buffer.alloc(20);
  MAGIC.copy(header, 0);
  header.writeBigUInt64BE(BigInt(newFile.length), 8);
  header.writeUInt32BE(commands.length, 16);
  parts.push(header);
  for (const command of commands) {
    if (command.type === 'copy') {
      const entry = Buffer.alloc(13);
      entry.writeUInt8(0, 0);
      entry.writeBigUInt64BE(BigInt(command.offset), 1);
      entry.writeUInt32BE(command.length, 9);
      parts.push(entry);
    } else {
      const entry = Buffer.alloc(5);
      entry.writeUInt8(1, 0);
      entry.writeUInt32BE(command.data.length, 1);
      parts.push(entry, command.data);
    }
  }
  return Buffer.concat(parts);
}

export function applyDeltaForTest(oldFile, patch) {
  if (!patch.subarray(0, 8).equals(MAGIC)) throw new Error('invalid magic');
  const targetSize = Number(patch.readBigUInt64BE(8));
  const commandCount = patch.readUInt32BE(16);
  const output = [];
  let offset = 20;
  for (let index = 0; index < commandCount; index += 1) {
    const type = patch.readUInt8(offset); offset += 1;
    if (type === 0) {
      const sourceOffset = Number(patch.readBigUInt64BE(offset)); offset += 8;
      const length = patch.readUInt32BE(offset); offset += 4;
      output.push(oldFile.subarray(sourceOffset, sourceOffset + length));
    } else if (type === 1) {
      const length = patch.readUInt32BE(offset); offset += 4;
      output.push(patch.subarray(offset, offset + length)); offset += length;
    } else throw new Error('unsupported command');
  }
  const result = Buffer.concat(output);
  if (result.length !== targetSize || offset !== patch.length) throw new Error('invalid patch length');
  return result;
}

async function main() {
  const [oldPath, newPath, outputPath] = process.argv.slice(2);
  if (!oldPath || !newPath || !outputPath) throw new Error('usage: create-mailbox-delta <old.apk> <new.apk> <output.mbd>');
  const [oldFile, newFile] = await Promise.all([readFile(oldPath), readFile(newPath)]);
  const patch = createDelta(oldFile, newFile);
  await writeFile(outputPath, patch);
  process.stdout.write(JSON.stringify({ oldBytes: oldFile.length, newBytes: newFile.length, patchBytes: patch.length,
    savingsPercent: Number((100 - (patch.length / newFile.length * 100)).toFixed(2)) }) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
