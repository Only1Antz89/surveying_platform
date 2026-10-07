# Calendar subscription recovery

Status: implemented locally; hosted scheduling, provider acceptance and authenticated browser acceptance are unverified.

## Scheduled work

The repository schedules `/api/cron/calendar-subscriptions` every five minutes. It requires `CRON_SECRET`, queues active Microsoft/Google subscriptions due within 24 hours or with unknown subscription expiry, and processes at most one lifecycle job. The POST queue endpoint requires the separate `QUEUE_CONSUMER_SECRET`. `APP_URL` must be the canonical HTTPS application origin for Google replacement. Provider credentials, webhook signing and versioned encryption keys must be configured consistently across workers.

Each scheduled run may settle up to ten fast jobs. A 50-second deadline starts before due-job enqueueing; the worker starts a job only with at least 35 seconds remaining for bounded refresh and subscription calls. Slow operations reduce the batch automatically. At a five-minute schedule the theoretical maximum is 2,880 jobs per day, before slow operations, retries and replacement cleanup. This maximum is not a measured throughput guarantee. Check backlog and renewal lead time against practice volume before release. The schedule must be supported by the deployment plan and observed in staging; repository configuration does not prove execution.

## Google replacement phases

- `ready`: fixed replacement channel UUID and encrypted owner/practice/connection/token snapshot exist before dispatch.
- `dispatched`: the creation boundary is committed. A lost response might mean acceptance; automatic creation stops for review.
- `confirmed`: exact channel/resource/expiry evidence is encrypted and recorded. The worker adopts it under the connection lock and queues exact old-channel cleanup in the same database transaction.

A crash after adoption can settle the confirmed attempt without issuing another watch request. If the owner reconnects or revokes during an unresolved confirmed attempt, retain it for review rather than silently discarding a possibly active provider channel.

## Platform review

Support and super-admin staff use the technical failure queue. Calendar details expose identifiers, phase and attempt metadata only. Do not copy tokens, keys or ciphertext into evidence notes.

Every review requires the current snapshot version, exact verified channel ID, evidence reference/findings and explicit confirmation. A changed or concurrently reviewed job rejects the stale submission.

- Cleanup absence/removal: verify the recorded channel, then settle the cleanup and clear its encrypted snapshot.
- Verified Google cleanup identity: enter provider evidence for the exact recorded channel and missing resource ID, then queue exact cleanup. A conflicting known resource cannot be replaced.
- Reviewed retry: retry the recorded cleanup or Microsoft renewal. Provider auth/configuration failures must be corrected first.
- Google creation confirmed: verify the replacement channel ID, resource ID and future expiry against provider evidence. Queue adoption; no additional watch is issued.
- Google creation not created: use positive provider evidence of non-creation, not a client timeout. Queue the same recorded attempt identity.

Generic retry cannot bypass an uncertain Google creation. Missing encrypted evidence or required encryption keys stays unresolved. Historical Google resource IDs can be supplied through exact-channel operator evidence. Unknown subscription expiry now queues provider-confirmed renewal/replacement. Missing token lifetime metadata uses refresh credentials when available; otherwise the exact provider operation validates access, with authentication failures held. Reconnect now atomically queues prior-channel cleanup with freshly exchanged credentials and clears old subscription fields before registration; confirmed channels that cannot be adopted after a connection change receive cleanup jobs. Initial OAuth registration now records an encrypted attempt before provider creation and the confirmed response before adoption. Lost responses and expired interrupted registration claims are held without another creation request; Confirmed initial responses can now recover adoption (or exact cleanup if the connection changed) without another creation request. Platform review can queue a confirmed initial response for adoption; Dispatched initial Google attempts can be settled with exact recorded-channel/resource/expiry evidence and adopted without another watch. New Microsoft creation persists an attempt-specific signing proof and accepted attempt ID (migration 0054); notification checks reject another attempt or legacy downgrade for those records. Existing null-attempt connections retain legacy validation. Microsoft uncertain initial creation can now be reviewed with the recorded attempt UUID and proposed subscription ID. The server reads the provider account and exact subscription and verifies application/resource/callback/proof/expiry before adoption; expired verification credentials still need durable refresh recovery. Positive non-creation can now close a dispatched initial attempt for either provider using exact attempt evidence; it clears encrypted credentials and does not issue another creation. The owner may reconnect afterward. Confirmed responses cannot be declared never created. Missing channels and lost encryption keys remain unresolved release requirements.

## Release verification still required

- Apply migrations 0053 and 0054 and verify encrypted cleanup snapshots remain decryptable during key rotation; see `calendar-key-rotation.md`.
- Exercise signed-in connect, scheduled renewal/replacement, conflict handling, disconnect and operator review with staging provider accounts.
- Verify webhook delivery for the adopted channel and exact cleanup of the old channel.
- Observe scheduler delivery, queue age, failures and retry recovery under expected volume.
- Verify keyboard/form errors and stale review handling in the authenticated platform UI.

No live provider operation, hosted deployment or stakeholder acceptance is implied by the local test evidence.

### Expired Microsoft review credentials

For initial registration confirmation, a known expired access token is refreshed and its encrypted credential snapshot is committed before Graph verification. Refresh changes the review version. If exact subscription verification fails, reload the failure panel before retrying; the saved rotated refresh token is retained. A successful exact review queues adoption, which installs the refreshed credentials only when the original connection snapshot still matches. Legacy unknown token lifetimes are not invented. Refresh failure or uncertain refresh responses remain held for review. The credential-refresh audit contains attempt identity and review version only.

### Reconnect with an unresolved initial registration

A reconnect updates same-account credentials and queues reconciliation, but does not create another provider subscription while an initial registration job remains queued, processing or failed. Account settings report that platform review is required. Resolve the original provider outcome first. The initial registration helper also checks the active empty-channel connection, exact credential snapshot and outstanding attempts under the connection advisory lock, preventing concurrent or stale callers from dispatching another creation. If reconnect changed credentials before a confirmed attempt is recovered, the worker queues exact cleanup of the original channel; it does not attach that older attempt to the changed connection.

### Backlog review

Platform Incidents includes a calendar delivery health panel under platform authentication. It reports ready versus delayed queued jobs, processing jobs and expired claims, held failures, oldest ready availability, active connections without a channel, expired subscriptions and subscriptions due within 24 hours (including unknown expiry). Refresh the page for current database counts. Expired and due counts overlap by design; processing includes expired claims. These aggregate counts exclude revoked connections and other queues and expose no payloads, tokens or account identities. Review held jobs using the exact evidence forms. A clear database backlog does not establish actual provider delivery or the hosted schedule; record those separately during release acceptance.

### Configuration repair before initial dispatch

A failed initial attempt in `ready` phase has not dispatched provider creation. Platform staff can review the exact attempt (and the recorded Google channel where applicable) and queue a retry after fixing configuration. The worker checks the current active owner/account/credential snapshot and empty channel under the connection lock, refreshes and persists credentials, then persists `dispatched` before the first creation call. Confirmed metadata persists before adoption. A changed connection cancels the unstarted attempt. A dispatched attempt cannot use this retry route; uncertain creation still requires exact provider resolution. HTTPS callback origin, signing configuration and the original attempt identity are required. This recovery does not automatically provision every historical missing-channel connection.

### Historical active connections without recorded channels

The authenticated platform Incidents page lists the oldest 100 active connections lacking a recorded channel. Support/super-admin staff may queue registration only after confirming provider absence for the exact account and recording evidence. The server compares the reviewed connection version and account identity under the connection lock and rejects any unresolved subscription work, stale/revoked/already-channelled connection, unreadable credentials or missing HTTPS/signing configuration. Review, new ready attempt and staff audit commit together. Concurrent reviews cannot queue two attempts. Demo review is explicitly non-persistent. No provider request occurs in the review endpoint; the lifecycle worker uses the ordinary durable pre-dispatch path. If provider evidence shows an existing channel, resolve that identity/attempt instead of attesting absence. This is an operator evidence workflow; it does not automatically discover all historical Google channels.
