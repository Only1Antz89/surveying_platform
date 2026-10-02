CREATE TABLE "reference"."price_paid_transactions" (
	"dataset_sync_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"price" integer NOT NULL,
	"transfer_date" date NOT NULL,
	"property_type" text NOT NULL,
	"new_build" boolean NOT NULL,
	"tenure" text NOT NULL,
	"ppd_category" text NOT NULL,
	CONSTRAINT "price_paid_transactions_pk" PRIMARY KEY("dataset_sync_id","transaction_id"),
	CONSTRAINT "price_paid_transactions_id_chk" CHECK (transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
	CONSTRAINT "price_paid_transactions_price_chk" CHECK (price > 0),
	CONSTRAINT "price_paid_transactions_type_chk" CHECK (property_type in ('D', 'S', 'T', 'F', 'O')),
	CONSTRAINT "price_paid_transactions_tenure_chk" CHECK (tenure in ('F', 'L', 'U')),
	CONSTRAINT "price_paid_transactions_category_chk" CHECK (ppd_category in ('A', 'B'))
);
--> statement-breakpoint
CREATE TABLE "reference"."price_paid_uprn_links" (
	"dataset_sync_id" uuid NOT NULL,
	"transaction_id" text NOT NULL,
	"uprn" text NOT NULL,
	CONSTRAINT "price_paid_uprn_links_pk" PRIMARY KEY("dataset_sync_id","transaction_id","uprn"),
	CONSTRAINT "price_paid_uprn_links_id_chk" CHECK (transaction_id ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
	CONSTRAINT "price_paid_uprn_links_uprn_chk" CHECK (uprn ~ '^[0-9]{1,12}$')
);
--> statement-breakpoint
ALTER TABLE "reference"."price_paid_transactions" ADD CONSTRAINT "price_paid_transactions_dataset_sync_id_dataset_syncs_id_fk" FOREIGN KEY ("dataset_sync_id") REFERENCES "reference"."dataset_syncs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference"."price_paid_uprn_links" ADD CONSTRAINT "price_paid_uprn_links_dataset_sync_id_dataset_syncs_id_fk" FOREIGN KEY ("dataset_sync_id") REFERENCES "reference"."dataset_syncs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_paid_uprn_links_uprn_idx" ON "reference"."price_paid_uprn_links" USING btree ("dataset_sync_id","uprn");