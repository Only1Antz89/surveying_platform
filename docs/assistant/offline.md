# Offline capture and sync (A1)

## What works offline

- **Opening a survey that this device has already opened.** The survey page shell (which holds no survey content) is cached by `/sw.js`. Survey content (the "pack") lives in IndexedDB.
- **Recording on site.** Edits to element inspection status, field values (including the explicit states unknown, not inspected, inaccessible and not applicable), new observations, measurements, client statements and photos are written to the device first. They then sync in order when the connection returns.
- **Restarts and lost connections.** The outbox lives in IndexedDB, so closing the browser, a crash or a dropped connection mid-sync never loses queued work (browser-tested: offline edit → offline reload → recovery → sync).

AI features are not involved. No model provider is configured, and cloud AI work would queue rather than block manual capture.

## Sync semantics

| Guarantee | Mechanism |
|---|---|
| No duplicate writes on retry | Every operation has a client-generated `operationId`. The server records applied operations in `sync_operations` and answers replays with `duplicate` plus the original record. Media uploads are idempotent by `clientGeneratedId`. |
| No silent overwrite | `set_field` carries the value id the user edited from (`baseValueId`). `set_element`, `revise_observation` and `withdraw_observation` carry versions. A mismatch returns `conflict` with the current server value. The UI then offers **Keep mine** (resubmit against the current base) or **Use current**. |
| Partial success | Each operation commits in its own transaction, so one conflict or rejection never discards unrelated work. |
| Full history | Field values are append-only (`survey_field_values`, trigger-enforced). A change supersedes the prior row, which is kept with author, time and optional correction reason. Revised observations supersede the old row, and their evidence links move to the new version. |
| Template pinning | Each survey stores the template key, version and SHA-256 fingerprint. If the template no longer matches, capture stops with `template_integrity` rather than validating against changed rules. |
| Professional judgement | Fields classed `professional_assessment` (condition ratings, commentary, opinions) are accepted only from owners, administrators and surveyors. |

## Protecting data on the device

- Device data is stored in an IndexedDB database scoped to an opaque hash of the signed-in user and organisation. A different signed-in user on the same browser profile opens a different database.
- **Remove offline copy** deletes the survey's pack, outbox and queued photos, and clears the cached page shells. It warns first if unsynced work would be lost.
- Device copies without pending changes expire after 30 days.
- Original photos stay on the device only until they upload. The server keeps originals immutable in private Vercel Blob storage, streamed only through `GET /api/v1/media/:id` after tenant authorisation (`Cache-Control: private, no-store`).

**Residual risk:** browser storage is protected by the device and browser profile, not by app-level encryption. Without a credential available offline, app-level encryption would not stop someone who can already use the profile. Survey devices should therefore be:

- single-user managed profiles with full-disk encryption;
- screen-locked, with remote wipe available.

The service worker's cached page shell is per-origin, so on a shared profile another person could reach a cached shell while offline. They would still need the URL, and their own database scope would not contain the data unless they share the same Clerk user.

## Not yet covered

- On-device AI.
- Background Sync API registration: the app syncs while it is open; the outbox persists otherwise.
- Clearing device data automatically at sign-out: the app currently has no sign-out control of its own, so this is done with Clerk's account menu plus **Remove offline copy**.
