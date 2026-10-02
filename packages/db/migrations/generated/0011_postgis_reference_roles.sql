-- PostGIS powers property points and reference spatial layers. Confirm the
-- extension is available on the target Neon branch before migrating.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
-- Group roles (NOLOGIN). Operators grant membership to real login roles; see
-- docs/property-intelligence/configuration.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surveynt_reference_read') THEN
    CREATE ROLE surveynt_reference_read NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surveynt_reference_write') THEN
    CREATE ROLE surveynt_reference_write NOLOGIN;
  END IF;
END $$;
