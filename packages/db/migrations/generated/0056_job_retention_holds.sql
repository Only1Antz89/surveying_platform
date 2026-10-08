CREATE TABLE job_retention_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
 job_id uuid NOT NULL,
 kind text CHECK (kind IS NULL OR kind IN ('complaint','claim','legal')),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 reviewed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT job_retention_holds_job_fk FOREIGN KEY (organisation_id,job_id) REFERENCES jobs(organisation_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX job_retention_holds_org_job_uidx ON job_retention_holds(organisation_id,job_id);
ALTER TABLE job_retention_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_retention_holds FORCE ROW LEVEL SECURITY;
CREATE POLICY job_retention_holds_tenant ON job_retention_holds USING (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid);
