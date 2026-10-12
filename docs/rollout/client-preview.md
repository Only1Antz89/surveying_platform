# Client review demo

Refreshed on 12 October 2026 from application commit `f500d43` on the separate Vercel project `surveynt-client-demo`. Deployment `dpl_9QoEbABWr7iNWnU1J52qg42NMxBX` was built, checked and promoted to the existing public demo domain.

All four links below include SurvAI: the surveying-instrument symbol, notch-only tape measure, upward extension followed by the fieldbook reveal, reverse closing motion, reduced-motion support and workspace-specific prompts. The companion can be dragged by its header or collapsed symbol, docked on either edge with pointer or keyboard controls, and remembers its device position. The close control has fixed circular sizing and returns focus to the launcher. Viewport constraints keep the expanded panel and collapsed caption visible. Public page checks returned HTTP 200 for every link; the deployed assistant was opened and its immediate action request, preserved custom draft and closing behavior were checked in the browser. Action buttons submit immediately; only manual submissions clear the entry box. Successful responses and manual submission were checked with an isolated simulated provider. The public demo currently reports that no approved SurvAI provider is configured.

SurvAI now selects requests for the active page or subview and effective workspace role, including the selected case, property or customer where an authorised record identifier is available. Actions remain available during a conversation and preserve custom drafts. Server validation rejects page contexts outside the actor's access; source queries retain tenant, assignment and document permissions. An owner using the Surveyor workspace receives Surveyor actions and scope.

The contextual-action release was checked on Surveyor Calendar and Manager Finance in the public browser at mobile and desktop sizes. All four overview links returned HTTP 200 with their expected role-specific actions. The live Surveyor Finance request returned HTTP 403; permitted Calendar and Manager Finance requests reached the existing provider-configuration limitation. Its 34 relevant tests, lint, TypeScript and production build passed. Production database queries and real model-generated answers were not exercised by this credential-free demo.

The latest layout update makes the fieldbook fit its content and extend or retract upwards from the tape case, including after moving or docking. Conversation content has no scroll area. Screen-length content uses previous/next page controls; a shorter final page retracts the tape. The composer grows for ordinary multiline requests, with a height limit for very long drafts. Short screens omit the repeated welcome artwork to retain space for actions. Desktop and phone previews checked opening, closing, docking, keyboard movement, immediate actions, draft preservation, long replies and paging; generated replies were simulated. This update passed 31 relevant tests, lint, TypeScript and the production build.

After promotion, the public Calendar welcome showed all three actions without a scrollbar or page controls at 1280 × 720 and 390 × 844. The live immediate action preserved a custom draft and fitted the existing provider-configuration notice. All four shareable overview links returned HTTP 200 with the adaptive fieldbook and their expected role-specific actions.

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
