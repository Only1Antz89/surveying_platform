CREATE TABLE "mobile_capture_operations" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"input_sha256" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mobile_capture_operations_organisation_id_user_id_operation_id_pk" PRIMARY KEY("organisation_id","user_id","operation_id"),
	CONSTRAINT "mobile_capture_operations_kind" CHECK ("mobile_capture_operations"."kind" in ('room','cost'))
);
--> statement-breakpoint
ALTER TABLE "surveyant_messages" ADD COLUMN "search_suggestions" text;--> statement-breakpoint
ALTER TABLE "mobile_capture_operations" ADD CONSTRAINT "mobile_capture_operations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_capture_operations" ADD CONSTRAINT "mobile_capture_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE mobile_capture_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_capture_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY mobile_capture_operations_tenant ON mobile_capture_operations
 USING (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid)
 WITH CHECK (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid);
--> statement-breakpoint
-- The previous logger could retain arbitrary exception strings. Remove those legacy details.
UPDATE platform_error_events SET message='Exception details withheld to protect confidential data.',
 error_name='Error', digest=null, route_path='[legacy]', route_type='unknown', method='OTHER';
