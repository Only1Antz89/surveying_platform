# Source register

Verified against official documentation on 1 October 2026. A source is enabled only when its required API configuration or an active validated dataset version exists.

| Source | Coverage | Access | Licence / important limitation | Initial state |
| --- | --- | --- | --- | --- |
| [OS Open UPRN](https://docs.os.uk/os-downloads/products/addresses-and-names-portfolio/os-open-uprn) | Great Britain; initial product use is England | OS Data Hub national CSV/GeoPackage download | OS OpenData. Identifier and coordinates only; not a postal address directory. | Import supported; disabled until an active version exists |
| [Postcodes.io](https://api.postcodes.io/docs/licences/) | GB; initial UI accepts England | Public API | Source-specific OS/Royal Mail/ONS attribution. Centroids are approximate. | Available when the public service responds |
| [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Configured provider coverage | Explicit submitted search only | Public service forbids autocomplete, limits use to 1 request/second and requires identification/caching/attribution. | Disabled until URL and User-Agent are configured |
| [Planning Data](https://www.planning.data.gov.uk/docs) | England, varying by dataset and authority | Public beta API and downloads | OGL v3. Missing records do not establish absence; planning-application coverage remains incomplete. | Enabled |
| [EPC data](https://get-energy-performance-data.communities.gov.uk/) | England and Wales; initial product use is England | Registered developer API | Personal-data and address-field licensing obligations apply. Records may be expired, replaced, opted out or absent. | Disabled until credentials and terms are confirmed |
| [Historic England](https://historicengland.org.uk/listing/the-list/data-downloads) | England | Open Data Hub download/API | OGL for listed datasets; conservation areas are not a complete substitute for local records. | Import supported; disabled until active version |
| [HMLR INSPIRE](https://www.gov.uk/guidance/inspire-index-polygons-spatial-data) | England and Wales; initial product use is England | Use land and property data download | Indicative registered freehold extent only—not a legal boundary, ownership record or complete leasehold search. | Import supported; disabled until active version |
| [EA Flood Map for Planning](https://environment.data.gov.uk/support/faqs/778338325/798130238) | England | Download or OGC API Features | OGL per product. Flood Zones 2 and 3 are planning context and are distinct from surface-water or property-risk products. | Import supported; disabled until active versions |

Deferred sources: HMLR Price Paid/UPRN history, BGS geology, mining, Natural England-only imports beyond Planning Data, NRW/Cadw, Scotland and Northern Ireland.
