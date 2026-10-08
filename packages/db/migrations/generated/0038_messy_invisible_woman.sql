ALTER TABLE "preinspection_documents" ADD COLUMN "analysis" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD COLUMN "works_kind" text;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD COLUMN "association_fingerprint" text;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD COLUMN "associated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD COLUMN "associated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD COLUMN "association_reason" text;--> statement-breakpoint
ALTER TABLE "preinspection_documents" ADD CONSTRAINT "preinspection_documents_associated_by_user_id_users_id_fk" FOREIGN KEY ("associated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;