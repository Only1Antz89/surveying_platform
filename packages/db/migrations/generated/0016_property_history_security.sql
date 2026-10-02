-- Price Paid reference data: the app reads, only the importer writes.
GRANT SELECT ON reference.price_paid_transactions, reference.price_paid_uprn_links TO surveynt_reference_read;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON reference.price_paid_transactions, reference.price_paid_uprn_links TO surveynt_reference_write;
