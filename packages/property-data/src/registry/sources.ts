import type { UkCountry } from "@surveynt/domain";
import type { InformationClass, LicenceSnapshot } from "../contract";

// Machine-readable mirror of docs/property-intelligence/source-register.md.
// `registerStatus` records desk verification only. Runtime enablement is
// decided by reference.data_sources (operator-controlled, default disabled).

export const registerStatuses = ["verified", "pending", "blocked"] as const;
export type RegisterStatus = (typeof registerStatuses)[number];

export const sourceCategories = ["identity", "planning", "energy", "heritage", "land", "flood", "geology", "environment", "mining", "history"] as const;
export type SourceCategory = (typeof sourceCategories)[number];

export type SourceDefinition = {
  key: string;
  name: string;
  organisation: string;
  category: SourceCategory;
  use: string;
  documentationUrl: string;
  accessUrls: string[];
  accessMethod: "api" | "bulk_import";
  accessRequirements: string;
  licence: LicenceSnapshot;
  coverage: UkCountry[];
  coverageNotes: string;
  informationClass: InformationClass;
  registerStatus: RegisterStatus;
  checkedAt: string;
  /** Proposed application cache/import check cadence. These are not source publication frequencies. */
  refreshPolicy: { kind: "cache_ttl" | "release_check"; days: number };
  guardrail: string;
};

const ogl = (attribution: string, restrictions: string[] = []): LicenceSnapshot => ({ name: "Open Government Licence v3.0", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", attribution, restrictions });
const checkedAt = "2026-10-01";
const gb: UkCountry[] = ["ENG", "WLS", "SCT"];

export const sourceDefinitions: readonly SourceDefinition[] = [
  {
    key: "os_open_uprn", name: "OS Open UPRN", organisation: "Ordnance Survey", category: "identity",
    use: "UPRN point coordinates for candidate search", documentationUrl: "https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn",
    accessUrls: ["https://osdatahub.os.uk/downloads/open/OpenUPRN"], accessMethod: "bulk_import", accessRequirements: "Free download; no API key reported for OpenData downloads.",
    licence: ogl("Contains OS data © Crown copyright and database right {year}."), coverage: gb, coverageNotes: "Great Britain only; Northern Ireland is not covered.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 42 },
    guardrail: "Contains no addresses. A nearby UPRN point never establishes identity; surveyor confirmation with evidence is required.",
  },
  {
    key: "postcodes_io", name: "Postcodes.io", organisation: "Ideal Postcodes (open source) using ONS data", category: "identity",
    use: "Postcode validation, centroid and administrative geography", documentationUrl: "https://postcodes.io/docs/licences/",
    accessUrls: ["https://api.postcodes.io"], accessMethod: "api", accessRequirements: "Public API without a key; self-hosting supported (MIT).",
    licence: { name: "Open Government Licence v3.0 (ONSPD and related products)", url: "https://postcodes.io/docs/licences/", attribution: "Contains OS data © Crown copyright and database right. Contains Royal Mail data © Royal Mail copyright and database right. Source: Office for National Statistics licensed under the Open Government Licence v3.0.", restrictions: ["Northern Ireland postcode data requires Land & Property Services terms for commercial use beyond internal business use."] },
    coverage: ["ENG", "WLS", "SCT"], coverageNotes: "Northern Ireland lookups disabled pending LPS licence confirmation.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "cache_ttl", days: 30 },
    guardrail: "A postcode centroid is approximate and never becomes a building point or UPRN match.",
  },
  {
    key: "nominatim", name: "Nominatim (OpenStreetMap)", organisation: "OpenStreetMap Foundation or self-hosted operator", category: "identity",
    use: "Explicit submitted address and place search", documentationUrl: "https://operations.osmfoundation.org/policies/nominatim/",
    accessUrls: ["configured via NOMINATIM_BASE_URL"], accessMethod: "api", accessRequirements: "Usage policy: ≤1 request/second per application, no autocomplete, identifying User-Agent, caching. Self-hosting recommended for production.",
    licence: { name: "Open Database License (ODbL) 1.0", url: "https://www.openstreetmap.org/copyright", attribution: "© OpenStreetMap contributors", restrictions: ["Community-maintained; completeness varies."] },
    coverage: ["ENG", "WLS", "SCT", "NIR"], coverageNotes: "Global community data; UK completeness varies.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "cache_ttl", days: 30 },
    guardrail: "Submit-only search with deployment-wide throttling. Never autocomplete.",
  },
  {
    key: "planning_data", name: "Planning Data", organisation: "Ministry of Housing, Communities and Local Government", category: "planning",
    use: "Planning constraints and records intersecting the property point", documentationUrl: "https://www.planning.data.gov.uk/docs",
    accessUrls: ["https://www.planning.data.gov.uk/entity.json", "https://www.planning.data.gov.uk/openapi.json"], accessMethod: "api", accessRequirements: "Public API without a key.",
    licence: ogl("Contains public sector information licensed under the Open Government Licence v3.0. Some datasets include Historic England and Ordnance Survey data.", ["Licence and attribution vary per dataset; recorded per snapshot."]),
    coverage: ["ENG"], coverageNotes: "Coverage varies by dataset and local planning authority.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "cache_ttl", days: 7 },
    guardrail: "No returned entity means no record in the queried datasets, never that no constraint exists.",
  },
  {
    key: "epc_england_wales", name: "Energy Performance of Buildings data", organisation: "Ministry of Housing, Communities and Local Government", category: "energy",
    use: "Recorded energy rating and building characteristics", documentationUrl: "https://get-energy-performance-data.communities.gov.uk/guidance/energy-certificate-data-apis",
    accessUrls: ["https://get-energy-performance-data.communities.gov.uk/"], accessMethod: "api", accessRequirements: "Registered account and credentials; authentication scheme to confirm on the guidance page.",
    licence: ogl("Contains public sector information licensed under the Open Government Licence v3.0.", ["Address fields carry separate restrictions; do not republish addresses."]),
    coverage: ["ENG", "WLS"], coverageNotes: "Lodged certificates only; may be expired or superseded.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "cache_ttl", days: 30 },
    guardrail: "EPC record: verify during inspection. Prefer exact UPRN; show ambiguous candidates for confirmation.",
  },
  {
    key: "historic_england_nhle", name: "National Heritage List for England", organisation: "Historic England", category: "heritage",
    use: "Listed buildings, scheduled monuments, registered parks and gardens, battlefields, World Heritage Sites", documentationUrl: "https://historicengland.org.uk/listing/the-list/data-downloads/",
    accessUrls: ["https://opendata-historicengland.hub.arcgis.com/"], accessMethod: "bulk_import", accessRequirements: "Open Data Hub downloads; read hub terms.",
    licence: ogl("Contains Historic England data © Historic England {year}. Contains Ordnance Survey data © Crown copyright and database right {year}."),
    coverage: ["ENG"], coverageNotes: "England only. Conservation areas are not part of the NHLE.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 30 },
    guardrail: "Never apply England heritage coverage to Wales.",
  },
  {
    key: "hmlr_inspire", name: "INSPIRE Index Polygons", organisation: "HM Land Registry", category: "land",
    use: "Indicative registered freehold extent", documentationUrl: "https://use-land-property-data.service.gov.uk/datasets/inspire",
    accessUrls: ["https://use-land-property-data.service.gov.uk/datasets/inspire"], accessMethod: "bulk_import", accessRequirements: "Per-local-authority GML download.",
    licence: ogl("This information is subject to Crown copyright and database rights {year} and is reproduced with the permission of HM Land Registry. The polygons (including the associated geometry, namely x, y co-ordinates) are subject to Crown copyright and database rights {year} Ordnance Survey AC0000851063.", ["Link to https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions where possible."]),
    coverage: ["ENG", "WLS"], coverageNotes: "Registered freehold only.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 30 },
    guardrail: "Indicative registered extent, not a legal boundary, ownership record or title search.",
  },
  {
    key: "ea_flood_zones", name: "Flood Map for Planning: Flood Zones", organisation: "Environment Agency", category: "flood",
    use: "Planning flood zones 2 and 3", documentationUrl: "https://environment.data.gov.uk/",
    accessUrls: ["https://environment.data.gov.uk/"], accessMethod: "bulk_import", accessRequirements: "Bulk download from the Defra Data Services Platform.",
    licence: ogl("© Environment Agency copyright and/or database right {year}. All rights reserved."), coverage: ["ENG"], coverageNotes: "England only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 90 },
    guardrail: "Planning zones, not property flood risk. Not intersecting is not proof of no flood risk.",
  },
  {
    key: "ea_rofsw", name: "Risk of Flooding from Surface Water", organisation: "Environment Agency", category: "flood",
    use: "Surface water flood risk context", documentationUrl: "https://environment.data.gov.uk/",
    accessUrls: ["https://environment.data.gov.uk/"], accessMethod: "bulk_import", accessRequirements: "Bulk download.",
    licence: ogl("© Environment Agency copyright and/or database right {year}. All rights reserved."), coverage: ["ENG"], coverageNotes: "England only.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 90 },
    guardrail: "Kept separate from planning flood zones.",
  },
  {
    key: "bgs_geology_625k", name: "BGS Geology 625k", organisation: "British Geological Survey", category: "geology",
    use: "Mapped bedrock and superficial geology context", documentationUrl: "https://www.bgs.ac.uk/",
    accessUrls: ["https://www.bgs.ac.uk/"], accessMethod: "bulk_import", accessRequirements: "Download; product page to confirm.",
    licence: ogl("Contains British Geological Survey materials © UKRI {year}."), coverage: gb, coverageNotes: "Great Britain at 1:625 000 scale.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 180 },
    guardrail: "Mapped geology requires interpretation; no structural safety claims.",
  },
  {
    key: "bgs_geology_50k", name: "BGS Geology 50k", organisation: "British Geological Survey", category: "geology",
    use: "Detailed mapped geology", documentationUrl: "https://www.bgs.ac.uk/datasets/bgs-geology-50k-digmapgb/",
    accessUrls: [], accessMethod: "bulk_import", accessRequirements: "Commercial licence fees reported.",
    licence: { name: "Commercial licence (unconfirmed)", url: null, attribution: "", restrictions: ["Commercial use reportedly licensed per km²."] }, coverage: gb, coverageNotes: "Most of Great Britain.",
    informationClass: "indicative_external", registerStatus: "blocked", checkedAt, refreshPolicy: { kind: "release_check", days: 180 },
    guardrail: "Do not ingest until commercial-use terms are confirmed in writing.",
  },
  {
    key: "ne_designations", name: "Natural England designations", organisation: "Natural England", category: "environment",
    use: "SSSI, SAC, SPA, Ramsar, NNR, National Landscapes, National Parks and Ancient Woodland context", documentationUrl: "https://naturalengland-defra.opendata.arcgis.com/",
    accessUrls: ["https://naturalengland-defra.opendata.arcgis.com/"], accessMethod: "bulk_import", accessRequirements: "Per-layer download; check third-party restrictions.",
    licence: ogl("© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right {year}."), coverage: ["ENG"], coverageNotes: "England only; import named layers individually.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 90 },
    guardrail: "Never import all MAGIC layers indiscriminately.",
  },
  {
    key: "mra_coal_reporting_area", name: "Coal mining reporting area", organisation: "Mining Remediation Authority", category: "mining",
    use: "Coalfield reporting area context", documentationUrl: "https://www.gov.uk/guidance/access-coal-mining-information-and-data",
    accessUrls: [], accessMethod: "bulk_import", accessRequirements: "OGL subject to a public-task re-use restriction.",
    licence: ogl("Contains Mining Remediation Authority data © Mining Remediation Authority.", ["Re-use is not permitted for activities that form part of the Authority's public task."]), coverage: gb, coverageNotes: "Coalfield areas.",
    informationClass: "indicative_external", registerStatus: "blocked", checkedAt, refreshPolicy: { kind: "release_check", days: 90 },
    guardrail: "Legal review required. Contextual information is never a formal mining search.",
  },
  {
    key: "hmlr_price_paid", name: "Price Paid Data", organisation: "HM Land Registry", category: "history",
    use: "Residential sales history", documentationUrl: "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
    accessUrls: ["https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads"], accessMethod: "bulk_import", accessRequirements: "Monthly CSV with add/change/delete records.",
    licence: ogl("Contains HM Land Registry data © Crown copyright and database right {year}. This data is licensed under the Open Government Licence v3.0.", ["Address data (AddressBase/PAF) is restricted; Surveynt stores no Price Paid address fields."]), coverage: ["ENG", "WLS"], coverageNotes: "Registered sales; some categories excluded.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 31 },
    guardrail: "Sales link only through the published transaction-to-UPRN lookup.",
  },
  {
    key: "hmlr_ppd_uprn_lookup", name: "Transaction unique identifier and UPRN look-up", organisation: "HM Land Registry", category: "history",
    use: "Exact transaction-to-UPRN linkage", documentationUrl: "https://www.gov.uk/government/statistical-data-sets/transaction-unique-identifier-and-uprn-look-up-table-dataset",
    accessUrls: ["https://www.gov.uk/government/statistical-data-sets/technical-specification-transaction-unique-identifier-and-uprn-look-up-table-dataset"], accessMethod: "bulk_import", accessRequirements: "Monthly CSV published from 28 August 2026.",
    licence: ogl("Contains HM Land Registry data © Crown copyright and database right {year}. This data is licensed under the Open Government Licence v3.0."), coverage: ["ENG", "WLS"], coverageNotes: "Some transactions (notably land and garages) have no UPRN.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 31 },
    guardrail: "A missing link means not linked, never no sales.",
  },
  {
    key: "nrw_flood_map_planning", name: "Flood Map for Planning (Wales)", organisation: "Natural Resources Wales", category: "flood",
    use: "Welsh planning flood zones", documentationUrl: "https://naturalresources.wales/flooding/flood-map-for-planning/?lang=en",
    accessUrls: ["https://datamap.gov.wales/layergroups/inspire-nrw:FloodMapforPlanningFloodZones2and3"], accessMethod: "bulk_import", accessRequirements: "DataMapWales download.",
    licence: ogl("Contains Natural Resources Wales information © Natural Resources Wales and database right."), coverage: ["WLS"], coverageNotes: "Wales only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 90 },
    guardrail: "Never substitute Environment Agency data for Wales.",
  },
  {
    key: "cadw_listed_buildings", name: "Cadw listed buildings", organisation: "Cadw", category: "heritage",
    use: "Welsh listed building records", documentationUrl: "https://cadw.gov.wales/advice-support/cof-cymru/downloads",
    accessUrls: ["https://datamap.gov.wales/layers/inspire-wg:Cadw_ListedBuildings"], accessMethod: "bulk_import", accessRequirements: "DataMapWales download; licence to confirm.",
    licence: ogl("Contains Cadw data © Crown copyright."), coverage: ["WLS"], coverageNotes: "Wales only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 30 },
    guardrail: "Licence terms unconfirmed.",
  },
  {
    key: "hes_designations", name: "Historic Environment Scotland designations", organisation: "Historic Environment Scotland", category: "heritage",
    use: "Scottish listed buildings, scheduled monuments and conservation areas", documentationUrl: "https://portal.historicenvironment.scot/spatialdownloads",
    accessUrls: ["https://portal.historicenvironment.scot/spatialdownloads"], accessMethod: "bulk_import", accessRequirements: "Atom feed / WFS download.",
    licence: ogl("Contains Historic Environment Scotland and Ordnance Survey data © Historic Environment Scotland © Crown copyright and database right {year}."), coverage: ["SCT"], coverageNotes: "Scotland only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 30 },
    guardrail: "Scottish designations only.",
  },
  {
    key: "scottish_epc", name: "Scottish EPC Register extracts", organisation: "Scottish Government", category: "energy",
    use: "Recorded energy ratings in Scotland", documentationUrl: "https://statistics.gov.scot/data/domestic-energy-performance-certificates",
    accessUrls: ["https://statistics.gov.scot/data/domestic-energy-performance-certificates"], accessMethod: "bulk_import", accessRequirements: "Quarterly CSV.",
    licence: ogl("Contains public sector information licensed under the Open Government Licence v3.0.", ["Address data requires a Royal Mail licence; not stored."]), coverage: ["SCT"], coverageNotes: "Scotland only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 92 },
    guardrail: "No address republication; matching approach to be confirmed.",
  },
  {
    key: "sepa_flood_maps", name: "SEPA flood maps", organisation: "Scottish Environment Protection Agency", category: "flood",
    use: "Scottish river, coastal and surface water flood likelihood", documentationUrl: "https://www.sepa.org.uk/environment/environmental-data/",
    accessUrls: ["https://www.sepa.org.uk/environment/environmental-data/"], accessMethod: "bulk_import", accessRequirements: "Data publication download; confirm terms with SEPA.",
    licence: ogl("Contains SEPA data © Scottish Environment Protection Agency and database right {year}.", ["Viewer prints and copies are restricted; only the published GIS datasets may be used."]), coverage: ["SCT"], coverageNotes: "Scotland only.",
    informationClass: "indicative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 180 },
    guardrail: "Never substitute EA or NRW data for Scotland. Flood maps show likelihood, not property flood risk.",
  },
  {
    key: "ni_epc", name: "Northern Ireland energy performance certificates", organisation: "Department of Finance (NI)", category: "energy",
    use: "Recorded energy ratings in Northern Ireland", documentationUrl: "https://www.finance-ni.gov.uk/",
    accessUrls: [], accessMethod: "bulk_import", accessRequirements: "No open API or bulk data identified.",
    licence: { name: "Not available", url: null, attribution: "", restrictions: ["No open publication identified."] }, coverage: ["NIR"], coverageNotes: "Not available.",
    informationClass: "authoritative_external", registerStatus: "blocked", checkedAt, refreshPolicy: { kind: "release_check", days: 365 },
    guardrail: "Keep unsupported and say so; never use England and Wales EPC data for Northern Ireland.",
  },
  {
    key: "ni_pointer", name: "Pointer (Northern Ireland addresses)", organisation: "Land & Property Services / OSNI", category: "identity",
    use: "Authoritative Northern Ireland addresses", documentationUrl: "https://www.finance-ni.gov.uk/publications/digital-application-forms-use-lps-intellectual-property",
    accessUrls: [], accessMethod: "bulk_import", accessRequirements: "Commercial LPS licence.",
    licence: { name: "LPS licence required", url: null, attribution: "", restrictions: ["Not licensed for this use."] }, coverage: ["NIR"], coverageNotes: "Not licensed.",
    informationClass: "authoritative_external", registerStatus: "blocked", checkedAt, refreshPolicy: { kind: "release_check", days: 365 },
    guardrail: "Northern Ireland address resolution stays unsupported until a licence is in place; OS Open UPRN does not cover Northern Ireland.",
  },
  {
    key: "ni_hed_listed_buildings", name: "Listed Buildings Northern Ireland", organisation: "Department for Communities, Historic Environment Division", category: "heritage",
    use: "Northern Ireland listed building records", documentationUrl: "https://www.opendatani.gov.uk/dataset/listed-buildings-northern-ireland",
    accessUrls: ["https://www.opendatani.gov.uk/dataset/listed-buildings-northern-ireland"], accessMethod: "bulk_import", accessRequirements: "OpenDataNI download.",
    licence: ogl("Contains public sector information licensed under the Open Government Licence v3.0."), coverage: ["NIR"], coverageNotes: "Northern Ireland only.",
    informationClass: "authoritative_external", registerStatus: "pending", checkedAt, refreshPolicy: { kind: "release_check", days: 30 },
    guardrail: "Northern Ireland designations only.",
  },
];

export function getSourceDefinition(key: string) {
  return sourceDefinitions.find((source) => source.key === key) ?? null;
}

/** Whether a source's published coverage includes the property's country. Unknown countries are never assumed covered. */
export function sourceCoversCountry(source: SourceDefinition, country: UkCountry | null) {
  return country !== null && source.coverage.includes(country);
}
