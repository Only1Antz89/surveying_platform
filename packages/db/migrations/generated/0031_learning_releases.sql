CREATE SCHEMA "learning_shared";
--> statement-breakpoint
CREATE TABLE "learning_restricted"."release_items" (
	"release_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"shared_case_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"weight" double precision NOT NULL,
	"status" text DEFAULT 'included' NOT NULL,
	"status_reason" text,
	CONSTRAINT "learning_release_items_pk" PRIMARY KEY("release_id","candidate_id"),
	CONSTRAINT "release_items_shared_case_id_unique" UNIQUE("shared_case_id"),
	CONSTRAINT "learning_release_items_status_chk" CHECK (status in ('included', 'withdrawn', 'retracted')),
	CONSTRAINT "learning_release_items_weight_chk" CHECK (weight > 0 and weight <= 1)
);
--> statement-breakpoint
CREATE TABLE "learning_restricted"."releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_staff_id" uuid NOT NULL,
	"privacy_signoff_staff_id" uuid,
	"privacy_signoff_at" timestamp with time zone,
	"privacy_note" text,
	"approved_by_staff_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_by_staff_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_version_unique" UNIQUE("version"),
	CONSTRAINT "learning_releases_status_chk" CHECK (status in ('draft', 'approved', 'active', 'superseded', 'rolled_back', 'retired')),
	CONSTRAINT "learning_releases_approval_chk" CHECK (status = 'draft' or (privacy_signoff_staff_id is not null and approved_by_staff_id is not null and approved_by_staff_id <> privacy_signoff_staff_id))
);
--> statement-breakpoint
CREATE TABLE "learning_shared"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_id" uuid NOT NULL,
	"jurisdiction" text NOT NULL,
	"service_level" text NOT NULL,
	"template" text NOT NULL,
	"property_type" text,
	"built_form" text,
	"age_band" text,
	"element_key" text NOT NULL,
	"element_label" text NOT NULL,
	"inspection_status" text,
	"observed_feature" text NOT NULL,
	"possible_causes" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_cause" text,
	"confirmation_basis" text,
	"surveyor_judgement" text NOT NULL,
	"rating_example" text,
	"next_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"limitations" text,
	"uncertainty" text NOT NULL,
	"evidence_strength" text NOT NULL,
	"knowledge_review_due" date NOT NULL,
	"rating_disagreement" boolean NOT NULL,
	"no_defect" boolean NOT NULL,
	"weight" double precision NOT NULL,
	"search_text" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english'::regconfig, search_text)) STORED
);
--> statement-breakpoint
CREATE TABLE "learning_shared"."releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"case_count" integer NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "releases_version_unique" UNIQUE("version"),
	CONSTRAINT "shared_releases_status_chk" CHECK (status in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "learning_restricted"."release_items" ADD CONSTRAINT "release_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_restricted"."releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_restricted"."release_items" ADD CONSTRAINT "release_items_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "learning_restricted"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_shared"."cases" ADD CONSTRAINT "cases_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "learning_shared"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_release_items_candidate_idx" ON "learning_restricted"."release_items" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "shared_cases_release_element_idx" ON "learning_shared"."cases" USING btree ("release_id","element_key","jurisdiction");--> statement-breakpoint
CREATE INDEX "shared_cases_search_idx" ON "learning_shared"."cases" USING gin ("search");