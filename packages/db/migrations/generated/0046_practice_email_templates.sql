ALTER TABLE organisation_operational_settings ADD COLUMN email_templates jsonb NOT NULL DEFAULT '{}'::jsonb;
