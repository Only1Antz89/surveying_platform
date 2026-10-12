# Gemini for the stakeholder demo

Configured on 12 October 2026 for the separate Vercel project `surveynt-client-demo`. The supplied credential passed Google's model-list endpoint and a small JSON-generation request using `gemini-3.1-flash-lite`. This supported, stable 3.1 model was selected instead of the more expensive Pro variant; no fallback was necessary.

Google's published standard paid rates are $0.25 per million text input tokens and $1.50 per million output tokens, including thinking. Prices and availability should be rechecked before changing the model: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [model catalogue](https://ai.google.dev/gemini-api/docs/models).

## Server configuration

| Variable | Value or purpose |
| --- | --- |
| `SURVEYNT_CONNECTION_SECRET_GEMINI` | Vercel Sensitive secret. Never put its value in source, client bundles, logs or this document. |
| `SURVEYNT_DEMO_AI_ENABLED` | `true` only for the no-Clerk fictional preview. |
| `SURVEYNT_DEMO_AI_MODEL` | `gemini-3.1-flash-lite` |
| `SURVEYNT_OUTBOUND_HOSTS` | `generativelanguage.googleapis.com` on this demo project. Preserve any other approved hosts when configuring a different deployment. |

Requests use Google's [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai): `https://generativelanguage.googleapis.com/v1beta/openai`. The credential is sent in the server's Authorization header. Gemini uses minimal reasoning, a 1,000-token output limit and a 45-second provider response window; other integrations retain their 15-second window. The existing adapter requires JSON containing an answer and citation IDs; missing or unknown citations are rejected. The credential is not returned in responses.

## Boundaries and cost controls

The preview adapter requires both the explicit enablement flag and a server credential. It rejects non-demo contexts and any deployment with configured Clerk authentication. Firm requests retain effective-role/page validation. Surveyors receive only Maya Patel's fictional assigned cases with fees omitted. Platform requests receive fictional lifecycle counts only. Finance, documents, report contents, selected unresolved records and live appointments retain explicit coverage gaps; no substitute amounts or findings are manufactured. Replies are labelled as generated from fictional demo records.

Known contextual tasks can reuse a cached cited answer for five minutes, keyed by the model, role, organisation, request and source snapshot. Unique user requests are not cached. A warm server instance accepts at most two concurrent provider calls and twenty calls per minute. These are warm-instance controls, not a global spending cap; Google project quotas remain the global control.

Real practices continue through the existing enabled platform connection and tenant selection, registered model/use approval, current risk assessment, case consent where required, incident checks, quota reservation, source revalidation and audit persistence. For a future governed production connection, use provider key `gemini`, the same compatible endpoint and a server credential reference. This demo configuration does not approve any production model, client data transmission or professional finding.

## Verification

The key was verified without printing it. It is stored as a Vercel Sensitive variable, and an exact credential scan found no key in repository changes. A live synthetic JSON test returned HTTP 200 from Gemini 3.1 Flash-Lite. Automated coverage includes explicit enablement, production-path isolation, Surveyor Finance rejection, assigned-case/fee filtering, truthful empty finance coverage, cited responses, model selection, task caching and concurrent-call bounds. No production records were used.

The outbound HTTPS transport validates all DNS answers, prefers a validated public IPv4 address where available, pins that address and specifies its address family so current Node auto-selection cannot reinterpret the lookup callback. The transport regression also rejects mixed public/private DNS answers. Unexpected firm-route failures record only the error type, a constrained system error code and an allowlisted transport failure reason; no request, response, source records or credentials are logged.

Live staged application requests returned cited Gemini answers for the empty Finance ledger, the Surveyor’s two assigned fictional cases and platform lifecycle counts. Surveyor Finance access was rejected with HTTP 403 before provider use. A local live Finance adapter check also passed. Finance guidance explicitly treats absent records as an unknown balance, never proof of zero debt.

A staged cold request exposed the legacy 15-second provider timeout in the safe failure log. Gemini calls now receive 45 seconds without retrying billable requests automatically. Transport tests cover both the default integration timeout and the extended AI window.

Deployment `dpl_DEiZ9GDZ84UxkR9W56K4TeqCiSPM` (application commit `75fd8d1`) was promoted to the existing stakeholder domain. The public Manager Finance action produced a cited Gemini answer, explicitly reported balances as unknown and preserved the unique-request draft. The temporary credential file was removed. All four stakeholder overview links returned HTTP 200 with SurvAI present.

## Web search with user confirmation (native endpoint)

SurvAI now has a second Gemini endpoint that sits alongside the OpenAI-compatible one. Both use the same host and the same credential:

| Endpoint | Used for |
| --- | --- |
| `https://generativelanguage.googleapis.com/v1beta/openai` (`/chat/completions`) | Record-grounded answers, as before. |
| `https://generativelanguage.googleapis.com/v1beta` (`/models/{model}:generateContent`, `tools: [{google_search: {}}]`) | Web answers with Google Search grounding, only after the user confirms. The key goes in the `x-goog-api-key` header. |

**How the decision maker works** (`lib/survai-web-router.ts`):

1. Every record-grounded answer now reports `coverage`: `answered`, `partial` or `not_in_records`. It may suggest a `webQuery` when public information could help. An uncited answer is accepted only when it says the records do not cover the question.
2. Deterministic rules then decide whether to offer a web search. A search is never offered when:
   - the records answered the question;
   - the feature is off;
   - the page is about private practice data (finance, billing, quotes, team, governance, documents, account, the client case or a support session);
   - fewer than three words remain after the query is cleaned.
3. Cleaning removes email addresses, UK phone numbers and the names of clients, contacts and people found in the supplied records.
4. The user sees the exact query, with "Search the web" and "Not now". The query is signed with HMAC and bound to the practice and user, and it expires after 10 minutes. `POST /api/v1/surveyant/web` runs only that signed query, so nothing else can be searched.
5. Web answers carry `web:N` citations that link out to the source pages. They are labelled "From the web — not your practice records". An answer without web sources is rejected and nothing is saved.

**Demo** (free evaluation services): web search is offered when `SURVEYNT_DEMO_AI_ENABLED=true`, `SURVEYNT_DEMO_EVALUATION_SERVICES=true` and the Gemini credential are all set. Demo web answers are not stored, and the existing per-instance rate limits apply.

**Production:** off unless all of these hold:
- `SURVAI_WEB_SEARCH_ENABLED=true`;
- the practice's selected AI connection has provider key `gemini` and the OpenAI-compatible endpoint above;
- the AI governance gate allows it.

Each web answer counts against the practice's message allowance. It is saved to the conversation and audited as `surveyant.web_answer_recorded` with the query and the number of sources.

Turning this on for real practices is a separate governance decision, because the confirmed query is sent to Google Search. Before enabling it, check the current grounding quotas and prices in [Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search) and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). The free-tier search allowance is limited. Grounded results come with Google's display requirements for search suggestions, which should be reviewed before production use.

