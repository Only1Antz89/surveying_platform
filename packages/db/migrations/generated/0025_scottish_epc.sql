CREATE TABLE "reference"."scottish_epc_certificates" (
	"dataset_sync_id" uuid NOT NULL,
	"certificate_key" text NOT NULL,
	"uprn" text NOT NULL,
	"lodgement_date" date,
	"current_rating" text,
	"potential_rating" text,
	"property_type" text,
	"built_form" text,
	"construction_age_band" text,
	"total_floor_area_m2" double precision,
	CONSTRAINT "scottish_epc_certificates_pk" PRIMARY KEY("dataset_sync_id","certificate_key"),
	CONSTRAINT "scottish_epc_certificates_uprn_chk" CHECK (uprn ~ '^[0-9]{1,12}$'),
	CONSTRAINT "scottish_epc_certificates_rating_chk" CHECK ((current_rating is null or current_rating ~ '^[A-G]$') and (potential_rating is null or potential_rating ~ '^[A-G]$'))
);
--> statement-breakpoint
ALTER TABLE "reference"."scottish_epc_certificates" ADD CONSTRAINT "scottish_epc_certificates_dataset_sync_id_dataset_syncs_id_fk" FOREIGN KEY ("dataset_sync_id") REFERENCES "reference"."dataset_syncs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scottish_epc_certificates_uprn_idx" ON "reference"."scottish_epc_certificates" USING btree ("dataset_sync_id","uprn");