ALTER TABLE background_jobs ADD COLUMN lease_token uuid;
CREATE INDEX background_jobs_email_lease_idx ON background_jobs(locked_until) WHERE queue='email' AND status IN ('processing','sending');
