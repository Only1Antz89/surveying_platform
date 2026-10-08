# Acceptance results (8 October 2026)

Local acceptance run on branch `claude/bold-carson-jrs2gd`: PR #3 merged, plus migration 0074. Environment:

- Production build (`next start`) and Chromium 141 via `playwright-core`.
- Disposable PostgreSQL 16 + PostGIS for the database-backed checks.

Nothing in this document was run against staging or production. No provider credentials were available.

## 1. Platform management persists into demo client accounts

### What was run

| Path | How it was signed in | Script | Result |
|---|---|---|---|
| Local preview (no Clerk keys; per-practice preview store) | Built-in demo platform operator (super administrator) and demo practice owner, in separate browser contexts | [`acceptance/platform-management.mjs`](../../acceptance/platform-management.mjs) | **19 of 19 passed** |
| PostgreSQL with Clerk-mode access resolution | Real `platformApiContext` and `apiContext` against the database, with Row-Level Security and audit. Only Clerk's `auth()` session lookup is substituted, because Clerk is unreachable here | [`apps/web/test/platform-support-persistence.integration.test.ts`](../../apps/web/test/platform-support-persistence.integration.test.ts) | **Passed** |

### Browser checks (local preview)

1. **Suspension**
   - Suspension persists after the operator reloads.
   - The practice workspace then shows "Workspace access is suspended" and has no client controls.
   - Reactivation persists and restores the client register.
2. **Write support access**
   - A write request appears to the practice owner on the Team page as awaiting approval.
   - Before approval, the session page returns 404 and API writes are rejected (401).
   - After the owner approves, the operator can open the session.
3. **Support-session changes**
   - In the approved session the operator creates a client, edits its name and phone, and adds a primary contact.
   - All of these appear in the practice's own register in a **separate browser session**, and still appear after a reload.
4. **Two-way and concurrency**
   - A practice-side rename appears in the support session.
   - A concurrent stale edit from the support session gets "The client was changed by another user. Reload before trying again." (409). The newer practice value is kept.
5. **Restrictions**
   - A read-only session shows no "New client" control, and its API writes are rejected (401).
   - Another demo practice's register does not show the record.

### Database checks (PostgreSQL)

- **Lifecycle**
  - A super administrator suspends the practice; the owner's API access is then refused.
  - Reactivation restores access.
  - A support-role operator cannot change tenant status (403).
- **Approval and writes**
  - Write access is refused until the owner approves; `approved_by_user_id` is recorded.
  - Support-session create, update and add-contact land in the practice's tenant rows.
  - The owner's own session lists and reads them, and can edit them.
- **Conflicts and attribution**
  - A stale support write returns 409; the support view shows the newer practice value.
  - Support writes are audited with `platform_staff_id` and `support_session_id`, and no practice user is recorded as actor.
  - The other practice's rows are untouched.
- **Session binding**
  - The session is bound to its operator; another support operator gets 401.
  - A read-only session can read but not write.
  - An expired session is refused.

### Not verified, and why

- **Real Clerk sign-in.** No Clerk keys are configured. The environment's network policy also blocks `api.clerk.com` (proxy returns 403). A staging run with real Clerk users remains required by the [release checklist](release-checklist.md): owner, a second signed-in session, and a platform operator. The browser script takes `SURVEYNT_URL` so it can be adapted to that run.
- **Hosted data.** Hosted Neon and Vercel were not touched.
