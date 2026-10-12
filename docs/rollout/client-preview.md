# Client review demo

Refreshed on 12 October 2026 from application commit `5c1fa6a` on the separate Vercel project `surveynt-client-demo`. Deployment `dpl_9CGhNpS7xWvhRvakQUj8PiMwk1yL` was built, checked and promoted to the existing public demo domain.

All four links below include SurvAI: the surveying-instrument symbol, notch-only tape measure, upward extension followed by the fieldbook reveal, reverse closing motion and reduced-motion support. Contextual task buttons submit a request silently to the existing governed API. Generated questions never appear as user messages, including in restored history. A task opens a dedicated review sheet with loading, completed or unavailable states. Completed answers preserve provider text, display headings and lists where supplied, and link to validated source records. The folded-corner sheet unfolds from the tape edge; findings and sources fade in afterward.

The entry box remains for unique requests. Contextual actions and retries preserve its draft; only manual submission clears it. Users can return to Actions, reopen reviews, navigate saved results and retry an unavailable review. Quickly loaded history is restored after the context reset, so it is not cleared by a delayed reset.

Requests follow the current page or subview and effective workspace role, including the selected case, property or customer where an authorised record identifier is available. Server validation and tenant, assignment, document, consent and model-governance boundaries remain in force. An owner using the Surveyor workspace receives Surveyor actions and scope.

The companion has a default home slot at the bottom right. Drag its header or collapsed symbol near a page edge to snap left or right, with an edge guide during the move. Drop near the home slot or activate it to return home. The header has a Return to dock button and close control; dedicated left/right snap buttons are removed. The return button parks the widget without submitting a request or closing it. Drag the header to move, or focus the header and use arrow keys; Home returns it to its slot. Right-facing docks unfold the fieldbook inward to the left, and the device position is remembered. The fieldbook and tape fit their content and extend or retract upward from the tape case. Screen-length results use previous/next page controls, with separate controls for saved reviews. The composer grows for ordinary multiline requests, with a height limit for very long drafts. Short screens omit repeated welcome artwork to retain space for actions. The close control retains circular sizing and returns focus to the launcher.

The docking geometry passed ten placement tests. The header return-button update passed targeted lint, TypeScript, the production build and an isolated browser check confirming a floating widget returns home while retaining its draft. Its isolated browser check verified floating, left and right proximity snaps, returning an expanded widget home, snapping a collapsed launcher into the home slot, closing and a 390-pixel phone layout. The public Manager Finance view confirmed the two dock buttons are absent, the header return button parks the widget, keyboard movement exposes the empty home target, and activating that target returns focus to the header return button. All four stakeholder links returned HTTP 200 with the home dock and without the removed controls. The earlier results/Gemini release passed 54 relevant tests. An isolated browser preview checked desktop and phone layouts, silent requests, loading, successful results, cited links, custom drafts, error/retry, quickly restored history, docking and keyboard access to sources on long paged results. Successful responses and sample amounts were simulated. Live Gemini checks on the staged demo returned cited Finance, assigned Surveyor-case and platform-status answers. Surveyor Finance access returned HTTP 403. After promotion, the public Finance action produced a cited Gemini result reporting balances as unknown, preserving a custom draft and displaying the demo provenance. All four shareable overview links returned HTTP 200 with their expected role-specific actions and the new results interface.

The public demo now uses Gemini 3.1 Flash-Lite through a server-side Vercel secret. Google accepted the supplied key and a live structured-generation test. Demo replies use bounded fictional fixtures, include only validated citation identifiers, and identify their demo provenance. Finance has no recorded invoices or verified payments, so the assistant must explain the missing records rather than invent balances. Calendar illustrations do not establish assignment-verified appointments. Authenticated production practices remain on the existing registered-model, risk, consent, quota and audit paths. No production governance approvals or client consent were created. See [Gemini configuration](../assistant/gemini.md).

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

This project has no production Clerk, database or payment credentials. Its Gemini credential is a server-only secret used for the explicitly enabled fictional demo adapter. Scheduled jobs were omitted from the deployment snapshot. Fictional changes use the existing local fixture mechanisms and must not be relied on for durable, private records. AI access to real records, live tracking, weather, traffic, payments and secure real client case links require their authenticated configuration.

The existing production application was not promoted or migrated. The redesign is pushed on `codex/surveynt-completion-updates` for review in https://github.com/Only1Antz89/surveying_platform/pull/4. The normal Git integration also built an authenticated preview for that branch.

The deployed administration page, manager dashboard, personal fieldwork and platform tenant register were checked in the Codex browser without signing in. The practice switch was exercised in both directions, with the same fictional actor.
