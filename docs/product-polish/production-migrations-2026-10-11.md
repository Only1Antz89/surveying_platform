# Production migrations — 11 October 2026

Production is migrated through `0081_solid_onslaught`. Seven pending migrations (0075–0081) were applied using the repository Drizzle migration CLI with the existing administrator connection. All 82 ledger entries match repository SHA-256 hashes and journal timestamps. Verification completed at 2026-10-11T19:00:40.265Z.

## Recovery and rehearsal

A fresh private PostgreSQL 18 custom-format backup was created before execution:

- File: `/private/tmp/surveynt-production-before-0081.dump`; permissions 0600.
- Bytes: 119388509.
- SHA-256: `c292a1b5021e8c9f08a75998249d5db70230618c76619e1f77730dddbb551fee`.
- `pg_restore --list` verified 1115 archive entries. The backup has not been test-restored or copied to durable storage.

A disposable local PostGIS database rehearsed all 82 migrations successfully. The historical manager enum addition was committed at migration 0033 before subsequent migrations used it. Production already had that boundary installed. Production migration execution used a 15-second lock timeout and a 120-second statement timeout. No historical migration SQL was changed.

## Post-migration checks

- `organisation_operational_settings.report_template_settings` exists.
- `jobs.survey_file_archive_until` exists.
- `media_kind` includes video.
- Nine new tenant tables have enabled and forced row security, application SELECT permission, and zero visible rows without tenant context: business_locations, staff_capabilities, tenant_connections, surveyant_conversations, surveyant_messages, tracking_sessions, latest_staff_locations, client_case_publications and job_site_statuses.

This verifies database installation and unscoped isolation. It does not establish full authenticated application acceptance or deploy a new application build. No report was formally issued and no deletion processing was enabled. RICS distribution authorisation and official production assets remain external prerequisites.
