// Validates one MailBox APK dispatch request and writes an idempotent local receipt.
// Usage: node tools/mailbox-apk-request-v2.mjs --request <json> --dry-run.
// Configuration and state are fixed inside this repository; this tool never builds or publishes.

import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'mailbox-apk-dispatch.json');
const STATE_DIRECTORY = path.join(ROOT, '.apk-dispatch-state', 'v3');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MODES = new Set(['build-verify', 'publish-request']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameEndpoint(actual, allowed, includeChannel = false) {
  return allowed.some((item) => item.threadId === actual?.threadId && item.hostId === actual?.hostId && (!includeChannel || item.channel === actual?.channel));
}

function validateRequest(request, config) {
  const errors = [];
  const requiredString = (value, field) => {
    if (typeof value !== 'string' || value.length === 0) errors.push(`${field} must be a non-empty string`);
  };
  if (request?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  requiredString(request?.project, 'project');
  requiredString(request?.site?.projectId, 'site.projectId');
  requiredString(request?.site?.sourceSha, 'site.sourceSha');
  if (!SHA40.test(request?.site?.sourceSha ?? '')) errors.push('site.sourceSha must be an exact lowercase 40-character Git SHA');
  if (!Number.isInteger(request?.site?.version) || request.site.version < 1) errors.push('site.version must be a positive integer');
  requiredString(request?.android?.versionName, 'android.versionName');
  if (!Number.isInteger(request?.android?.versionCode) || request.android.versionCode < 1) errors.push('android.versionCode must be a positive integer');
  if (!SHA256.test(request?.android?.signingCertificateSha256 ?? '')) errors.push('android.signingCertificateSha256 must be a lowercase SHA-256');
  if (!MODES.has(request?.mode)) errors.push('mode must be build-verify or publish-request');
  requiredString(request?.approval?.evidenceRef, 'approval.evidenceRef');
  requiredString(request?.source?.channel, 'source.channel');
  requiredString(request?.source?.threadId, 'source.threadId');
  requiredString(request?.source?.hostId, 'source.hostId');
  requiredString(request?.report?.threadId, 'report.threadId');
  requiredString(request?.report?.hostId, 'report.hostId');
  if (!config.projects.includes(request?.project)) errors.push('project is not allowlisted');
  if (!config.siteProjectIds.includes(request?.site?.projectId)) errors.push('site.projectId is not allowlisted');
  if (!config.signingCertificateSha256.includes(request?.android?.signingCertificateSha256)) errors.push('signing certificate is not allowlisted');
  if (!sameEndpoint(request?.source, config.sourceChannels, true)) errors.push('source channel is not allowlisted');
  if (!sameEndpoint(request?.report, config.reportThreads)) errors.push('report thread is not allowlisted');
  return errors;
}

function inspectLocalProcess(pid) {
  if (!Number.isInteger(pid) || pid < 1) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return error?.code === 'ESRCH' ? 'dead' : 'unknown';
  }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, filePath);
}

function readJson(filePath) {
  try { return { ok: true, value: JSON.parse(readFileSync(filePath, 'utf8')) }; }
  catch (error) { return { ok: false, error }; }
}

export function requestIdentity(request) {
  const raw = `${request.project}+${request.site.sourceSha}+${request.android.versionName}+${request.android.versionCode}`;
  return { raw, id: hash(raw) };
}

export function statePaths(stateDirectory, request) {
  const identity = requestIdentity(request);
  const projectId = hash(request.project);
  const versionKey = `${request.project}+${request.android.versionName}+${request.android.versionCode}`;
  return {
    identity,
    versionKey,
    workerLock: path.join(stateDirectory, 'worker-locks', `${projectId}.lock.json`),
    receipt: path.join(stateDirectory, 'receipts', `${identity.id}.json`),
    status: path.join(stateDirectory, 'status', `${identity.id}.json`),
    recoveryMutex: path.join(stateDirectory, 'recovery-mutexes', `${projectId}.lock.json`),
    versionRegistry: path.join(stateDirectory, 'version-registries', `${projectId}.json`),
    recovery: path.join(stateDirectory, 'recovery'),
  };
}

function lockRecordIsKnown(record) {
  return record?.schemaVersion === 1 && typeof record?.project === 'string' && typeof record?.requestKey === 'string' &&
    typeof record?.owner?.host === 'string' && Number.isInteger(record?.owner?.pid) && record.owner.pid > 0 &&
    typeof record?.owner?.token === 'string' && /^[A-Za-z0-9-]{1,128}$/.test(record.owner.token) && typeof record?.claimedAt === 'string';
}

function createWorkerLock(lockPath, record) {
  const descriptor = openSync(lockPath, 'wx');
  try { writeFileSync(descriptor, `${JSON.stringify(record, null, 2)}\n`); }
  finally { closeSync(descriptor); }
}

function sameOwner(left, right) {
  return left?.host === right?.host && left?.pid === right?.pid && left?.token === right?.token;
}

function releaseOwnedLock(lockPath, owner) {
  const parsed = readJson(lockPath);
  if (!parsed.ok || !sameOwner(parsed.value?.owner, owner)) return false;
  rmSync(lockPath);
  return true;
}

function claimWorker(paths, request, runtime) {
  mkdirSync(path.dirname(paths.workerLock), { recursive: true });
  const owner = { host: runtime.hostname(), pid: runtime.pid, token: runtime.randomUUID() };
  const claimRecord = { schemaVersion: 1, project: request.project, requestKey: paths.identity.raw, owner, claimedAt: new Date().toISOString() };
  try {
    createWorkerLock(paths.workerLock, claimRecord);
    return { claimed: true, owner, recovered: null };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const parsed = readJson(paths.workerLock);
  if (!parsed.ok || !lockRecordIsKnown(parsed.value)) return { claimed: false, reason: 'lock-unknown' };
  const existing = parsed.value;
  if (existing.project !== request.project) return { claimed: false, reason: 'lock-project-mismatch' };
  if (existing.owner.host !== owner.host) return { claimed: false, reason: 'lock-owned-by-other-host' };
  const processState = runtime.inspectProcess(existing.owner.pid);
  if (processState === 'alive') return { claimed: false, reason: 'lock-owner-alive' };
  if (processState !== 'dead') return { claimed: false, reason: 'lock-owner-unknown' };

  mkdirSync(path.dirname(paths.recoveryMutex), { recursive: true });
  const recoveryOwner = { host: owner.host, pid: owner.pid, token: runtime.randomUUID() };
  const recoveryRecord = { schemaVersion: 1, project: request.project, owner: recoveryOwner, startedAt: new Date().toISOString() };
  try {
    createWorkerLock(paths.recoveryMutex, recoveryRecord);
  } catch (error) {
    if (error?.code === 'EEXIST') return { claimed: false, reason: 'lock-recovery-busy' };
    throw error;
  }

  try {
    runtime.afterRecoveryMutex?.(paths, existing);
    const current = readJson(paths.workerLock);
    if (!current.ok || !lockRecordIsKnown(current.value)) return { claimed: false, reason: 'lock-unknown-after-recovery-mutex' };
    if (current.value.project !== existing.project || !sameOwner(current.value.owner, existing.owner)) {
      return { claimed: false, reason: 'lock-changed-during-recovery' };
    }
    if (current.value.owner.host !== owner.host) return { claimed: false, reason: 'lock-owned-by-other-host' };
    const confirmedState = runtime.inspectProcess(current.value.owner.pid);
    if (confirmedState === 'alive') return { claimed: false, reason: 'lock-owner-alive-after-recovery-mutex' };
    if (confirmedState !== 'dead') return { claimed: false, reason: 'lock-owner-unknown-after-recovery-mutex' };

    mkdirSync(paths.recovery, { recursive: true });
    const recovered = path.join(paths.recovery, `${hash(request.project)}.${existing.owner.token}.${Date.now()}.lock.json`);
    try {
      renameSync(paths.workerLock, recovered);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EEXIST') return { claimed: false, reason: 'lock-recovery-race' };
      throw error;
    }
    try {
      createWorkerLock(paths.workerLock, claimRecord);
    } catch (error) {
      if (error?.code === 'EEXIST') return { claimed: false, reason: 'lock-claim-race-lost', recovered };
      throw error;
    }
    return { claimed: true, owner, recovered };
  } finally {
    releaseOwnedLock(paths.recoveryMutex, recoveryOwner);
  }
}

function releaseWorker(paths, owner) {
  return releaseOwnedLock(paths.workerLock, owner);
}

function reserveVersion(paths, request) {
  const entry = {
    versionName: request.android.versionName,
    versionCode: request.android.versionCode,
    sourceSha: request.site.sourceSha,
    requestId: paths.identity.id,
    reservedAt: new Date().toISOString(),
  };
  let registry = { schemaVersion: 1, project: request.project, entries: [] };
  if (existsSync(paths.versionRegistry)) {
    const parsed = readJson(paths.versionRegistry);
    const validEntry = (item) => typeof item?.versionName === 'string' && item.versionName.length > 0 &&
      Number.isInteger(item?.versionCode) && item.versionCode > 0 && SHA40.test(item?.sourceSha ?? '') &&
      typeof item?.requestId === 'string' && item.requestId.length > 0 && typeof item?.reservedAt === 'string';
    const valid = parsed.ok && parsed.value?.schemaVersion === 1 && parsed.value?.project === request.project &&
      Array.isArray(parsed.value?.entries) && parsed.value.entries.every(validEntry);
    if (!valid) return { reserved: false, reason: 'version-registry-unknown' };
    registry = parsed.value;
  }

  const byName = registry.entries.find((item) => item.versionName === entry.versionName);
  const byCode = registry.entries.find((item) => item.versionCode === entry.versionCode);
  const exact = byName && byCode && byName === byCode && byName.requestId === entry.requestId && byName.sourceSha === entry.sourceSha;
  if (exact) return { reserved: true, created: false, reservation: byName };
  if (byName) return { reserved: false, reason: 'version-name-conflict', reservation: byName };
  if (byCode) return { reserved: false, reason: 'version-code-conflict', reservation: byCode };

  registry.entries.push(entry);
  writeJsonAtomic(paths.versionRegistry, registry);
  return { reserved: true, created: true, reservation: entry };
}

export function processDispatchRequest(request, options = {}) {
  // Config, state, and runtime injection exist only for isolated module tests. The CLI never forwards them.
  const config = options.config ?? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const stateDirectory = path.resolve(options.stateDirectory ?? STATE_DIRECTORY);
  const runtime = {
    hostname: options.runtime?.hostname ?? hostname,
    pid: options.runtime?.pid ?? process.pid,
    randomUUID: options.runtime?.randomUUID ?? randomUUID,
    inspectProcess: options.runtime?.inspectProcess ?? inspectLocalProcess,
    afterRecoveryMutex: options.runtime?.afterRecoveryMutex,
  };
  const errors = validateRequest(request, config);
  if (errors.length > 0) return { outcome: 'rejected', errors };
  const paths = statePaths(stateDirectory, request);
  const fingerprint = hash(canonical(request));
  if (existsSync(paths.receipt)) {
    const receipt = readJson(paths.receipt);
    if (!receipt.ok) return { outcome: 'rejected', reason: 'receipt-unknown', receiptPath: paths.receipt };
    return receipt.value.requestFingerprint === fingerprint
      ? { outcome: 'duplicate', requestKey: paths.identity.raw, receiptPath: paths.receipt }
      : { outcome: 'conflict', requestKey: paths.identity.raw, receiptPath: paths.receipt };
  }

  const lock = claimWorker(paths, request, runtime);
  if (!lock.claimed) return { outcome: 'busy', reason: lock.reason, requestKey: paths.identity.raw, lockPath: paths.workerLock };
  try {
    if (existsSync(paths.receipt)) {
      const receipt = readJson(paths.receipt);
      if (!receipt.ok) return { outcome: 'rejected', reason: 'receipt-unknown', receiptPath: paths.receipt };
      return receipt.value.requestFingerprint === fingerprint
        ? { outcome: 'duplicate', requestKey: paths.identity.raw, receiptPath: paths.receipt }
        : { outcome: 'conflict', requestKey: paths.identity.raw, receiptPath: paths.receipt };
    }
    const version = reserveVersion(paths, request);
    if (!version.reserved) return { outcome: 'version-conflict', reason: version.reason, requestKey: paths.identity.raw, registryPath: paths.versionRegistry, reservedSourceSha: version.reservation?.sourceSha };

    const blockedReasons = [];
    if (request.mode === 'publish-request') {
      blockedReasons.push('approval evidence is a reference, not trusted runtime authorization');
      if (!request.destination) blockedReasons.push('publish destination is unknown');
      else if (!config.publishDestinations.includes(request.destination)) blockedReasons.push('publish destination is not allowlisted');
      blockedReasons.push('artifact build and verification have not run in this dry-run');
    }
    const outcome = blockedReasons.length > 0 ? 'blocked' : 'accepted';
    const now = new Date().toISOString();
    const receipt = {
      schemaVersion: 3,
      outcome,
      requestKey: paths.identity.raw,
      requestId: paths.identity.id,
      requestFingerprint: fingerprint,
      receivedAt: now,
      dryRun: true,
      autoTriggerEnabled: false,
      mode: request.mode,
      sourceSha: request.site.sourceSha,
      versionName: request.android.versionName,
      versionCode: request.android.versionCode,
      versionRegistryPath: paths.versionRegistry,
      approvalEvidenceRef: request.approval.evidenceRef,
      approvalTrusted: false,
      destination: request.destination,
      blockedReasons,
      recoveredLockPath: lock.recovered,
      workerClaimToken: lock.owner.token,
      nextAction: outcome === 'accepted' ? 'manual-worker-action-required' : 'resolve-blocked-gates',
      report: request.report,
    };
    writeJsonAtomic(paths.receipt, receipt);
    writeJsonAtomic(paths.status, { ...receipt, receiptPath: paths.receipt, updatedAt: now });
    return { outcome, requestKey: paths.identity.raw, receiptPath: paths.receipt, statusPath: paths.status, blockedReasons };
  } finally {
    releaseWorker(paths, lock.owner);
  }
}

function parseArguments(argv) {
  const result = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') result.dryRun = true;
    else if (argument === '--request') result.requestPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!result.requestPath) throw new Error('--request is required');
  if (!result.dryRun) throw new Error('--dry-run is required because automatic execution is disabled');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const request = JSON.parse(readFileSync(path.resolve(options.requestPath), 'utf8'));
    const result = processDispatchRequest(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (['rejected', 'conflict', 'version-conflict', 'busy'].includes(result.outcome)) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
