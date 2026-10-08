CREATE TABLE "preinspection_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text NOT NULL,
	"replaces_id" uuid,
	"superseded_at" timestamp with time zone,
	"source" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preinspection_documents_size_chk" CHECK (size_bytes > 0 and size_bytes <= 10485760),
	CONSTRAINT "preinspection_documents_source_chk" CHECK (source in ('customer', 'staff_transcribed_client'))
);
--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD CONSTRAINT "preinspection_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD CONSTRAINT "preinspection_documents_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD CONSTRAINT "preinspection_documents_organisation_id_job_id_jobs_organisation_id_id_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD CONSTRAINT "preinspection_documents_organisation_id_property_id_properties_organisation_id_id_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "public"."properties"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preinspection_documents_request_uidx" ON "preinspection_documents" USING btree ("organisation_id","job_id","request_id");--> statement-breakpoint
CREATE INDEX "preinspection_documents_job_idx" ON "preinspection_documents" USING btree ("organisation_id","job_id");
ALTER TABLE preinspection_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE preinspection_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY preinspection_documents_tenant ON preinspection_documents USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
