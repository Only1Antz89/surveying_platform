CREATE TABLE "calendar_event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"external_version" text,
	"last_synced_appointment_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_links_connection_appointment_uidx" ON "calendar_event_links" USING btree ("connection_id","appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_links_connection_external_uidx" ON "calendar_event_links" USING btree ("connection_id","external_event_id");--> statement-breakpoint
CREATE INDEX "calendar_event_links_org_idx" ON "calendar_event_links" USING btree ("organisation_id");
--> statement-breakpoint
ALTER TABLE calendar_event_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calendar_event_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_event_links_tenant_isolation ON calendar_event_links FOR ALL
USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
