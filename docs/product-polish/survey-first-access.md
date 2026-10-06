# Survey-first access — implementation and release handover

Status: local implementation, 4 October 2026. Not a staging or production sign-off.

## Recording entry points

Work → Jobs has direct survey and connected job-detail links. Job detail connects the agreed service, customer, property, current survey and appointments. Calendar visits link to the same recorder. Surveyors' Overview is My work, restricted to assigned jobs and visits. Existing survey URLs remain unchanged.

New starts suggest the service scope from the agreed job name and require confirmation. Unsupported or bespoke instructions are not silently converted to Level 2. Creation is serialized per job; concurrent starts return the same survey. The native recorder still uses versioned observations, field values, media originals, device storage, sync ledgers and explicit conflict resolution.

## Professional permissions

Migration `0033_blue_bloodaxe.sql` adds Manager and two false-default membership columns. Management roles receive neither professional permission automatically. Surveyors inherit recording for currently assigned work, not report approval. Finance, coordinator and read-only roles are ineligible for grants.

An owner uses Settings → Team → Professional permissions to grant or revoke recording and approval independently, including their own. Each change requires a reason and records the granting owner, recipient, permission, prior state and time. Administrator/Manager self-grants are denied. Role changes clear both explicit grants; no role synchronisation event fabricates a professional permission. Entered RICS numbers remain self-declared.

Owners control ownership/subscription changes. Administrators manage staff without ownership or subscription control. Managers can manage operations/settings/finance/Insights, not staff access. Finance has financial pages and personal settings only. Surveyors have personal settings and assigned-work surfaces, not firm Settings, Finance or Insights. Both modern and fallback navigation are role-filtered; API/page gates remain authoritative.

Professional APIs check before demo shortcuts. Survey creation, sync, media writes, proposal review, report composition and approval additionally recheck current membership in the database. Recording and approval locks serialize with permission revocation. Assignment is rechecked for survey starts, sync writes, media and proposal application. Shared customers/properties do not grant access to other jobs. Registers/search/history/photos and notifications use explicit assignment filters; surveyor financial payloads are omitted.

## Home Survey template comparison

The previous `surveynt-residential@1.0.0` is Surveynt-authored, not an approved branded RICS template. Its fingerprint is unchanged.

Four new firm-draft templates preserve the supplied Clifton A–I recording structure with inspection/instruction details, legal issues, risks and declaration. Level 2 valuation and Level 3 energy sections are separate variants. They reuse native fields, element ratings, observations, photos, completion checks and report assembly. A new start explicitly selects its template/version; existing pinned surveys are never silently migrated. Assistance/external evidence remains separate and requires explicit review.

These drafts do **not** certify RICS compliance or licensing. Report approval and issue have non-overridable template-review gates. A professionally reviewed, separately versioned template is required before production issue. Confirm Clifton's actual licensed report wording, complete standard/template mapping and output/colour regression review with a qualified practitioner. RICS says branded reports require a licence; non-branded bespoke reports still need to comply with the Home Survey Standard: https://www.rics.org/profession-standards/home-surveys-licences . No licence purchase or compliance approval has been inferred.

The recorder places observations before assistance in reading order. Tabs support arrows/Home/End and labelled panels. The initial checklist shows three issues with access to the complete checklist; the form is not buried under all unanswered fields on phones.

## Offline limits and release blockers

- Server access is checked on every sync. Cached packs for denied/removed surveys are erased when reopened/revalidated; recording freezes after an explicit denial. A disconnected device cannot receive immediate revocation. A full all-cached-pack reconciliation, across every application route, remains to be completed and verified.
- Existing tenant RLS remains enabled. Assignment-aware protection currently depends on explicit application predicates; a database-level assignment RLS layer and comprehensive guessed-ID/export/download audit remain release requirements. Do not present the current tests as exhaustive authorization certification.
- Need authenticated browser testing for separate Owner/Admin/Manager/Surveyor/Finance experiences, support-session boundaries, screen-reader/keyboard paths, dark/system themes and enlargement. Local preview shows a representative, read-only Owner; it is not the private persistent demo.
- Apply migrations to staging only, verify runtime-role access, provision the private practice and Stephen's Owner membership with both professional flags false. Stephen has **not** been provisioned by this implementation run. Verify existing Clerk identity/domain before inviting; never commit credentials or manufacture an account.
- Compare GitHub/Claude overlap before publishing a reviewed commit. Do not force-push or release main while acceptance/security checks remain open. Production migration/deployment has not been performed here.

## Verification record

Web unit tests: 81 passed. Assistant tests: 57 passed, including six new template registration/order/scope/field/rule tests; the legacy template fingerprint regression remains green. Domain tests passed earlier in this implementation. Lint, typecheck and production build passed during the work; rerun after any subsequent edits.

The final full web integration run passed **93 tests in 17 files**, using disposable PostGIS databases with all migrations. Coverage includes tenant isolation, current membership/grants/revocation, guessed assigned-job access, shared-customer filtering, absent surveyor fees, concurrent starts, versioned recording/conflicts/media/proposals, completion overrides, explicit sign-off, simulated stakeholder payments/booking/report access and immutable report history. Older authorized fixtures were updated to explicitly grant approval and assign jobs, not to bypass enforcement. The first broad runs exposed old-policy expectations; corrected reruns are retained in local test output. These tests are not a complete role/assignment RLS certification.

Browser checks: localhost Jobs → Open survey exposes the Level 3 A–K firm-draft recorder and disabled findings for an ungranted Owner. At 390 × 844, the form precedes assistance, there is no horizontal page overflow, and ArrowRight moves from D to E with visible keyboard focus. The white inspection surface is readable inside dark application chrome. Online shell assets now refresh rather than retaining stale cached development styles. The final web lint/typecheck/unit checks and production build passed. No authenticated multi-role or offline device end-to-end sign-off is asserted.

External integration gates are unchanged: HMLR capacity/scratch storage, EPC credentials/licence/data-protection approval, secure public quote secret, separate client-payment configuration and legal/accounting approval, calendar secrets/credentials and production routing provider.

## Rollback

Retain additive columns and audit history; do not drop professional permission data. Revert the application to a compatible verified build only after assessing whether it would restore historical role-based privileges. Disabling navigation polish is not a security rollback. Revoke professional grants through the audited control when needed. Existing surveys keep their pinned templates and records. New firm-draft surveys must not be silently changed to the old residential template.
