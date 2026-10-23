// Validates one MailBox APK dispatch request and writes an idempotent local receipt.
// Usage: node tools/mailbox-apk-request.mjs --request <json> --dry-run [--state-dir <dir>].
// Configuration: config/mailbox-apk-dispatch.json; this tool never builds or publishes.

throw new Error('Legacy receiver disabled; use tools/mailbox-apk-request-v2.mjs');

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MODES = new Set(['build-verify', 'publish-request']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameEndpoint(actual, allowed, includeChannel = false) {
  return allowed.some((item) =>
    item.threadId === actual?.threadId &&
    item.hostId === actual?.hostId &&
    (!includeChannel || item.channel === actual?.channel));
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

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, filePath);
}

export function requestIdentity(request) {
  const raw = `${request.project}+${request.site.sourceSha}+${request.android.versionName}+${request.android.versionCode}`;
  return { raw, id: hash(raw) };
}

export function statePaths(stateDirectory, request) {
  const identity = requestIdentity(request);
  return {
    identity,
    lock: path.join(stateDirectory, 'locks', `${identity.id}.lock.json`),
    receipt: path.join(stateDirectory, 'receipts', `${identity.id}.json`),
    status: path.join(stateDirectory, 'status', `${identity.id}.json`),
    recovery: path.join(stateDirectory, 'recovery'),
  };
}

function claim(paths, config) {
  mkdirSync(path.dirname(paths.lock), { recursive: true });
  const claimRecord = { pid: process.pid, requestKey: paths.identity.raw, claimedAt: new Date().toISOString() };
  try {
    const descriptor = openSync(paths.lock, 'wx');
    writeFileSync(descriptor, `${JSON.stringify(claimRecord, null, 2)}\n`);
    closeSync(descriptor);
    return { claimed: true, recovered: null };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let existing;
  try {
    existing = JSON.parse(readFileSync(paths.lock, 'utf8'));
  } catch {
    existing = {};
  }
  const claimedAt = Date.parse(existing.claimedAt ?? '');
  const staleByAge = !Number.isFinite(claimedAt) || Date.now() - claimedAt > config.lockStaleAfterMs;
  if (processExists(existing.pid) && !staleByAge) return { claimed: false, recovered: null };

  mkdirSync(paths.recovery, { recursive: true });
  const recovered = path.join(paths.recovery, `${paths.identity.id}.${Date.now()}.lock.json`);
  renameSync(paths.lock, recovered);
  const descriptor = openSync(paths.lock, 'wx');
  writeFileSync(descriptor, `${JSON.stringify(claimRecord, null, 2)}\n`);
  closeSync(descriptor);
  return { claimed: true, recovered };
}

export function processDispatchRequest(request, options = {}) {
  const config = options.config ?? JSON.parse(readFileSync(options.configPath ?? path.join(ROOT, 'config', 'mailbox-apk-dispatch.json'), 'utf8'));
  const stateDirectory = path.resolve(options.stateDirectory ?? path.join(ROOT, '.apk-dispatch-state'));
  const errors = validateRequest(request, config);
  if (errors.length > 0) return { outcome: 'rejected', errors };

  const paths = statePaths(stateDirectory, request);
  const fingerprint = hash(canonical(request));
  if (existsSync(paths.receipt)) {
    const receipt = JSON.parse(readFileSync(paths.receipt, 'utf8'));
    return receipt.requestFingerprint === fingerprint
      ? { outcome: 'duplicate', requestKey: paths.identity.raw, receiptPath: paths.receipt }
      : { outcome: 'conflict', requestKey: paths.identity.raw, receiptPath: paths.receipt };
  }

  const lock = claim(paths, config);
  if (!lock.claimed) return { outcome: 'busy', requestKey: paths.identity.raw, lockPath: paths.lock };

  try {
    if (existsSync(paths.receipt)) {
      const receipt = JSON.parse(readFileSync(paths.receipt, 'utf8'));
      return receipt.requestFingerprint === fingerprint
        ? { outcome: 'duplicate', requestKey: paths.identity.raw, receiptPath: paths.receipt }
        : { outcome: 'conflict', requestKey: paths.identity.raw, receiptPath: paths.receipt };
    }

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
      schemaVersion: 1,
      outcome,
      requestKey: paths.identity.raw,
      requestId: paths.identity.id,
      requestFingerprint: fingerprint,
      receivedAt: now,
      dryRun: true,
      autoTriggerEnabled: config.enabled === true,
      mode: request.mode,
      sourceSha: request.site.sourceSha,
      versionName: request.android.versionName,
      versionCode: request.android.versionCode,
      approvalEvidenceRef: request.approval.evidenceRef,
      approvalTrusted: false,
      destination: request.destination,
      blockedReasons,
      recoveredLockPath: lock.recovered,
      nextAction: outcome === 'accepted' ? 'manual-worker-claim-required' : 'resolve-blocked-gates',
      report: request.report,
    };
    writeJsonAtomic(paths.receipt, receipt);
    writeJsonAtomic(paths.status, { ...receipt, receiptPath: paths.receipt, updatedAt: now });
    return { outcome, requestKey: paths.identity.raw, receiptPath: paths.receipt, statusPath: paths.status, blockedReasons };
  } finally {
    rmSync(paths.lock, { force: true });
  }
}

function parseArguments(argv) {
  const result = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') result.dryRun = true;
    else if (argument === '--request') result.requestPath = argv[++index];
    else if (argument === '--state-dir') result.stateDirectory = argv[++index];
    else if (argument === '--config') result.configPath = argv[++index];
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
    const result = processDispatchRequest(request, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (['rejected', 'conflict', 'busy'].includes(result.outcome)) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
