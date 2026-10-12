# Workspace UI review — 8 October 2026

## Evidence and method

Accepted concept: `/Users/anthonyosei/.codex/generated_images/01a11b5c-e82a-7cf1-afbf-d0633b91b0d7/exec-56461232-eea2-4151-bdde-9e718301a008.png`.

Approved evolving demo remains at `/Users/anthonyosei/Documents/Clifton Surveyors/demos/future-client-workspace`.

Production screenshots are saved in `/Users/anthonyosei/.codex/visualizations/2026/10/08/01a11b5c-e82a-7cf1-afbf-d0633b91b0d7/`:

- `production-overview-desktop.jpg` — overview at 1505 × 1045.
- `production-fieldwork-desktop.jpg` — selected fieldwork job, same desktop dimensions.
- `production-staff-desktop.jpg` — staff profile.
- `production-staff-mobile.jpg` — profile at 390 × 844.
- `production-platform-tenants.jpg` — platform tenancy register.
- `production-overview-current.jpg` — restored default browser viewport.

Used Codex Browser/IAB, not a substitute screenshot renderer. The accepted concept and implementation screenshots were inspected with `view_image` in the same QA pass. Desktop was checked at the concept’s native 1505 × 1045 dimensions, the current browser viewport, and 390 × 844 mobile. No page-level horizontal overflow was observed at the tested desktop/mobile sizes.

## Fidelity ledger

| Comparison | Concept evidence | Production evidence | Resolution |
| --- | --- | --- | --- |
| Palette | White surfaces, pale slate canvas, blue selected navigation | Same palette across practice and platform; blue Surveyant control | Preserved; no new decorative AI symbols |
| Navigation | Fixed left rail with operational sections | Reusable rail; fieldwork between overview and staff | Expanded to the requested CRM/jobs/calendar/finance/services/locations sections; intentional change |
| Panels and spacing | Thin borders, compact corners, grouped operational panels | Flat 3 px panels, compact headers and table controls | Fixed a legacy high-specificity shadow/radius override |
| Typography | Readable sans serif headings, dense operational labels | Geist production typography; 30 px main headings, readable forms/tables | Intentional production-font substitution; checked heading, label, button, input and table text |
| Map and inspector | Main map with right-hand people/allocation panel | Existing MapLibre renderer with selectable people/client-job rail | Reused production renderer; selection highlights without losing the whole-day extent |
| Assistant | Functional Bot icon and an operations brief | One persistent Bot overlay, visible business/case/platform context | Changed to the requested persistent overlay; no invented live AI response |
| Staff identity | Initials and professional identity | Named profile, initials/portrait fallback, declared RICS record, service/coverage fields | Unknown details remain accurately unset instead of seeded as verified |
| Responsive layout | Desktop operational dashboard | Drawer navigation and single-column profile at 390 px | No page overflow; mobile inputs increased to 16 px |
| Copy and unavailable data | Fictional utilisation, live claims and London sample routes | Existing practice records; unconfigured provider/location statuses | Intentional: production must not reproduce fictional utilisation or traffic-adjusted ETA claims |

## Above-the-fold copy review

The concept’s `Business overview`, `Staff`, `Reports`, `CRM`, `Services` and `Locations & Routing` labels were compared with the implementation. Navigation changes to `Surveyors & staff`, `Reports & insights`, `CRM suite` and `Locations & routing`, plus the new `Daily fieldwork`, `Jobs`, `Calendar` and `Finance` entries, implement the requested rollout. The overview retains the existing personalised greeting and operational record summary. Practice branding comes from the tenancy rather than hard-coded Clifton identity; the operator shell retains Surveynt. These are intentional deviations required by the production plan. Local fixture notices remain visible. No static concept utilisation, externally verified RICS assertion, live tracking assertion or invented traffic-adjusted ETA was copied into production.

## Interaction checks

Staff name → dedicated profile; section editing → unsaved-change dialog → keep/discard; Surveyant open → navigate staff/settings → still open; Escape → closes overlay and restores trigger focus; mobile navigation → staff register → profile; fieldwork roster selection → selected marker and correct job link; platform tenants → tenant detail → connection selection; platform settings → provider controls.

Provider-unavailable/coordinates-unavailable states were visible. External basemap/service connections remain unconfigured in this local preview, so the map shows markers with an explicit setup notice. Live provider operation, physical native location behaviour and an authenticated real client-case browser flow remain deployment/device checks; scoped public case access is covered by integration tests.

The approved visual system was faithfully verified with these documented production adaptations. This is not a claim that every page is a pixel-identical copy of the original illustrative dashboard. No unresolved clipping or page overflow remains in the reviewed states.

## Three workspace switch review — 8 October 2026

Compared the original manager concept and final administration render with `view_image` in the same review pass. Saved final evidence in the task's visualization directory:

- `workspace-administration-desktop.png` — 1505 × 1045, complete administration label and actual actor name.
- `workspace-manager-desktop.png` — full business job register.
- `workspace-surveyor-desktop.png` — the same person's two assigned jobs, without financial columns.
- `workspace-switch-mobile.png` — 390 × 844 drawer, readable workspace selection and actor identity.
- `workspace-administration-current.png` — restored 1280 × 720 default viewport, left-pane selector and matching header.

| Reference comparison | Final result / intentional adaptation |
| --- | --- |
| Blue/slate/white palette | Retained white cards and navigation, pale slate canvas, blue active states. |
| Practice identity in left rail | Tenancy branding retained; selector placed directly below the practice name. |
| Active navigation and header | Both identify the current instance; operational sections remain in manager mode. Administration has its dedicated setup overview. |
| Typography and controls | Production font retained; full administration name fits the desktop control. Mobile selects use 16 px text. |
| Panel alignment | Administration cards have aligned headers, consistent spacing and action placement. |
| Surveyant control | Functional Bot icon retained; one overlay identifies administration, management or personal scope. |
| Account identity | Actual owner identity stays visible even in manager/surveyor mode; no impersonation copy. |
| Responsive navigation | 280 px drawer accommodates the selector; Escape restores focus to the menu button. No document overflow observed. |

Copy reviewed: `Practice administration`, `Manager workspace`, `Surveyor workspace`, `Current workspace`, and `Same account · this tab only`. These replace an ambiguous role-only instance label. The administration page describes tenancy governance, not Surveynt platform access. Fixture notices remain visible and no sample numbers are presented as live production results.

Browser checks passed for soft switching, separately remembered pages, refresh, back/forward, simultaneous tabs, personal assignment scope, persistent assistant context, and keep/discard of unsaved edits. A browser-discovered Next route-cache reuse issue was resolved using distinct internal route identities that re-export existing pages. Mobile checks covered the switch, keyboard focus and overflow. The final preview uses fictional records and no-Clerk fixtures; live Clerk and OAuth-provider sessions still require configured credentials.

Final verification: root lint (10 tasks), type checks (10 tasks), production build (10 tasks), unit tests (9 tasks; web 75 suites / 473 tests), web PostgreSQL integration tests (35 suites / 259 tests), and database integration tests (2 suites / 8 tests) passed. `git diff --check` passed. The disposable database was stopped after verification. Migration 0079 is prepared locally and has not been applied to live data. See `workspace-switch.md` for security, routing and migration details.
