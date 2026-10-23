// Verifies the one-shot APK request contract, idempotency, locking, and publish gates.
// Usage: npm test. No network, Android build, or publication is performed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hostname } from 'node:os';
import { processDispatchRequest, statePaths } from '../tools/mailbox-apk-request-v2.mjs';

const config = {
  schemaVersion: 1,
  enabled: false,
  projects: ['MailBox-Manager'],
  siteProjectIds: ['site-26'],
  sourceChannels: [{ channel: 'codex-thread', threadId: 'cloud-thread', hostId: 'durable' }],
  reportThreads: [{ threadId: 'cloud-thread', hostId: 'durable' }],
  signingCertificateSha256: ['a'.repeat(64)],
  publishDestinations: [],
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
  mkdirSync(path.dirname(paths.workerLock), { recursive: true });
  writeFileSync(paths.workerLock, JSON.stringify({ schemaVersion: 1, project: payload.project, owner: { host: hostname(), pid: process.pid, token: 'alive-token' }, claimedAt: new Date().toISOString(), requestKey: paths.identity.raw }));
  assert.equal(processDispatchRequest(payload, { config, stateDirectory }).outcome, 'busy');
}));

test('recovers a same-host claim only when its PID is proven missing', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  mkdirSync(path.dirname(paths.workerLock), { recursive: true });
  writeFileSync(paths.workerLock, JSON.stringify({ schemaVersion: 1, project: payload.project, owner: { host: hostname(), pid: 99999999, token: 'dead-token' }, claimedAt: '2000-01-01T00:00:00.000Z', requestKey: paths.identity.raw }));
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

function writeV2WorkerLock(paths, overrides = {}) {
  mkdirSync(path.dirname(paths.workerLock), { recursive: true });
  writeFileSync(paths.workerLock, JSON.stringify({
    schemaVersion: 1,
    project: 'MailBox-Manager',
    requestKey: 'existing-request',
    owner: { host: 'test-host', pid: 777, token: 'existing-owner-token' },
    claimedAt: new Date().toISOString(),
    ...overrides,
  }));
}

function v2Options(stateDirectory, inspectProcess) {
  return {
    config,
    stateDirectory,
    runtime: {
      hostname: () => 'test-host',
      pid: 1234,
      randomUUID: () => 'new-owner-token',
      inspectProcess,
    },
  };
}

test('project worker lock blocks a different request concurrently', () => withState((stateDirectory) => {
  const original = request();
  const paths = statePaths(stateDirectory, original);
  writeV2WorkerLock(paths);
  const different = request({
    site: { ...original.site, sourceSha: 'c'.repeat(40), version: 27 },
    android: { ...original.android, versionName: '0.1.27', versionCode: 27 },
  });
  const differentPaths = statePaths(stateDirectory, different);
  const result = processDispatchRequest(different, v2Options(stateDirectory, () => 'alive'));
  assert.equal(differentPaths.workerLock, paths.workerLock);
  assert.equal(result.outcome, 'busy');
  assert.equal(result.reason, 'lock-owner-alive');
}));

test('old same-host lock is not recovered while its owner is alive', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  writeV2WorkerLock(paths, { claimedAt: '2000-01-01T00:00:00.000Z' });
  const result = processDispatchRequest(payload, v2Options(stateDirectory, () => 'alive'));
  assert.equal(result.outcome, 'busy');
  assert.equal(result.reason, 'lock-owner-alive');
  assert.equal(JSON.parse(readFileSync(paths.workerLock, 'utf8')).owner.token, 'existing-owner-token');
}));

test('unknown process state and malformed locks fail closed', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  writeV2WorkerLock(paths);
  const unknownOwner = processDispatchRequest(payload, v2Options(stateDirectory, () => 'unknown'));
  assert.equal(unknownOwner.outcome, 'busy');
  assert.equal(unknownOwner.reason, 'lock-owner-unknown');
  rmSync(paths.workerLock);
  writeFileSync(paths.workerLock, '{not-json');
  const malformed = processDispatchRequest(payload, v2Options(stateDirectory, () => 'dead'));
  assert.equal(malformed.outcome, 'busy');
  assert.equal(malformed.reason, 'lock-unknown');
}));

test('remote lock is never recovered even when its PID appears dead', () => withState((stateDirectory) => {
  const payload = request();
  const paths = statePaths(stateDirectory, payload);
  writeV2WorkerLock(paths, { owner: { host: 'remote-host', pid: 777, token: 'remote-token' } });
  const result = processDispatchRequest(payload, v2Options(stateDirectory, () => 'dead'));
  assert.equal(result.outcome, 'busy');
  assert.equal(result.reason, 'lock-owned-by-other-host');
}));

test('version reservation rejects another SHA reusing version name and code', () => withState((stateDirectory) => {
  const original = request();
  assert.equal(processDispatchRequest(original, v2Options(stateDirectory, () => 'alive')).outcome, 'accepted');
  const changedSha = request({ site: { ...original.site, sourceSha: 'c'.repeat(40) } });
  const result = processDispatchRequest(changedSha, v2Options(stateDirectory, () => 'alive'));
  assert.equal(result.outcome, 'version-conflict');
  assert.equal(result.reason, 'version-source-conflict');
  assert.equal(result.reservedSourceSha, 'b'.repeat(40));
}));
