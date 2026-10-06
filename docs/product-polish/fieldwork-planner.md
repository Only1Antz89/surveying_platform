# Fieldwork planner integration

The approved private Sites concept is now a native Surveynt workspace at `/app/[organisationSlug]/routes`, under **Calendar → Fieldwork planner**. Existing URLs are retained. The standalone Site remains a reference, not an iframe or a second application.

## Native connections

- Confirmed appointments, job scope, assigned practitioner, customer, property type and coordinates come from the tenant-scoped daily-route service. Managers choose a practitioner from the day's permitted appointments; surveyors cannot request someone else's route, and both appointment assignment and job assignment are checked.
- Selecting an itinerary or map stop updates customer context, the matching generic artwork, job/property links, canonical property-centred map layers and existing intelligence panels. No professional findings are changed. The intelligence read handler now applies the shared assignment guard.
- Road geometry, per-leg estimates and totals require a configured server-side OSRM-compatible provider. Credentials remain server-side. Missing stop coordinates disable routing rather than silently skipping a visit. Route responses are checked for finite distances/times, WGS84 geometry and exact leg parity.
- Journey preview follows returned road geometry, 75 seconds per leg with 12-second inspection pauses and automatic destination context updates. Playback pauses on manual map gestures, hidden tabs and view changes; reduced-motion preferences disable camera animations. It is not GPS, arrival confirmation or live traffic.
- Native light/dark tokens, keyboard-accessible selections, close/Escape/outside dismissal, responsive itinerary/map/property panels and lazy map loading reuse the existing application.

## Activation configuration

`NEXT_PUBLIC_MAP_STYLE_URL` and `NEXT_PUBLIC_MAP_ATTRIBUTION` configure the production basemap. Development alone has an explicitly credited OpenFreeMap fallback. Production has no silent public-demo tile dependency.

Optional public, licensed provider URLs (no secrets):

- `NEXT_PUBLIC_FIELD_SATELLITE_TILES`, `NEXT_PUBLIC_FIELD_SATELLITE_ATTRIBUTION`: raster imagery template and attribution. Imagery must be described with its date/resolution in the attribution; never presented as live photography.
- `NEXT_PUBLIC_FIELD_TERRAIN_URL`, `NEXT_PUBLIC_FIELD_TERRAIN_ATTRIBUTION`: Terrarium raster-DEM TileJSON at true scale (1×). This is not a surveyed site terrain model.
- `NEXT_PUBLIC_FIELD_BUILDING_SOURCE` / `NEXT_PUBLIC_FIELD_BUILDING_LAYER`: style vector source and building layer. Rendered heights use supplied values where present and otherwise an 8 m illustrative fallback; no general accuracy claim. Existing style extrusions are hidden to avoid duplicate models.
- `NEXT_PUBLIC_FIELD_CONTEXT_URL`: a bounded public WGS84 manifest containing `attribution`, `caveat`, optional `crs: "EPSG:4326"`, and `featureCollection`. Maximum 5,000 features / 8 MB response. Features outside the day's location extent plus roughly 1 km context are excluded. Tree/landmark points and park/garden/green-space polygons are supported. Tree forms are symbolic natural canopies with mapped positions; omitted heights default to illustrative 8 m. A `building` polygon must carry a finite `height_m`, `source_date` and `method`; these are historical evidence-derived estimates, not surveyed roof models. The heights-only control suppresses generic surrounding buildings. Retain provider licence, provenance, measurement method and source date in the manifest and its public documentation.

Flood and land/reference overlays use `/api/v1/properties/:id/map`, not the demo's London dataset or a national download. Flood Zones 2 and 3 keep distinct colours and labels. The selected property's 300 m neighbourhood is the only inspected overlay coverage; absence never means safe. HMLR extents remain indicative. No new national import, migration or production deployment is included.

Live traffic still needs an approved traffic-aware provider and authenticated server-side integration; OSRM geometry and duration do not establish live traffic. Imagery, terrain, context and heights controls remain visible with setup/unavailable states, so activation does not need a navigation redesign.

## Preview and verification

The existing no-Clerk local preview uses three clearly labelled, non-persistent examples linked to native demo jobs/properties, with illustrative Bristol/Bath coordinates. It has no road ETA or fabricated road geometry, sends no notifications and changes no operational records. Connected demo organisations continue to use their persisted appointments and simulated provider gates. Fictional local map polygons are not overlaid on arbitrary properties.

Verified locally on 5 October 2026: all 147 web unit tests across 16 files passed; targeted lint, TypeScript and the production build passed. Fieldwork tests cover dates, coordinates, provider/leg validation, originless legs, scheduled-finish-based planned arrival, interpolation, ordered sections and attributed/bounded context. Browser smoke checks cover matching customer/property/artwork selection, layer panel, keyboard dismissal with focus return, 2D/3D, fit-day, Journey setup state, light/dark appearance and 1440 px/390 px layouts without horizontal overflow. The development basemap reports missing optional POI sprites; roads and buildings render, but these provider warnings are not a clean-console guarantee. Live provider, production account, database/RLS and real reference dataset smoke tests remain release prerequisites.

The integration is in the local main-project checkout only. It has not been committed, pushed or deployed: the checkout also contains substantial earlier uncommitted feature work which has been preserved, not bundled into an unreviewed release.

Release with the existing application; no RICS form/template changes. Existing local work is preserved. No automatic source enablement, provider purchase, payment activation or database write is performed by this integration.
