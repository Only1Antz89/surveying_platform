CREATE TABLE "address_provider_rate_limits" (
	"provider" text PRIMARY KEY NOT NULL,
	"allowed_after" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "address_search_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "address_search_cache" ADD CONSTRAINT "address_search_cache_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "address_search_cache_org_expiry_idx" ON "address_search_cache" USING btree ("organisation_id","expires_at");
--> statement-breakpoint
ALTER TABLE "address_search_cache" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "address_search_cache_tenant_policy" ON "address_search_cache" FOR ALL
  USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid)
  WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "address_provider_rate_limits" ENABLE ROW LEVEL SECURITY;
