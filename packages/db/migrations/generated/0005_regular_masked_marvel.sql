CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('investigating', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TABLE "platform_incident_organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"severity" "incident_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'investigating' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_incident_organisations" ADD CONSTRAINT "platform_incident_organisations_incident_id_platform_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."platform_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_incident_organisations" ADD CONSTRAINT "platform_incident_organisations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_incidents" ADD CONSTRAINT "platform_incidents_created_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_incident_org_uidx" ON "platform_incident_organisations" USING btree ("incident_id","organisation_id");--> statement-breakpoint
CREATE INDEX "platform_incident_org_org_idx" ON "platform_incident_organisations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "platform_incidents_status_idx" ON "platform_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_incidents_severity_idx" ON "platform_incidents" USING btree ("severity");