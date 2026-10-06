CREATE TABLE "member_work_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"route_origin" text,
	"latitude" double precision,
	"longitude" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"rics_number" text,
	"appearance" jsonb DEFAULT '{"theme":"system","reducedMotion":false,"contrast":"standard","density":"comfortable","textSize":"standard"}'::jsonb NOT NULL,
	"notifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "demo_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "demo_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_work_profiles" ADD CONSTRAINT "member_work_profiles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_work_profiles" ADD CONSTRAINT "member_work_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_work_profiles_org_user_uidx" ON "member_work_profiles" USING btree ("organisation_id","user_id");
--> statement-breakpoint
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_profiles_own ON user_profiles FOR ALL USING (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE member_work_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_work_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY member_work_profiles_read ON member_work_profiles FOR SELECT USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid);
CREATE POLICY member_work_profiles_insert ON member_work_profiles FOR INSERT WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid AND user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY member_work_profiles_update ON member_work_profiles FOR UPDATE USING (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid AND user_id = nullif(current_setting('app.current_user_id', true), '')::uuid) WITH CHECK (organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid AND user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE member_work_profiles ADD CONSTRAINT member_work_profiles_coordinates CHECK ((latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));
