# Source register

Checked: **2026-10-01**. Every source's licence, coverage, access and attribution must be re-checked against the official page before it is enabled. The machine-readable copy lives in `packages/property-data/src/registry/sources.ts` and is seeded into `reference.data_sources` with `enabled = false`.

## Status meanings

| Status | Meaning | Effect |
|---|---|---|
| **verified** | An operator read the official page from a permitted environment and recorded the date, licence and attribution here | May be enabled once credentials or imports are in place |
| **pending** | Facts were corroborated from secondary or search sources only. The official host was not reachable from the build environment (egress policy, see [`architecture.md`](./architecture.md#known-environment-constraint-p0)) | Code may exist; the source stays **disabled** |
| **blocked** | Licence terms appear to prohibit the intended use, require a paid or commercial licence, or no permitted source has been identified | No ingestion; the UI shows "Not available" |

**No source is `verified` at P0.** Brief claims are planning inputs, not facts.

## Property identity

| Key | Source and use | Official URLs | Access | Licence and attribution | Coverage | Status | Notes and guardrails |
|---|---|---|---|---|---|---|---|
| `os_open_uprn` | OS Open UPRN: UPRN point coordinates for candidate search | https://osdatahub.os.uk/downloads/open/OpenUPRN · https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn | Free download (CSV, GeoPackage); no key reported for OpenData downloads | OGL v3. Attribution: "Contains OS data © Crown copyright and database right {year}" (confirm exact wording) | Great Britain only (not NI) | pending | Contains **no addresses**. A nearest UPRN point never establishes identity; surveyor confirmation is required. Import only a regional extract until benchmarked. |
| `postcodes_io` | Postcodes.io: postcode validation, centroid and admin geography | https://postcodes.io/docs/licences/ · https://postcodes.io | Public API, no key; self-hostable (MIT) | Software MIT. Data derived from ONS Postcode Directory and related OGL products. **NI (BT) postcodes**: internal business use under the NI End User Licence; other commercial use needs a Land & Property Services licence | UK (NI restricted) | pending | Centroids are approximate and never yield a high-confidence UPRN. NI lookups stay disabled until LPS terms are confirmed for this use. |
| `nominatim` | OSM Nominatim: submitted address/place search and reverse lookup | https://operations.osmfoundation.org/policies/nominatim/ | Public server under the usage policy, or a self-hosted or commercial instance | ODbL. Attribution: "© OpenStreetMap contributors" | Global, completeness varies | pending | Policy (search corroborated): **≤1 request/second in total per application**, no autocomplete, an identifying User-Agent/Referer, cache results, no bulk geocoding. Surveynt sends explicit submits only, throttles deployment-wide and caches. The base URL is configurable, and self-hosting is recommended for production (an operating cost). |

## Core intelligence (P2)

| Key | Source and use | Official URLs | Access | Licence and attribution | Coverage | Status | Notes and guardrails |
|---|---|---|---|---|---|---|---|
| `planning_data` | Planning Data platform (MHCLG): spatial constraints and planning entities | https://www.planning.data.gov.uk/docs · https://www.planning.data.gov.uk/openapi.json · https://www.planning.data.gov.uk/dataset/ | Public API, no key. `GET /entity.json?longitude=&latitude=&dataset=` (point intersects by default) | Per dataset, mostly OGL v3. Some datasets carry additional attribution (Historic England, Ordnance Survey) | England; **coverage varies by dataset and local planning authority** (for example, tree-preservation-zone data comes from a small group of LPAs) | pending | No returned entity means "No record found in the queried datasets", never "no constraint". Validate the dataset list against `/dataset/` and record per-dataset licence text in each snapshot. |
| `epc_england_wales` | Energy Performance of Buildings data (MHCLG): EPC rating and recorded characteristics | https://get-energy-performance-data.communities.gov.uk/ · guidance: https://get-energy-performance-data.communities.gov.uk/guidance/energy-certificate-data-apis | Registered account. The old `epc.opendatacommunities.org` service was **retired 30 May 2026**. Auth scheme to confirm (older API: HTTP Basic with email + API key; new service references an authentication token) | Non-address fields reported OGL; address fields subject to separate restrictions (confirm on the guidance page) | England & Wales (certificates since 2008/2012; may be expired or superseded) | pending | Prefer exact UPRN filtering (`uprn=` reported). Show ambiguous address candidates for confirmation. EPC fields are "recorded data, verify during inspection". Do not republish addresses. |
| `historic_england_nhle` | Historic England National Heritage List for England: listed buildings, scheduled monuments, registered parks and gardens, battlefields, World Heritage Sites, protected wrecks | https://historicengland.org.uk/listing/the-list/data-downloads/ · https://opendata-historicengland.hub.arcgis.com/ | Open Data Hub downloads and feature services | OGL (licence PDF included with each dataset; read the Hub terms and disclaimers) | England only | pending | **Conservation areas are local-authority designations, not NHLE.** Use the Planning Data `conservation-area` dataset, with its coverage caveat. Never apply England coverage to Wales. |

## Land and environment (P3)

| Key | Source and use | Official URLs | Access | Licence and attribution | Coverage | Status | Notes and guardrails |
|---|---|---|---|---|---|---|---|
| `hmlr_inspire` | HM Land Registry INSPIRE Index Polygons: indicative registered freehold extent | https://use-land-property-data.service.gov.uk/datasets/inspire | Download per local authority (GML) via the Use land and property data service (account may be required) | OGL. Required attribution: "This information is subject to Crown copyright and database rights {year} and is reproduced with the permission of HM Land Registry." plus "The polygons (including the associated geometry, namely x, y co-ordinates) are subject to Crown copyright and database rights {year} Ordnance Survey AC0000851063." Link to https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions | England & Wales, registered freehold only | pending | **Indicative extent, not a legal boundary, ownership record or title search.** Leasehold is not covered. |
| `ea_flood_zones` | Environment Agency Flood Map for Planning, Flood Zones 2 and 3 (NaFRA2-based, published 25 Mar 2025) | https://environment.data.gov.uk/ (Defra Data Services Platform) · https://www.data.gov.uk/dataset/cf494c44-05cd-4060-a029-35937970c9c6/flood-map-for-planning-rivers-and-sea-flood-zone-2 | Bulk download | OGL (confirm per dataset) | England only | pending | Planning zones, **not** property risk. Not intersecting is not proof of no flood risk. |
| `ea_rofsw` | EA Risk of Flooding from Surface Water (NaFRA2) | https://environment.data.gov.uk/ | Bulk download | OGL indicated (confirm) | England only | pending | Kept separate from planning zones and rivers/sea risk. |
| `ea_rofrs` | EA Risk of Flooding from Rivers and Sea (NaFRA2) | https://environment.data.gov.uk/ | Bulk download | OGL indicated (confirm) | England only | pending | As above. |
| `bgs_geology_625k` | BGS Geology 625k (DiGMapGB-625): mapped bedrock and superficial geology context | https://www.bgs.ac.uk/ (dataset page to confirm) | Download | OGL reported for the 1:625 000 product (confirm) | Great Britain | pending | Mapped geology requires interpretation. No structural safety claims. |
| `bgs_geology_50k` | BGS Geology 50k (DiGMapGB-50) | https://www.bgs.ac.uk/datasets/bgs-geology-50k-digmapgb/ | Licence | Conflicting statements: "Open / Premium", **commercial licence £0.22–0.23/km²** reported | Most of GB | **blocked** | Do not ingest until the commercial-use terms are confirmed in writing. |
| `bgs_hazards` | BGS GeoSure and other hazard products | https://www.bgs.ac.uk/ | Paid | Commercial | GB | **blocked** | Paid or restricted products are out of scope. |
| `ne_designations` | Natural England: SSSI, SAC, SPA, Ramsar, NNR, National Landscapes, National Parks, Ancient Woodland | https://naturalengland-defra.opendata.arcgis.com/ · e.g. https://environment.data.gov.uk/dataset/ba8dc201-66ef-4983-9d46-7378af21027e (SSSI) | Download / feature services | "OGL v3 except where otherwise stated": check each layer for third-party restrictions | England only | pending | Import named layers individually; never import every MAGIC layer. |
| `mra_coal_reporting_area`, `mra_development_high_risk_area` | Mining Remediation Authority (formerly the Coal Authority): coalfield reporting area and development high-risk area | https://www.gov.uk/guidance/access-coal-mining-information-and-data · https://ckan.publishing.service.gov.uk/dataset/coal-development-high-risk-area | View and download services | OGL **subject to an overriding condition: re-use is not permitted for activities that are part of the Authority's public task** (mining reports) | Coalfield areas of GB | **blocked** | Needs legal review of whether survey-report context conflicts with the public-task restriction. Contextual information is never a formal mining search. |

## Property history (P4)

| Key | Source and use | Official URLs | Access | Licence and attribution | Coverage | Status | Notes and guardrails |
|---|---|---|---|---|---|---|---|
| `hmlr_price_paid` | HMLR Price Paid Data: sales | https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads | Monthly CSV (A/C/D record status) | OGL, **but address data (AddressBase/PAF) is limited to personal/non-commercial use and display for residential property price information services**; other uses need Royal Mail permission | England & Wales, standard and additional price-paid categories | pending | Store transaction ID, price, date, property type, new-build flag, tenure and category only. **Do not store or republish PPD address fields.** |
| `hmlr_ppd_uprn_lookup` | HMLR Transaction unique identifier ↔ UPRN look-up table | https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-uprn-look-up-table-dataset · spec: https://www.gov.uk/government/statistical-data-sets/technical-specification-transaction-unique-identifier-and-uprn-look-up-table-dataset · news: https://www.gov.uk/government/news/hm-land-registry-to-provide-property-identifiers-for-price-paid-data-from-28-august | Monthly CSV, published from **28 Aug 2026** | OGL v3 (reported) | England & Wales; independent analysis reports about 6% of sales without a UPRN, with land and garages unmatched far more often | pending | **The brief's claimed lookup exists** (per search). The technical specification lists two fields, Transaction unique identifier and UPRN (search summary, 2 Oct 2026; the page itself is blocked here). One sale may map to several UPRNs. Link sales only by exact transaction ID ↔ UPRN. A missing link means "not linked", not "no sales". |
| `hmlr_ppd_inspire_lookup` | Transaction ↔ INSPIRE ID look-up | https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-inspire-id-look-up-table-dataset | Monthly CSV | OGL v3 (reported) | England & Wales | pending | Optional context only. |

## Country-specific (P6)

| Key | Source and use | Official URLs | Access | Licence and attribution | Coverage | Status | Notes and guardrails |
|---|---|---|---|---|---|---|---|
| `nrw_flood_map_planning` | Natural Resources Wales Flood Map for Planning | https://naturalresources.wales/flooding/flood-map-for-planning/?lang=en · https://datamap.gov.wales/layergroups/inspire-nrw:FloodMapforPlanningFloodZones2and3 | DataMapWales download / WFS | OGL (DataMapWales) | Wales | pending | Welsh planning zones; never substitute EA data. |
| `cadw_listed_buildings` | Cadw listed buildings | https://datamap.gov.wales/layers/inspire-wg:Cadw_ListedBuildings · https://cadw.gov.wales/advice-support/cof-cymru/downloads | DataMapWales | Licence to confirm (DataMapWales states OGL; NRW metadata describes Cadw data as third-party supplied) | Wales | pending | |
| `hes_designations` | Historic Environment Scotland: listed buildings, scheduled monuments, conservation areas, gardens and designed landscapes, battlefields, World Heritage Sites | https://portal.historicenvironment.scot/spatialdownloads | Atom feed / WFS download | OGL v3 | Scotland | pending | Updated daily. |
| `scottish_epc` | Scottish EPC Register extracts | https://statistics.gov.scot/data/domestic-energy-performance-certificates · https://www.scottishepcregister.org.uk/CustomerFacingPortal/DataExtract | Quarterly bulk CSV | Non-address data OGL v3; **address data needs a Royal Mail licence** | Scotland | pending | No address republication. Matching approach to be designed (UPRN availability to confirm). |
| `sepa_flood_maps` | SEPA flood hazard maps | https://www.sepa.org.uk/environment/environmental-data/ | Data publication downloads | GIS datasets reported OGL; prints and copies from the viewer are restricted | Scotland | pending | Confirm terms with SEPA before enabling. |
| `ni_hed_listed_buildings` | DfC Historic Environment Division listed buildings | https://www.opendatani.gov.uk/dataset/listed-buildings-northern-ireland | OpenDataNI download | OGL | Northern Ireland | pending | Updated monthly. |
| `ni_epc` | Northern Ireland EPCs | https://www.finance-ni.gov.uk/ (FOI DOF/2026-0254) | No open API/bulk data identified | — | NI | **blocked** | Keep unsupported and explicit. |
| `ni_pointer` | LPS/OSNI Pointer addresses | https://www.finance-ni.gov.uk/publications/digital-application-forms-use-lps-intellectual-property | Commercial licence | LPS licence | NI | **blocked** | NI authoritative address resolution stays unsupported; OS Open UPRN does not cover NI. |

## Map basemap

| Key | Use | Status | Notes |
|---|---|---|---|
| `basemap` | MapLibre basemap style/tiles | **blocked (provider not chosen)** | OSM's own tile servers are not for production commercial traffic (heavy use is prohibited by the tile usage policy). Configure `NEXT_PUBLIC_MAP_STYLE_URL` with a contracted provider or self-hosted tiles. Without it the map shows a "Basemap not configured" state, and data layers still render with their attribution. |

## Governance references

| Reference | URL | Checked | Finding |
|---|---|---|---|
| ICO anonymisation and pseudonymisation guidance | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/ | 2026-10-01 (search) | Final guidance published 28 Mar 2025. Separate draft guidance for research, archiving and statistical purposes is in consultation until 19 Oct 2026. The brief's "under review" note is partly superseded, so re-check before L1. |
| RICS: Responsible use of AI in surveying practice | https://www.rics.org/news-insights/rics-first-ever-standard-on-responsible-ai-use-now-in-effect | 2026-10-01 (search) | **Mandatory since 9 Mar 2026** for RICS members and regulated firms. It covers governance, risk, professional judgement, transparency and client communication, and written records of reliability decisions by a named qualified surveyor. Read the full standard before A6. |

## Search sources used for this register

- https://www.data.gov.uk/dataset/c4f80d19-8cfa-4bf6-a283-83183842f876/os-open-uprn
- https://mhclgdigital.blog.gov.uk/2026/07/09/shaping-the-future-of-open-data-the-new-open-data-communities-service/
- https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-uprn-look-up-table-dataset
- https://github.com/YusufIsmailayo/hmlr-price-paid-uprn-pipeline (third-party coverage analysis)
- https://ideal-postcodes.co.uk/guides/onspd-licensing
- https://environmentagency.blog.gov.uk/2025/01/28/enhancing-flood-and-coastal-erosion-risk-digital-services-with-the-latest-data-and-mapping/
- https://www.owenboswarva.com/opendata/EA/ea_flood_datasets.htm
- https://discuss.okfn.org/t/hm-land-registry-price-paid-data-is-it-open/7995
- https://www.rpclegal.com/snapshots/data-protection/summer-2025/ico-publishes-new-guidance-on-anonymisation-and-pseudonymisation/
- https://vercel.com/docs/vercel-blob/private-storage

---

# England first release production record

The section below is the England release record from `main`, updated with the separately authorised 2 October 2026 production rollout. Its schema (migrations 0006–0008) is the base this branch's migrations build on; see the reconciliation notes in [`architecture.md`](./architecture.md#reconciliation-with-the-england-release).

## Source register

Verified against official documentation and production state on 2 October 2026. A source is enabled only when its required API configuration or an active validated dataset version exists.

| Source | Coverage | Access | Licence / important limitation | Initial state |
| --- | --- | --- | --- | --- |
| [OS Open UPRN](https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn) | Great Britain; initial product use is England | OS Data Hub national CSV/GeoPackage download | OS OpenData. Identifier and coordinates only; not a postal address directory. | Import supported; disabled until an active version exists |
| [Postcodes.io](https://api.postcodes.io/docs/licences/) | GB; initial UI accepts England | Public API | Source-specific OS/Royal Mail/ONS attribution. Centroids are approximate. | Available when the public service responds |
| [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Configured provider coverage | Explicit submitted search only | Public service forbids autocomplete, limits use to 1 request/second and requires identification/caching/attribution. | Production fallback configured with database cache/rate gate |
| [Planning Data](https://www.planning.data.gov.uk/docs) | England, varying by dataset and authority | Public beta API and downloads | OGL v3. Missing records do not establish absence; planning-application coverage remains incomplete. | Enabled |
| [EPC data](https://get-energy-performance-data.communities.gov.uk/) | England and Wales; initial product use is England | Registered developer API | Personal-data and address-field licensing obligations apply. Records may be expired, replaced, opted out or absent. | Disabled until credentials and terms are confirmed |
| [Historic England](https://historicengland.org.uk/listing/the-list/data-downloads) | England | Open Data Hub download/API | OGL for listed datasets; conservation areas are not a complete substitute for local records. | `2026-10-01` active in production |
| [HMLR INSPIRE](https://www.gov.uk/guidance/inspire-index-polygons-spatial-data) | England and Wales; initial product use is England | Use land and property data download | Indicative registered freehold extent only—not a legal boundary, ownership record or complete leasehold search. | Import supported; disabled until active version |
| [EA Flood Map for Planning](https://environment.data.gov.uk/support/faqs/778338325/798130238) | England | Download or OGC API Features | OGL per product. Flood Zones 2 and 3 are planning context and are distinct from surface-water or property-risk products. | Prepared; inactive because current Neon storage limit prevented staging |

Deferred sources: HMLR Price Paid/UPRN history, BGS geology, mining, Natural England-only imports beyond Planning Data, NRW/Cadw, Scotland and Northern Ireland.
