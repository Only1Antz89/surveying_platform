# Property intelligence progress

## England first release

- [x] Repository, tenancy, queue and provider-source verification
- [x] Additive identity, provenance, reference-data and RLS schema
- [x] Provider-neutral address search and explicit identity confirmation API
- [x] OS Open UPRN and generic national spatial import capability with pre-activation capacity report
- [x] Planning Data and EPC provider adapters
- [x] Historic England, HMLR INSPIRE and separate EA Flood Zone local adapters
- [x] Idempotent durable enrichment queue and protected worker
- [x] Intelligence, filtered planning/environment and bounded map APIs
- [x] Read-only target Neon audit: PostGIS 3.6.4 is available and application/admin roles are separate
- [x] Apply PostGIS migration to the authorised non-production Neon database
- [x] Recheck application-role spatial functions, reference-table write denial and tenant RLS after migration
- [x] Verify metre-distance candidates, inside/outside/boundary intersections and BNG-to-WGS84 transformation in PostGIS
- [x] Live-verify Postcodes.io and Planning Data response validation against a labelled development fixture
- [x] Verify protected worker authentication and empty-queue processing against non-production Neon
- [ ] Import and validate national datasets
- [x] Full dry-run OS Open UPRN and Historic England; sample-validate HMLR GML without database writes
- [ ] Resolve the current EA national download and complete HMLR/EA national dry-runs
- [ ] Live-test EPC after credentials/licence acceptance
- [ ] Configure production geocoder and basemap providers
- [ ] Measure national storage, index size and query latency before activation

Deferred: property sales history, geology, mining, national-data administration UI and non-England country adapters.
