# Three practice workspaces

## Role and session behaviour

| Membership | Workspace choices |
| --- | --- |
| Owner / administrator | Practice administration, Manager workspace, Surveyor workspace |
| Manager | Manager workspace, Surveyor workspace |
| Surveyor | Surveyor workspace |

The left-pane selector sits below the practice name. The page header repeats the active workspace. Switching keeps the same Clerk user, organisation and membership. It does not call sign-out, impersonate another surveyor or change a shared mode cookie. The person sees their own assignments in surveying mode.

Existing canonical URLs use the membership's native workspace. Alternative manager and surveyor URLs rewrite to distinct internal `workspace-instances/[workspaceMode]` routes. These route modules re-export the existing page implementations. Distinct route identities prevent Next's router cache from reusing a previously rendered administration/manager page in personal mode. Internal route URLs redirect to their public counterparts.

API aliases resolve to existing handlers. The proxy replaces caller-supplied workspace headers. Every handler resolves a fresh active membership; `actorRole` stays actual, while the effective role caps workspace operations. Professional recording/approval checks use actual membership grants. Owner-only subscription controls remain unavailable in manager/surveyor modes. Platform operator and mobile authentication remain separate.

## Navigation, data and forms

Per-tab `sessionStorage` keys include user, tenancy and workspace. Returning restores the last permitted page; remembered case/property destinations are checked against current assignment before switching. Unsupported paths fall back to the dashboard. Storage unavailability does not disable switching.

Shared links, native download/OAuth anchors, fetch requests and server redirects preserve mode. OAuth state carries the selected instance encrypted, validates it against current membership, and returns to that instance's account page. Existing state without a mode retains its previous return flow.

Unsaved forms offer keep/discard before switching. In-flight mutation requests disable the selector. Workspace content remounts on mode changes, clearing local record/editor state. Survey recording offline keys and notification keys include workspace scope. Reads are aborted and late responses ignored.

The no-Clerk preview remains fictional: the owner fixture has two personal assignments, while management sees the full sample register. The authenticated database fixtures exercise owner, administrator, manager and surveyor projections.

## Surveyant migration

Apply `0079_yellow_warbound.sql` through the normal reviewed migration process. It adds `surveyant_conversations.workspace_audience` with a `manager` default and an administration/manager/surveyor constraint. Existing business conversations remain manager histories. Nothing is deleted or copied into personal surveying.

One overlay persists across navigation, with an explicit audience label. Switching clears displayed answers, draft and pending reads. Business histories are separated by user and audience. Personal answers are hidden if a cited assignment is no longer permitted. Case conversations retain their job association and recheck current access.

Contextual mutations retain the actual actor and add workspace mode to audit metadata. Public and background/system operations retain their own attribution.

## Verification

See `ui-review.md` for browser evidence and the visual comparison. Verification used disposable PostgreSQL/PostGIS databases with the production Neon driver and RLS roles. No live migration, deployment, membership change, payment or external AI request was performed.

Live Clerk browser-session/OAuth-provider verification still requires configured credentials. Local UI checks and integration tests use fictional data and mocked Clerk identity; they do not claim a live provider session has been exercised.
