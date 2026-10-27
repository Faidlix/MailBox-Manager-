import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelta, applyDeltaForTest } from '../tools/create-mailbox-delta.mjs';

test('delta generator reconstructs shifted and changed APK-like content', () => {
  const prefix = Buffer.alloc(40_000, 0x41);
  const shared = Buffer.alloc(180_000);
  for (let index = 0; index < shared.length; index += 1) shared[index] = index % 251;
  const oldFile = Buffer.concat([prefix, Buffer.from('old-entry'), shared, Buffer.alloc(40_000, 0x5a)]);
  const newFile = Buffer.concat([prefix, Buffer.from('a-longer-new-entry-that-shifts-data'), shared, Buffer.alloc(40_000, 0x5a)]);
  const patch = createDelta(oldFile, newFile, { windowSize: 2048, stride: 1024 });
  assert.deepEqual(applyDeltaForTest(oldFile, patch), newFile);
  assert.ok(patch.length < newFile.length / 3, `expected useful patch, got ${patch.length}/${newFile.length}`);
});

test('delta generator supports a completely new small file', () => {
  const newFile = Buffer.from('new package bytes');
  const patch = createDelta(Buffer.from('old'), newFile);
  assert.deepEqual(applyDeltaForTest(Buffer.from('old'), patch), newFile);
});
