ALTER TABLE organisation_documents ADD COLUMN purge_status text NOT NULL DEFAULT 'retained', ADD COLUMN purge_requested_at timestamptz, ADD COLUMN purged_at timestamptz;
ALTER TABLE organisation_documents ADD CONSTRAINT document_purge_status_chk CHECK (purge_status IN ('retained','pending','removing','verification_required','purged'));
