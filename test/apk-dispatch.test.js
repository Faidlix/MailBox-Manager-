// Verifies the one-shot APK request contract, idempotency, locking, and publish gates.
// Usage: npm test. No network, Android build, or publication is performed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processDispatchRequest, statePaths } from '../tools/mailbox-apk-request.mjs';

const config = {
  schemaVersion: 1,
  enabled: false,
  projects: ['MailBox-Manager'],
  siteProjectIds: ['site-26'],
  sourceChannels: [{ channel: 'codex-thread', threadId: 'cloud-thread', hostId: 'durable' }],
  reportThreads: [{ threadId: 'cloud-thread', hostId: 'durable' }],
  signingCertificateSha256: ['a'.repeat(64)],
  publishDestinations: [],
  lockStaleAfterMs: 900000,
};

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    project: 'MailBox-Manager',
    site: { projectId: 'site-26', sourceSha: 'b'.repeat(40), version: 26 },
    android: { versionName: '0.1.26', versionCode: 26, signingCertificateSha256: 'a'.repeat(64) },
    mode: 'build-verify',
    approval: { evidenceRef: 'thread:message' },
    source: { channel: 'codex-thread', threadId: 'cloud-thread', hostId: 'durable' },
    report: { threadId: 'cloud-thread', hostId: 'durable' },
    destination: null,
    ...overrides,
  };
}

function withState(callback) {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), 'mailbox-dispatch-'));
  try { callback(stateDirectory); } finally { rmSync(stateDirectory, { recursive: true, force: true }); }
}

test('accepts once and returns duplicate for the identical request', () => withState((stateDirectory) => {
  const payload = request();
  const first = processDispatchRequest(payload, { config, stateDirectory });
  const second = processDispatchRequest(payload, { config, stateDirectory });
  assert.equal(first.outcome, 'accepted');
  assert.equal(second.outcome, 'duplicate');
  const receipt = JSON.parse(readFileSync(first.receiptPath, 'utf8'));
  assert.equal(receipt.approvalTrusted, false);
  assert.deepEqual(receipt.report, { threadId: 'cloud-thread', hostId: 'durable' });
}));

test('rejects a different payload with the same idempotency key as conflict', () => withState((stateDirectory) => {
  const first = request();
  assert.equal(processDispatchRequest(first, { config, stateDirectory }).outcome, 'accepted');
  const changed = request({ approval: { evidenceRef: 'different-message' } });
  assert.equal(processDispatchRequest(changed, { config, stateDirectory }).outcome, 'conflict');
}));

test('rejects a concurrent claim while the original worker lock is alive', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  mkdirSync(path.dirname(paths.lock), { recursive: true });
  writeFileSync(paths.lock, JSON.stringify({ pid: process.pid, claimedAt: new Date().toISOString(), requestKey: paths.identity.raw }));
  assert.equal(processDispatchRequest(payload, { config, stateDirectory }).outcome, 'busy');
}));

test('recovers an interrupted stale claim and records the recovery path', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  mkdirSync(path.dirname(paths.lock), { recursive: true });
  writeFileSync(paths.lock, JSON.stringify({ pid: 99999999, claimedAt: '2000-01-01T00:00:00.000Z', requestKey: paths.identity.raw }));
  const result = processDispatchRequest(payload, { config, stateDirectory });
  const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
  assert.equal(result.outcome, 'accepted');
  assert.match(receipt.recoveredLockPath, /recovery/);
}));

test('blocks publish requests without trusted approval and an allowlisted destination', () => withState((stateDirectory) => {
  const result = processDispatchRequest(request({ mode: 'publish-request' }), { config, stateDirectory });
  assert.equal(result.outcome, 'blocked');
  assert.ok(result.blockedReasons.some((reason) => reason.includes('not trusted')));
  assert.ok(result.blockedReasons.some((reason) => reason.includes('unknown')));
}));

test('rejects non-allowlisted source channels before writing a receipt', () => withState((stateDirectory) => {
  const result = processDispatchRequest(request({ source: { channel: 'text', threadId: 'unknown', hostId: 'unknown' } }), { config, stateDirectory });
  assert.equal(result.outcome, 'rejected');
  assert.ok(result.errors.includes('source channel is not allowlisted'));
}));
