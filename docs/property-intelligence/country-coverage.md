# Country coverage

Generated from the source registry and provider list by `pnpm --filter @surveynt/property-data coverage`. A test fails if this file is out of date.

A ✓ means the source covers the country. A source is used only after an operator has verified and enabled it; "pending" and "blocked" sources are disabled. A property outside a source's coverage gets "not covered" for it, never "no record".

| Source | Publisher | Register | ENG | WLS | SCT | NIR | Used for |
|---|---|---|---|---|---|---|---|
| `os_open_uprn` OS Open UPRN | Ordnance Survey | pending | ✓ | ✓ | ✓ | — | address and UPRN identity |
| `postcodes_io` Postcodes.io | Ideal Postcodes (open source) using ONS data | pending | ✓ | ✓ | ✓ | — | address and UPRN identity |
| `nominatim` Nominatim (OpenStreetMap) | OpenStreetMap Foundation or self-hosted operator | pending | ✓ | ✓ | ✓ | ✓ | address and UPRN identity |
| `planning_data` Planning Data | Ministry of Housing, Communities and Local Government | pending | ✓ | — | — | — | enrichment |
| `epc_england_wales` Energy Performance of Buildings data | Ministry of Housing, Communities and Local Government | pending | ✓ | ✓ | — | — | enrichment |
| `historic_england_nhle` National Heritage List for England | Historic England | pending | ✓ | — | — | — | enrichment |
| `hmlr_inspire` INSPIRE Index Polygons | HM Land Registry | pending | ✓ | ✓ | — | — | enrichment |
| `ea_flood_zones` Flood Map for Planning: Flood Zones | Environment Agency | pending | ✓ | — | — | — | enrichment |
| `ea_rofsw` Risk of Flooding from Surface Water | Environment Agency | pending | ✓ | — | — | — | enrichment |
| `bgs_geology_625k` BGS Geology 625k | British Geological Survey | pending | ✓ | ✓ | ✓ | — | enrichment |
| `bgs_geology_50k` BGS Geology 50k | British Geological Survey | blocked | ✓ | ✓ | ✓ | — | no (blocked) |
| `ne_designations` Natural England designations | Natural England | pending | ✓ | — | — | — | enrichment |
| `mra_coal_reporting_area` Coal mining reporting area | Mining Remediation Authority | blocked | ✓ | ✓ | ✓ | — | no (blocked) |
| `hmlr_price_paid` Price Paid Data | HM Land Registry | pending | ✓ | ✓ | — | — | enrichment |
| `hmlr_ppd_uprn_lookup` Transaction unique identifier and UPRN look-up | HM Land Registry | pending | ✓ | ✓ | — | — | with Price Paid |
| `nrw_flood_map_planning` Flood Map for Planning (Wales) | Natural Resources Wales | pending | — | ✓ | — | — | enrichment |
| `cadw_listed_buildings` Cadw listed buildings | Cadw | pending | — | ✓ | — | — | enrichment |
| `hes_designations` Historic Environment Scotland designations | Historic Environment Scotland | pending | — | — | ✓ | — | enrichment |
| `scottish_epc` Scottish EPC Register extracts | Scottish Government | pending | — | — | ✓ | — | enrichment |
| `sepa_flood_maps` SEPA flood maps | Scottish Environment Protection Agency | pending | — | — | ✓ | — | enrichment |
| `ni_epc` Northern Ireland energy performance certificates | Department of Finance (NI) | blocked | — | — | — | ✓ | no (blocked) |
| `ni_pointer` Pointer (Northern Ireland addresses) | Land & Property Services / OSNI | blocked | — | — | — | ✓ | no (blocked) |
| `ni_hed_listed_buildings` Listed Buildings Northern Ireland | Department for Communities, Historic Environment Division | pending | — | — | — | ✓ | enrichment |

## England

Sources covering England: 15 of 23.

- Most national datasets are England-only; each is used only for properties recorded as in England.

## Wales

Sources covering Wales: 12 of 23.

- Natural Resources Wales flood zones and Cadw listings are used for Welsh properties. Environment Agency and Historic England data are never substituted.
- EPC, Price Paid, INSPIRE and OS Open UPRN cover England and Wales or Great Britain.

## Scotland

Sources covering Scotland: 9 of 23.

- Historic Environment Scotland designations, SEPA flood maps and the Scottish EPC Register are used for Scottish properties. England and Wales EPC data is never used.
- Price Paid and INSPIRE do not cover Scotland; Registers of Scotland data is not integrated.

## Northern Ireland

Sources covering Northern Ireland: 4 of 23.

- Authoritative address resolution is **unsupported**: OS Open UPRN covers Great Britain only, Pointer is not licensed, and postcodes.io lookups for BT postcodes stay disabled until the Land & Property Services terms are confirmed.
- Energy certificates are **unsupported**: no open publication was identified.
- Listed buildings come from the Historic Environment Division only once imported. All other land, flood and history sources report "not covered".
