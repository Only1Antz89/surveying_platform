CREATE TABLE "enrichment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input_fingerprint" text NOT NULL,
	"property_version" integer NOT NULL,
	"provider_statuses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_runs_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "enrichment_runs_status_chk" CHECK (status in ('queued', 'running', 'completed', 'partial', 'failed', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "property_intelligence_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"enrichment_run_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"dataset_version" text,
	"source_record_id" text,
	"category" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_method" text NOT NULL,
	"confidence" text,
	"information_class" text NOT NULL,
	"coverage_status" text NOT NULL,
	"result_status" text NOT NULL,
	"message" text,
	"licence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_intelligence_snapshots_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "property_intelligence_snapshots_status_chk" CHECK (result_status in ('matched', 'no_match', 'unsupported', 'not_configured', 'unavailable', 'error')),
	CONSTRAINT "property_intelligence_snapshots_class_chk" CHECK (information_class in ('surveyor_verified', 'authoritative_external', 'indicative_external')),
	CONSTRAINT "property_intelligence_snapshots_coverage_chk" CHECK (coverage_status in ('covered', 'partial', 'not_covered', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "reference"."spatial_features" (
	"dataset_sync_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"layer" text NOT NULL,
	"feature_id" text NOT NULL,
	"name" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"geom" geometry(Geometry, 4326) NOT NULL,
	CONSTRAINT "spatial_features_pk" PRIMARY KEY("dataset_sync_id","feature_id")
);
--> statement-breakpoint
DROP INDEX "reference"."dataset_syncs_one_active_uidx";--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reference"."dataset_syncs" ADD COLUMN "layer" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_runs" ADD CONSTRAINT "enrichment_runs_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_intelligence_snapshots" ADD CONSTRAINT "property_intelligence_snapshots_run_fk" FOREIGN KEY ("organisation_id","enrichment_run_id") REFERENCES "public"."enrichment_runs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."spatial_features" ADD CONSTRAINT "spatial_features_dataset_sync_id_dataset_syncs_id_fk" FOREIGN KEY ("dataset_sync_id") REFERENCES "reference"."dataset_syncs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_runs_idempotency_uidx" ON "enrichment_runs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "enrichment_runs_property_idx" ON "enrichment_runs" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "property_intelligence_snapshots_property_idx" ON "property_intelligence_snapshots" USING btree ("property_id","source_key","category","retrieved_at");--> statement-breakpoint
CREATE INDEX "property_intelligence_snapshots_run_idx" ON "property_intelligence_snapshots" USING btree ("enrichment_run_id");--> statement-breakpoint
CREATE INDEX "spatial_features_gix" ON "reference"."spatial_features" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "spatial_features_layer_idx" ON "reference"."spatial_features" USING btree ("source_key","layer");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_syncs_one_active_layer_uidx" ON "reference"."dataset_syncs" USING btree ("source_key","layer") WHERE status = 'active';