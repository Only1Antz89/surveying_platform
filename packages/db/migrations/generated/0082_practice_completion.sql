CREATE TABLE "client_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid,
	"template_key" text NOT NULL,
	"channel" text NOT NULL,
	"recipient" text,
	"status" text NOT NULL,
	"reason" text,
	"dedup_key" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_messages_status_chk" CHECK ("client_messages"."status" in ('queued','skipped')),
	CONSTRAINT "client_messages_channel_chk" CHECK ("client_messages"."channel" in ('email','sms'))
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subject_email" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" jsonb,
	"created_by_user_id" uuid,
	"completed_by_user_id" uuid,
	CONSTRAINT "data_subject_requests_kind_chk" CHECK ("data_subject_requests"."kind" in ('access','erasure')),
	CONSTRAINT "data_subject_requests_status_chk" CHECK ("data_subject_requests"."status" in ('open','completed','refused')),
	CONSTRAINT "data_subject_requests_completion_chk" CHECK (("data_subject_requests"."status" = 'open') = (completed_at is null))
);
--> statement-breakpoint
CREATE TABLE "engagement_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"terms_id" uuid NOT NULL,
	"terms_sha256" text NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text,
	"method" text DEFAULT 'typed_signature' NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_acceptances_method_chk" CHECK ("engagement_acceptances"."method" in ('typed_signature','recorded_by_practice'))
);
--> statement-breakpoint
CREATE TABLE "engagement_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_terms_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "engagement_terms_status_chk" CHECK ("engagement_terms"."status" in ('draft','published','retired')),
	CONSTRAINT "engagement_terms_published_chk" CHECK ("engagement_terms"."status" = 'draft' or (published_at is not null))
);
--> statement-breakpoint
CREATE TABLE "feature_usage_daily" (
	"day" date NOT NULL,
	"organisation_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "feature_usage_daily_day_organisation_id_feature_pk" PRIMARY KEY("day","organisation_id","feature"),
	CONSTRAINT "feature_usage_daily_feature_chk" CHECK ("feature_usage_daily"."feature" ~ '^[a-z0-9_-]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "job_cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"minutes" integer,
	"miles" numeric(7, 1),
	"amount_minor" integer,
	"category" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cost_entries_kind_chk" CHECK ((kind = 'time' and minutes between 1 and 1440 and miles is null and amount_minor is null) or (kind = 'mileage' and miles > 0 and miles <= 2000 and minutes is null and amount_minor is null) or (kind = 'expense' and amount_minor between 1 and 10000000 and minutes is null and miles is null))
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_organisation_id_key_channel_pk" PRIMARY KEY("organisation_id","key","channel"),
	CONSTRAINT "message_templates_key_chk" CHECK ("message_templates"."key" in ('appointment_reminder','on_the_way','access_request','review_request')),
	CONSTRAINT "message_templates_channel_chk" CHECK ("message_templates"."channel" in ('email','sms'))
);
--> statement-breakpoint
CREATE TABLE "platform_error_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"route_path" text NOT NULL,
	"route_type" text NOT NULL,
	"method" text NOT NULL,
	"error_name" text NOT NULL,
	"message" text NOT NULL,
	"digest" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_staff_id" uuid
);
--> statement-breakpoint
CREATE TABLE "referral_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_sources_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "referral_sources_kind_chk" CHECK ("referral_sources"."kind" in ('estate_agent','mortgage_broker','lender','solicitor','website','repeat_client','other'))
);
--> statement-breakpoint
CREATE TABLE "survey_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"floor" text NOT NULL,
	"name" text NOT NULL,
	"length_m" numeric(6, 2),
	"width_m" numeric(6, 2),
	"height_m" numeric(5, 2),
	"area_override_m2" numeric(8, 2),
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_rooms_org_id_uidx" UNIQUE("organisation_id","id"),
	CONSTRAINT "survey_rooms_dimensions_chk" CHECK (coalesce(length_m, 0) between 0 and 500 and coalesce(width_m, 0) between 0 and 500 and coalesce(height_m, 0) between 0 and 50 and coalesce(area_override_m2, 0) between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "referral_source_id" uuid;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "staff_cost_rate_pence" integer DEFAULT 3500 NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "require_two_step" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "engagement_terms_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD COLUMN "review_requests" jsonb DEFAULT '{"enabled":false,"reviewUrl":null,"delayDays":2}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_acceptances" ADD CONSTRAINT "engagement_acceptances_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_acceptances" ADD CONSTRAINT "engagement_acceptances_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_acceptances" ADD CONSTRAINT "engagement_acceptances_terms_fk" FOREIGN KEY ("organisation_id","terms_id") REFERENCES "public"."engagement_terms"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_terms" ADD CONSTRAINT "engagement_terms_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_terms" ADD CONSTRAINT "engagement_terms_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_terms" ADD CONSTRAINT "engagement_terms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_usage_daily" ADD CONSTRAINT "feature_usage_daily_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_job_fk" FOREIGN KEY ("organisation_id","job_id") REFERENCES "public"."jobs"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_error_events" ADD CONSTRAINT "platform_error_events_resolved_by_staff_id_platform_staff_id_fk" FOREIGN KEY ("resolved_by_staff_id") REFERENCES "public"."platform_staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_rooms" ADD CONSTRAINT "survey_rooms_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_rooms" ADD CONSTRAINT "survey_rooms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_rooms" ADD CONSTRAINT "survey_rooms_survey_fk" FOREIGN KEY ("organisation_id","survey_id") REFERENCES "public"."surveys"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_messages_dedup_uidx" ON "client_messages" USING btree ("organisation_id","dedup_key");--> statement-breakpoint
CREATE INDEX "client_messages_job_idx" ON "client_messages" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE INDEX "data_subject_requests_org_status_idx" ON "data_subject_requests" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_acceptances_job_terms_uidx" ON "engagement_acceptances" USING btree ("organisation_id","job_id","terms_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_terms_org_version_uidx" ON "engagement_terms" USING btree ("organisation_id","version");--> statement-breakpoint
CREATE INDEX "job_cost_entries_job_idx" ON "job_cost_entries" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_error_events_fingerprint_uidx" ON "platform_error_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "platform_error_events_last_seen_idx" ON "platform_error_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_sources_org_name_uidx" ON "referral_sources" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "survey_rooms_survey_idx" ON "survey_rooms" USING btree ("organisation_id","survey_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_referral_source_fk" FOREIGN KEY ("organisation_id","referral_source_id") REFERENCES "public"."referral_sources"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_operational_settings" ADD CONSTRAINT "organisation_operational_settings_cost_rate_chk" CHECK (staff_cost_rate_pence between 0 and 100000);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey_rooms','engagement_terms','engagement_acceptances','job_cost_entries','referral_sources','message_templates','client_messages','data_subject_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (organisation_id=nullif(current_setting(''app.current_organisation_id'',true),'''')::uuid) WITH CHECK (organisation_id=nullif(current_setting(''app.current_organisation_id'',true),'''')::uuid)', t || '_tenant', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER engagement_acceptances_immutable BEFORE UPDATE OR DELETE ON engagement_acceptances FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_published_engagement_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'published engagement terms cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.version IS DISTINCT FROM OLD.version OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'published engagement terms are immutable; publish a new version';
  END IF;
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN RAISE EXCEPTION 'retired engagement terms cannot be republished'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER engagement_terms_protected BEFORE UPDATE OR DELETE ON engagement_terms FOR EACH ROW EXECUTE FUNCTION protect_published_engagement_terms();
--> statement-breakpoint
CREATE TRIGGER client_messages_immutable BEFORE UPDATE OR DELETE ON client_messages FOR EACH ROW EXECUTE FUNCTION prevent_immutable_mutation();
