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
