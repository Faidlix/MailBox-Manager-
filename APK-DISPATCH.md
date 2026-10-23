# MailBox APK Request Contract

This repository contains a disabled-by-default, local one-shot request receiver. It
validates a fixed JSON contract, claims one local worker lock, and persists a
receipt/status pair. It does not execute shell text, build Android, publish an
APK, run in the background, or treat request text as authorization.

This is not a continuous cloud trigger and does not guarantee automatic reports
to another conversation. A human or separately approved formal trigger must run
the CLI and deliver the receipt to the configured report thread.

Run the Site 26 request once:

```powershell
npm run dispatch:dry-run
```

The npm command uses `tools/mailbox-apk-request-v2.mjs`. The original v1 module
throws before exposing its former API and is retained only as disabled history.

The request key is `project + source SHA + version name + version code`. An
identical replay returns `duplicate`; a changed payload using the same key
returns `conflict`. One project-wide worker lock blocks every other SHA/version
for that project. Lock age never permits recovery: recovery is allowed only when
the owner is on this host and its PID is explicitly reported missing (`ESRCH`).
Unknown, inaccessible, malformed, or remote ownership fails closed. Recovery
uses a separate exclusive mutex, then re-reads and re-validates the original
owner before moving the lock. Ownership tokens prevent one claimant from
releasing another claimant's lock.

An atomic project version registry rejects any different request or source SHA
trying to reuse either an existing version name or an existing version code.
Receipts, status, registry entries, and recovered locks are written under
`.apk-dispatch-state/v3/` and ignored by Git. The production CLI cannot override
the repository config or state path;
test-only injection is available through the imported module API.

`config/mailbox-apk-dispatch.json` fixes the accepted project, Sites project,
source thread, report thread, and signing certificate. The destination allowlist
is deliberately empty because no APK publication destination has been approved.
Every `publish-request` is therefore blocked, and build verification would also
need to complete successfully before any future publisher may proceed.
The machine-readable request shape is `config/mailbox-apk-request.schema.json`.

## Future Fixed Trigger Approvals

Before enabling a formal trigger, record all of the following outside the
request payload:

1. The exact local executor and repository path allowed to claim requests.
2. The exact source thread and report thread, plus the approved APK destination.
3. Least-privilege credentials limited to reading that source and writing only
   that destination; Android signing material remains local and non-exportable.
4. A reconnect policy that queues one idempotency key while offline and resumes
   from the receipt/status files without silently retrying publication.
5. Accepted risks and explicit publication approval, including rollback and
   who can revoke the trigger.

Codex's formal heartbeat or project automation may provide a future trigger only
after explicit schedule, executor, routing, and credential approval. Its actual
ability to reach this local repository and report back must be proven in a
separate end-to-end test. It should invoke this one-shot contract, not install a
custom daemon. No trigger, automation, or report guarantee is created here.
