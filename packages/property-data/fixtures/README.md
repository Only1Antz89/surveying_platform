# Test fixtures — not real data

Every file in this directory is **synthetic test data** for automated tests and
explicitly labelled development demos. None of it is live provider data, and
it must never be imported into a production database or shown as real
intelligence.

| File | Purpose |
|---|---|
| `SYNTHETIC-TEST-ONLY-os-open-uprn.csv` | OS Open UPRN-shaped rows. UPRNs use the fictitious `9900000000xx` range. Coordinates are chosen to test co-located flats, near/far candidates, CRS cross-checks and one invalid row. BNG values were derived from the latitude/longitude with PostGIS `ST_Transform`. |
