CREATE TABLE "customer_provisioning" (
	"remote_create_attempted" boolean DEFAULT false NOT NULL,
	"requested_by" uuid,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" text NOT NULL,
	"organisation_id" uuid,
	"clerk_organisation_id" text,
	"clerk_invitation_id" text,
	"owner_email" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_provisioning_request_key_unique" UNIQUE("request_key")
);
--> statement-breakpoint
ALTER TABLE "customer_provisioning" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "platform_role" NOT NULL,
	"clerk_invitation_id" text,
	"invited_by" uuid NOT NULL,
	"accepted_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_invitations_clerk_invitation_id_unique" UNIQUE("clerk_invitation_id")
);
--> statement-breakpoint
ALTER TABLE "platform_staff_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_provisioning" ADD CONSTRAINT "customer_provisioning_requested_by_platform_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."platform_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_provisioning" ADD CONSTRAINT "customer_provisioning_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_staff_invitations" ADD CONSTRAINT "platform_staff_invitations_invited_by_platform_staff_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."platform_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_staff_invitations_email_idx" ON "platform_staff_invitations" USING btree ("email");