# Client review demo

Refreshed on 12 October 2026 from application commit `ced23c0` on the separate Vercel project `surveynt-client-demo`. Deployment `dpl_Bktx82FRobEAhNAXNE8Qs4Si7ses` was built, checked and promoted to the existing public demo domain.

All four links below include SurvAI: the surveying-instrument symbol, notch-only tape measure, upward extension followed by the fieldbook reveal, reverse closing motion and reduced-motion support. Contextual task buttons submit a request silently to the existing governed API. Generated questions never appear as user messages, including in restored history. A task opens a dedicated review sheet with loading, completed or unavailable states. Completed answers preserve provider text, display headings and lists where supplied, and link to validated source records. The folded-corner sheet unfolds from the tape edge; findings and sources fade in afterward.

The entry box remains for unique requests. Contextual actions and retries preserve its draft; only manual submission clears it. Users can return to Actions, reopen reviews, navigate saved results and retry an unavailable review. Quickly loaded history is restored after the context reset, so it is not cleared by a delayed reset.

Requests follow the current page or subview and effective workspace role, including the selected case, property or customer where an authorised record identifier is available. Server validation and tenant, assignment, document, consent and model-governance boundaries remain in force. An owner using the Surveyor workspace receives Surveyor actions and scope.

The companion can be dragged by its header or collapsed symbol, docked on either edge with pointer or keyboard controls, and remembers its device position. The fieldbook and tape fit their content and extend or retract upward from the tape case. Screen-length results use previous/next page controls, with separate controls for saved reviews. The composer grows for ordinary multiline requests, with a height limit for very long drafts. Short screens omit repeated welcome artwork to retain space for actions. The close control retains circular sizing and returns focus to the launcher.

This release passed 38 relevant tests, lint, TypeScript and the production build. An isolated browser preview checked desktop and phone layouts, silent requests, loading, successful results, cited links, custom drafts, error/retry, quickly restored history, docking and keyboard access to sources on long paged results. Successful responses and sample amounts were simulated. The public Manager Finance view checked the silent action and unavailable review state, preserving a custom draft. All four shareable overview links returned HTTP 200 with their expected role-specific actions and the new results interface.

The public demo has no approved SurvAI provider. It shows a review-unavailable state instead of fabricating results. Production database queries and real model-generated answers were not exercised by this credential-free demo.

## Shareable links

- Practice administration: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/overview
- Manager workspace: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/manager/overview
- Surveyor workspace: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/surveyor/overview
- Platform tenancy management: https://surveynt-client-demo.vercel.app/platform/tenants

Contextual action examples:

- Surveyor Calendar: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/surveyor/calendar
- Manager Finance: https://surveynt-client-demo.vercel.app/app/clifton-surveyors/manager/finance

The client can open these links directly. No application email or password is required. The fictional practice owner is Maya Patel; the platform fixture is Surveynt Operator. These are preview identities, not authenticated production accounts.

The sidebar selector exposes all three practice instances. Surveying mode shows Maya's own sample assignments. The platform view is separate and does not follow from the practice workspace switch.

## Preview limits

This project has no production Clerk, database, payment or provider credentials. Scheduled jobs were omitted from the deployment snapshot. Fictional changes use the existing local fixture mechanisms and must not be relied on for durable, private records. Connected AI, live tracking, weather, traffic, payments and secure real client case links require their authenticated configuration.

The existing production application was not promoted or migrated. The redesign is pushed on `codex/surveynt-completion-updates` for review in https://github.com/Only1Antz89/surveying_platform/pull/4. The normal Git integration also built an authenticated preview for that branch.

The deployed administration page, manager dashboard, personal fieldwork and platform tenant register were checked in the Codex browser without signing in. The practice switch was exercised in both directions, with the same fictional actor.
