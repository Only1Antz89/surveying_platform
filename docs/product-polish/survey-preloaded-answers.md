# Reviewable preloaded survey answers

Home Survey templates 1.1.0 add source permissions and field guidance without changing supplied question wording, section order, professional classification, ratings or report layout. Version 1.0.0 and older residential surveys remain pinned and are not silently upgraded. New starts default to 1.1.0; authorised staff can still select older versions.

The recorder's **Load evidence** action reads current, identity-matched, unexpired property-intelligence snapshots and optionally retrieves historical weather. It creates suggestions, never completed observations. Accept/edit requires recording permission, explicit professional confirmation, unchanged field baseline and current source/identity. Existing recorded answers generate discrepancies instead of replacements. Review decisions and accepted values retain evidence and audit history.

| Question | Evidence available now | Limits/fallback |
| --- | --- | --- |
| Type of property | Latest matched EPC property type + built form | Historical certificate; inspect to confirm current use/type. EPC remains licence/credential gated. |
| Approximate year built | EPC construction-age band, copied verbatim | Preserve date ranges; do not invent an exact year. Unknown stays manual. |
| Approximate year extended/converted | Manual documentary/inspection entry | Current providers do not establish completion years. Planning permission/application dates must not be substituted. |
| Local environment | Matched planning, Historic England, Natural England and separate EA planning flood-zone designations | Indicative location context only, not safety, noise, traffic, contamination or property-specific flood certification. Coverage/confidence/matching are retained. No matches create no reassuring answer. |
| Weather during inspection | Optional Open-Meteo-compatible historical archive adapter, using a saved actual inspection date and confirmed property location | Whole-day Europe/London modelled context, not a measured site observation or visit-time weather. Surveyor must confirm/edit. Today/future dates, archive lag, missing/null data, bad units and outages fall back to manual. Never substitute a forecast. |

## Weather activation

- `INSPECTION_WEATHER_API_URL`: approved HTTPS Open-Meteo-compatible `/v1/archive` endpoint. No public endpoint is configured by default.
- `INSPECTION_WEATHER_API_KEY`: optional server-only commercial key; never returned or saved as evidence.
- `INSPECTION_WEATHER_TERMS_APPROVED=true`: operator confirmation of appropriate commercial/self-hosted service terms, attribution and data handling.
- `ASSISTANT_ENABLED=true`: existing proposal kill-switch remains required.

Historical data and service terms are distinct: Open-Meteo documents CC BY 4.0 data attribution, while commercial API access needs the appropriate service arrangement. Validate the selected endpoint, account, terms, archive delay and units before enabling. Official documentation: https://open-meteo.com/en/docs/historical-weather-api . No purchase, production configuration or deployment was performed.

Weather requests are explicit, organisation-rate-limited, time/size bounded and redirect-blocked. External requests are disabled for persistent demo organisations. The development preview shows clearly labelled fictional EPC suggestions, not live records. Weather evidence stores the input date-value ID and location fingerprint: changes invalidate acceptance, including changes after a suggestion was loaded. Source snapshot replacement/expiry likewise prevents stale acceptance.

## Workflow

1. Confirm the property's identity/location and refresh its Intelligence records from the property page.
2. Start a 1.1.0 survey with the agreed service scope; save the actual inspection date and wait for sync.
3. Select **Load evidence**. Review source dates/caveats and each suggestion individually; edit or reject if inappropriate.
4. Record missing facts and the actual site observations manually. An unavailable source never blocks recording.

RICS template review/licensing and issue gates remain unchanged. These mappings do not certify compliance. Future completion-year providers must provide evidenced completion, not infer it from permissions; add versioned source permissions and tests before enabling.

## Local verification — 4 October 2026

- Assistant: 63 tests passed, including six new Home Survey source/version/non-overwrite checks.
- Property-data: 70 tests passed, including eight weather checks (configuration, invalid/future dates, coordinates, historical query, wrong date/units/timezone/location, missing values and outage fallback).
- Web: 81 unit tests and eight targeted proposal integration tests passed against disposable local PostGIS with all migrations. Integration coverage includes explicit professional confirmation, accepted provenance, stale identity rejection, changed inspection-date rejection and demo network isolation.
- Assistant/property-data/web typechecking, web lint, whitespace validation and production build passed.
- Local browser verified template 1.1.0 and simulated EPC suggestions in the recorder; the preview Owner without a professional grant remains read-only. Live-provider smoke tests and production activation were not performed.
- Disposable test container removed after verification; no production data changed.
