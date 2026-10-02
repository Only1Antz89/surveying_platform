# England reference data pre-activation capacity report

Date: 2 October 2026

This is a read-only download and conversion report. It is not approval to stage or activate a dataset. No records were written to Neon. Table/index sizes and query latency can only be measured after a separately authorised staging import, so every source remains blocked from activation until those measurements are reviewed.

Cost projections use the current published Neon storage rate of USD 0.35 per GiB-month. They exclude compute, history, backups, transfer and any provider costs. File-to-table multipliers are conservative planning estimates; the staged measurements are authoritative.

## Results

| Source and release | Validation result | Records | Source/prepared size | Estimated table storage | Estimated storage/month | Activation status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| OS Open UPRN `2026-09` | Full official GB CSV scanned; zero invalid rows; required headers and WGS84 ranges passed | 41,676,575 | 2,273,707,279 bytes CSV | 4,092,673,102 bytes | USD 1.3341 | Blocked: not staged; index size and latency unmeasured |
| Historic England NHLE `2026-10-01` | All eight polygon layers converted and fully scanned; zero invalid rows | 401,771 | 401,683,375 bytes canonical CSV | 1,004,208,438 bytes | USD 0.3273 | Blocked: not staged; index size and latency unmeasured |
| HMLR INSPIRE `2026-09` | Official Adur sample converted and fully scanned; zero invalid rows | 26,429 sample parcels | 3,633,091 bytes ZIP; 26,412,404 bytes GML; 17,737,855 bytes CSV | 44,344,638 bytes for sample | USD 0.0145 for sample | Blocked: national download, count, deduplication, table/index size and latency unmeasured |
| EA Flood Zone 2, revision `2026-05-20` | Official OGC collection fully downloaded and scanned; zero invalid rows; every feature matched FZ2 | 540,282 | 3,321,129,511 bytes canonical CSV | 8,302,823,778 bytes | USD 2.7064 | Blocked: not staged; index size and latency unmeasured |
| EA Flood Zone 3, revision `2026-05-20` | Official OGC collection fully downloaded and scanned; zero invalid rows; every feature matched FZ3 | 273,345 | 3,360,223,998 bytes canonical CSV | 8,400,559,995 bytes | USD 2.7383 | Blocked: not staged; index size and latency unmeasured |

The measured OS, Historic England and Environment Agency dry-run estimate is USD 7.1061 per month before indexes and platform overhead. It must not be treated as the final Neon cost.

## OS Open UPRN evidence

- Official OS Downloads API release: `2026-09`, approximately six-week publication cycle.
- Archive: `osopenuprn_202609_csv.zip`, 619,271,161 bytes.
- Official archive MD5 matched: `1d5c21d8166d6efd74850ec6f1ae77ab`.
- Extracted CSV SHA-256: `aafe9a43365469f8b57954583344947b8f877266b88b1d92823cd67259cecd98`.
- Header: `UPRN,X_COORDINATE,Y_COORDINATE,LATITUDE,LONGITUDE`.
- Full scan: 41,676,575 records, zero invalid UPRNs, coordinate pairs or ranges.
- The release is GB-wide. England-only application use is enforced by the product coverage gate; this report sizes the complete official source file.
- OS Open UPRN is identifier/coordinate reference data, not a postal address directory.

## Historic England evidence

Official service item `767f279327a24845bf47dfe5eae9862b` reported data updated on 1 October 2026. Hosted GeoJSON exports were WGS84 and were converted into one canonical import file with stable designation-prefixed identifiers and retained source attributes.

| Designation | Records | Download SHA-256 |
| --- | ---: | --- |
| Listed buildings | 379,685 | `ddaf13642457b4abecd5d4414c74306e919de0a2d11e6351f4a097099f94a655` |
| Building preservation notices | 6 | `71329a3cc95089908a66d591017b2dd6068766018eae40097a6ce0d0d34383af` |
| Certificates of immunity | 226 | `498da59e9ea26b91de38ccb8f0a163dc856350a02455253326ab4673dbc7f1b9` |
| Scheduled monuments | 20,001 | `fcd672fdd9cca83c67e8095477309334ca0d6380edfb5b64df24659245633757` |
| Parks and gardens | 1,721 | `7f9aea172b071d7fba2e698a342e22f36a54c7edbb0aa0dba0e22e62a2d5320b` |
| Battlefields | 47 | `9dcb8e8ba18bcb7435e6bf1b4aaadf294ba8689ff637a52f2a99e96c75f0cb59` |
| Protected wreck sites | 57 | `dc1e7e6318aa249cf042b6cfded9c4b716050c9a5d2ad137019524065d5b3a9e` |
| World Heritage Sites | 28 | `0d255a100e3ca8c9040c1c40d4dd2dc23e4b2930f72551f181edbf9486519307` |

Canonical CSV SHA-256: `003510636bc2fa313ecd471ae26f582d00e9496fa8ad7f7aaf6e2bcd9eb4d6d6`.

## HMLR INSPIRE evidence and national projection

- Current catalogue publication: 6 September 2026; files are replaced on the first Sunday of each month.
- Catalogue: 318 England and Wales authority archives. The reviewed England-first manifest contains 296 authorities after excluding the 22 Welsh principal areas.
- A deterministic manifest validator enforced the current 318 total, all 22 named Welsh exclusions, 296 England results, unique filenames and official HTTPS download URLs. Manifest SHA-256: `37b9daf558e2364692bfb9d4e36972deeac97d329f8d7b15ec8bf4ac8d95b3c0`.
- The official service's non-browser redirect loop required capture from its successfully rendered catalogue page. The resulting reviewed manifest is committed as `hmlr-england-authorities-2026-09.json`; the raw England and Wales capture is not retained.
- Official service guidance gives an average file size of 13.66 MB. At 296 archives this is approximately 4,239,770,255 bytes of downloads.
- Adur archive SHA-256: `0193a690dd0f05a7ca62d555d36450b2841c11ec8acfb256c88124a722a08d4d`.
- Adur GML declared `EPSG:27700`, contained 26,429 parcels and converted to 26,429 valid rows.
- Applying the sample table-to-ZIP ratio to the published average produces a deliberately provisional national estimate of 51,749,619,588 bytes and USD 16.8685 per month. Authority size and polygon complexity vary materially, so this is not sufficient for approval.
- The projected canonical/table footprint is close to the current local scratch capacity, so a full 296-authority conversion was not started. It requires larger temporary storage or a separately authorised staged streaming workflow; this remains an activation blocker.
- The national converter deduplicates repeated INSPIRE IDs across authority boundaries. Each record is labelled as an indicative, non-definitive freehold extent; it is not a legal title boundary or ownership record.

## Environment Agency evidence

- Dataset: Flood Map for Planning - Flood Zones, metadata identifier `04532375-a198-476e-985e-0579a0a11b47`.
- Revision date: 20 May 2026; data.gov.uk catalogue updated 6 July 2026.
- Source dataset CRS: `EPSG:27700`; official OGC GeoJSON response CRS: CRS84/WGS84; licence: Open Government Licence.
- The source explicitly states that the layers are planning context and are not suitable for deciding whether an individual property is at risk.
- Flood Zones 2 and 3 must be split into distinct versioned imports. Absence from either layer must remain “no record found”, never “safe” or “low risk”.
- The catalogue's advertised GeoJSON ZIP returned `404`, so the national layers were obtained from the publisher's official OGC API Features collection using separate CQL2 filters.
- The API reported 540,282 FZ2 and 273,345 FZ3 records. Both totals were downloaded across 83 pages, and every returned feature was checked against its requested zone.
- During one later FZ2 page, the publisher emitted an unresolvable Agrimetrics backend hostname. The downloader accepted only that exact origin and identical collection path, rewrote it to the reviewed public EA origin, and retained the publisher's unchanged query. The equivalent public URL returned the expected 10,000-feature page.
- FZ2 canonical CSV SHA-256: `69598bc591c826ec85320b8780de26c95fcf5a9dbbca16c75856a39d0fdca434`.
- FZ3 canonical CSV SHA-256: `facf6ec1d72642d5704f8af3ca76347f898a8f24cd0d3f38d06be3655f878675`.
- The importer's complete semantic scan found zero invalid rows, duplicate headers or missing required columns in either layer. Actual table/index size and query latency remain unmeasured until separately authorised staging.

## Required approval gate

Before any activation, separately authorise a staging run using `DATABASE_ADMIN_URL`, then record for each source:

1. Exact national record count after deduplication and England filtering.
2. Verified source and canonical-file checksums plus licence snapshot.
3. Actual `pg_total_relation_size` and `pg_indexes_size`.
4. Property-centred intersection/nearby query latency on representative urban, rural, coastal and empty-result points.
5. Final Neon cost projection and rollback target.
6. Application-role read success, reference-table write denial and tenant/map boundary tests.

Until all six are reviewed, the dataset version must remain inactive.
