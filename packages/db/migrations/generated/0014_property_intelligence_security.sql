-- enrichment_runs and property_intelligence_snapshots come from the England
-- release (migration 0006), which already enables tenant RLS on both and makes
-- snapshots immutable (reject_snapshot_mutation). Nothing is duplicated here.
GRANT SELECT ON reference.spatial_features TO surveynt_reference_read;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON reference.spatial_features TO surveynt_reference_write;
