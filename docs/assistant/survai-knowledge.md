# SurvAI knowledge sources

SurvAI answers only from cited sources that the requesting user is allowed to see. Before 12 October 2026 those sources were limited to case summaries, appointments, document metadata, practice identity and finance totals. SurvAI can now also draw on the data Surveynt already holds for the case, the property and the practice. Every addition is read with the user's effective role and assignments. Every addition carries a stable identifier, so a saved answer stays visible only while its sources remain reachable.

Implementation: `apps/web/src/lib/survai-knowledge.ts`. It is wired into `sendChat` in `surveyant-chat.ts`, with fictional equivalents in `survai-demo.ts`.

## What SurvAI can now use

| Source | Shown on | What it contains | Source id |
|---|---|---|---|
| **RICS-style form state** | Case and survey pages | Template, version, service level and jurisdiction; for each element, its inspection status, limitation, condition rating and recorded-field count; completion checks outstanding (hard gates and advisories) by section and field; pending suggestions and open tasks | `form:<surveyId>` |
| **Property history** | Case, survey and property pages; any question naming a permitted property | Sales, energy certificates, listings and designations from external registers, plus the firm's own earlier jobs and surveys, with event, publication and retrieval dates | `history:<propertyId>` |
| **Property intelligence** | Same as history | Latest stored results per source and category (for example planning, flood, heritage, EPC): status, information class, coverage, freshness, licence and up to five records each. Also the property's location confidence and which sources are enabled | `property-intel:<propertyId>:…` |
| **Visit weather outlook** | Case pages; overview, calendar, routes, fieldwork and jobs pages for upcoming visits | Daily forecast for the visit date and property location (rain total and chance, maximum wind, weather code, temperatures), plus a deterministic risk assessment | `forecast:<appointmentId>` |
| **Approved practice wording** | Survey, case and reports pages | Up to 15 approved clauses relevant to the form's elements | `wording:<clauseId>` |
| **Property search** | Any page, when the question names a postcode or street address | Matching properties within the user's permitted work, with their history and intelligence | `property-match:<propertyId>` |
| **Public postcode lookup** | Questions naming a postcode the practice has no record of | Postcode-area public data through the existing governed address search (Postcodes.io or Nominatim), with attribution | `public:postcode:<postcode>` |
| **General surveying knowledge** | Every request | Permission to answer general questions about practice, construction, defects and terminology, introduced as *"General guidance, not from your records"*. It must not be used for facts about a property or case, or for current regulations, prices or dates | `general:professional-knowledge` |

## Weather risk for upcoming visits

`visit-risk.ts` holds the rules; it is pure and unit-tested. The forecast comes through the practice's governed **weather** platform connection, using Open-Meteo's `/v1/forecast` with daily values for the visit day only, and is cached for 30 minutes.

| Forecast | Flag |
|---|---|
| 15 mm or more of rain in the day | Heavy rain |
| 5 mm or more, or a 70% or higher chance | Rain likely |
| Maximum wind of 50 km/h or more | Strong wind |
| Weather codes 95–99 | Thunderstorms |
| Snow, sleet or freezing rain codes | Snow or ice |
| Minimum of 0 °C or below | Freezing |

The recorded service name sets the visit's exposure:

- **Outdoor-critical:** land, topographic, boundary, site, drone, drainage and tree work.
- **External elements:** building and home surveys, defect, condition and dilapidations work.
- **Mainly internal:** everything else.

Severe weather on outdoor-critical work rates **high**, with prompts to consider rearranging, confirming a fallback date, and checking access, ground conditions and equipment limits. On building surveys it rates **elevated**, with prompts about inspection limitations and damp readings.

These are planning prompts, not safety or professional judgements, and the surveyor decides what to do. SurvAI is told to present a forecast as a forecast.

Without a weather connection, a confirmed property location, or a visit within 16 days, SurvAI receives that status instead of a forecast and says so.

**Activation:** enable a weather connection for the practice under Platform → Settings → Connections. The free `api.open-meteo.com` host is limited to evaluation by the existing connection rules; production use needs an Open-Meteo commercial licence or a self-hosted instance ([Open-Meteo pricing](https://open-meteo.com/en/pricing)). The data is CC BY 4.0 and attribution is included in every source.

## Access and re-authorisation

- **Who sees what.** Surveyors see only their assigned cases and properties, and only their own appointments. Another surveyor's case gives nothing beyond practice-wide general guidance and the approved wording library. Integration tests cover this, including when the other case's address is named in the question.
- **Saved answers.** `authorisedKnowledgeIds` re-checks property, survey, appointment and clause access without the original question. A saved answer disappears from history if the user loses access to anything it cited.
- **Record identifiers.** The fictional preview's readable record ids (`job_01`, `prop_01`) are accepted only in preview. Production rejects any non-UUID record id with a 422 before running a query.
- **Client and support links.** Client case links and support sessions keep their existing, narrower sources.

## Not provided

- **Unconfirmed web search.** SurvAI never searches the web on its own. When the records fall short, it proposes a cleaned query, and the search runs only after the user confirms it. See [gemini.md](gemini.md#web-search-with-user-confirmation-native-endpoint).
- **Shared-learning examples.** They are not supplied while the programme is inactive.

## Cost

With the fictional demo, a survey-page request adds about 5,400 input tokens (11 sources); property and calendar requests add about 1,100–1,500. At the published Gemini 3.1 Flash-Lite rate that is about $0.0014 per request. Existing per-instance rate limits and task caching still apply.

## Verification

- **Unit tests:** weather rules (5), forecast fetch with a mocked connection (4), demo knowledge (4 new), and existing SurvAI context, route and demo tests (updated).
- **Integration test** `survai-knowledge.integration.test.ts`: form state, history, intelligence coverage, wording and an honest "not configured" forecast for the assigned surveyor; exclusion of another surveyor's case and property; postcode search; citation re-authorisation.
- **Browser check (local preview):** the new actions appear on the case, survey, property, calendar and overview pages, and requests carry the page and record context. Answers need the Gemini credential, which is configured only on the stakeholder demo project, not in this environment.

## Free evaluation services for the stakeholder demo

With `SURVEYNT_DEMO_EVALUATION_SERVICES=true`, the fictional demo uses free public services instead of fixed outlooks:

- **Postcodes.io:** finds the postcode area of each fictional visit. It is open data under the OGL. A successful lookup is cached for 24 hours and a failed one for 5 minutes.
- **Open-Meteo free API** (`https://api.open-meteo.com`, overridable with `SURVEYNT_DEMO_WEATHER_ENDPOINT`): supplies a real daily forecast for that area. Results are cached for 30 minutes. This API is for non-commercial and evaluation use only and needs CC BY 4.0 attribution, which the source label carries. Production practices keep using their own approved weather connection.
- **Gemini with Google Search grounding:** used for web searches the user has confirmed. See [gemini.md](gemini.md).

The visits stay fictional, and their labels say so. If a lookup fails, the demo falls back to the fixed fictional outlook.

The demo Vercel project also needs these hosts in `SURVEYNT_OUTBOUND_HOSTS`, alongside `generativelanguage.googleapis.com`:
- `api.open-meteo.com`
- `api.postcodes.io`
