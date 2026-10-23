# MailBox APK Request Contract

This repository contains a disabled-by-default, one-shot request receiver. It
validates a fixed JSON contract, claims one local worker lock, and persists a
receipt/status pair. It does not execute shell text, build Android, publish an
APK, run in the background, or treat request text as authorization.

Run the Site 26 request once:

```powershell
npm run dispatch:dry-run
```

The request key is `project + source SHA + version name + version code`. An
identical replay returns `duplicate`; a changed payload using the same key
returns `conflict`; an active original claim returns `busy`. Stale locks are
moved into `.apk-dispatch-state/recovery/` before processing resumes. Receipts
and current status are written atomically under `.apk-dispatch-state/` and are
ignored by Git.

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

Codex's formal heartbeat or project automation can be used for a future fixed
trigger after explicit schedule and executor approval. It should invoke this
one-shot contract, not install a custom daemon. No automation is created here.
