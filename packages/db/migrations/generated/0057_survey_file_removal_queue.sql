CREATE TABLE survey_file_removals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
 job_id uuid NOT NULL, request_id uuid NOT NULL, requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 review_id uuid NOT NULL, review_version text NOT NULL CHECK (review_version ~ '^[a-f0-9]{64}$'),
 request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'), manifest_version text NOT NULL CHECK (manifest_version ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 2000),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dispatched','verification_required','completed','cancelled')),
 lease_token uuid, locked_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), error text,
 progress jsonb NOT NULL DEFAULT '{}', completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT survey_file_removals_job_fk FOREIGN KEY (organisation_id,job_id) REFERENCES jobs(organisation_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX survey_file_removals_request_uidx ON survey_file_removals(organisation_id,request_id);
CREATE UNIQUE INDEX survey_file_removals_active_job_uidx ON survey_file_removals(organisation_id,job_id) WHERE status <> 'cancelled';
ALTER TABLE survey_file_removals ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_file_removals FORCE ROW LEVEL SECURITY;
CREATE POLICY survey_file_removals_tenant ON survey_file_removals USING (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid) WITH CHECK (organisation_id=nullif(current_setting('app.current_organisation_id',true),'')::uuid);
--> statement-breakpoint
CREATE FUNCTION guard_survey_file_removal_intent() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; progress_key text; progress_value jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Removal evidence must be retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.progress<>'{}'::jsonb OR NEW.attempts<>0 OR NEW.lease_token IS NOT NULL OR NEW.locked_until IS NOT NULL OR NEW.completed_at IS NOT NULL
  THEN RAISE EXCEPTION 'Removal must begin as undispatched intent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_events a WHERE a.id=NEW.review_id AND a.organisation_id=NEW.organisation_id AND a.resource_id=NEW.job_id::text AND a.action='job.retention_file_reviewed' AND a.metadata->>'reviewVersion'=NEW.review_version AND a.metadata->>'confirmed'='true' AND a.metadata->>'noUnresolvedComplaintOrClaim'='true')
  THEN RAISE EXCEPTION 'Removal requires its bound manager review evidence'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=NEW.organisation_id AND m.user_id=NEW.requested_by_user_id AND m.active AND m.role IN ('owner','administrator','manager'))
  THEN RAISE EXCEPTION 'Removal requires an active practice manager'; END IF;
  IF NEW.manifest->>'organisationId' IS DISTINCT FROM NEW.organisation_id::text OR NEW.manifest->>'jobId' IS DISTINCT FROM NEW.job_id::text OR NEW.manifest->>'reviewVersion' IS DISTINCT FROM NEW.review_version OR NEW.manifest->>'manifestVersion' IS DISTINCT FROM NEW.manifest_version
  THEN RAISE EXCEPTION 'Removal manifest does not match its recorded binding'; END IF;
  IF jsonb_typeof(NEW.manifest->'objects') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.manifest->'objects')=0
  THEN RAISE EXCEPTION 'Removal needs an exact original manifest'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.organisation_id,NEW.job_id,NEW.request_id,NEW.requested_by_user_id,NEW.review_id,NEW.review_version,NEW.request_fingerprint,NEW.manifest_version,NEW.manifest,NEW.reason,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.organisation_id,OLD.job_id,OLD.request_id,OLD.requested_by_user_id,OLD.review_id,OLD.review_version,OLD.request_fingerprint,OLD.manifest_version,OLD.manifest,OLD.reason,OLD.created_at)
  THEN RAISE EXCEPTION 'Approved removal identity and manifest are immutable'; END IF;
  IF OLD.status IN ('completed','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal removal evidence is immutable'; END IF;
  IF NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Removal attempt history cannot move backwards'; END IF;
  IF NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.lease_token IS NOT NULL AND (NEW.status<>'dispatched' OR NEW.attempts<>OLD.attempts+1)
  THEN RAISE EXCEPTION 'A new dispatch lease requires the next recorded attempt'; END IF;
  FOR progress_key,progress_value IN SELECT key,value FROM jsonb_each(OLD.progress) LOOP
   IF progress_value->>'state'='removed' AND NEW.progress->progress_key IS DISTINCT FROM progress_value
   THEN RAISE EXCEPTION 'Verified original removal evidence is immutable'; END IF;
  END LOOP;
  IF NEW.status<>OLD.status AND NOT (
   (OLD.status='queued' AND NEW.status IN ('dispatched','verification_required','cancelled')) OR
   (OLD.status='dispatched' AND NEW.status IN ('verification_required','completed')) OR
   (OLD.status='verification_required' AND NEW.status='dispatched')
  ) THEN RAISE EXCEPTION 'Invalid removal intent transition'; END IF;
 END IF;
 IF jsonb_typeof(NEW.progress) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Removal progress must be an object'; END IF;
 IF NEW.status IN ('queued','cancelled') AND NEW.progress<>'{}'::jsonb THEN RAISE EXCEPTION 'Undispatched removal cannot have storage outcomes'; END IF;
 IF NEW.progress<>'{}'::jsonb AND (NEW.attempts<1 OR NEW.lease_token IS NULL) THEN RAISE EXCEPTION 'Storage outcomes require a recorded dispatch attempt'; END IF;
 FOR progress_key,progress_value IN SELECT key,value FROM jsonb_each(NEW.progress) LOOP
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.manifest->'objects') obj WHERE (obj->>'kind')||':'||(obj->>'id')=progress_key)
  THEN RAISE EXCEPTION 'Removal progress must belong to the approved manifest'; END IF;
  IF jsonb_typeof(progress_value) IS DISTINCT FROM 'object' OR progress_value->>'state' IS NULL OR progress_value->>'state' NOT IN ('dispatched','verification_required','removed')
  THEN RAISE EXCEPTION 'Invalid original removal progress'; END IF;
  IF progress_value->>'state'='removed' AND (progress_value->>'attemptId' IS NULL OR progress_value->>'removedAt' IS NULL)
  THEN RAISE EXCEPTION 'Verified removal needs its attempt and observation time'; END IF;
  IF progress_value->>'attemptId' IS NULL THEN RAISE EXCEPTION 'Original progress requires its dispatch attempt'; END IF;
  PERFORM (progress_value->>'attemptId')::uuid;
  IF progress_value->>'state'='removed' THEN
   IF NOT isfinite((progress_value->>'removedAt')::timestamptz) OR (progress_value->>'removedAt')::timestamptz>clock_timestamp()
   THEN RAISE EXCEPTION 'Removal observation time must be finite and not in the future'; END IF;
  END IF;
 END LOOP;
 IF (NEW.status='completed') IS DISTINCT FROM (NEW.completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Removal completion needs its recorded time'; END IF;
 IF NEW.status='dispatched' AND (NEW.lease_token IS NULL OR NEW.locked_until IS NULL OR NEW.attempts<1) THEN RAISE EXCEPTION 'Dispatch requires a recorded attempt lease'; END IF;
 IF NEW.status='completed' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.manifest->'objects') LOOP
   IF NEW.progress->((item->>'kind')||':'||(item->>'id'))->>'state' IS DISTINCT FROM 'removed'
   THEN RAISE EXCEPTION 'Every original needs verified removal evidence'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER survey_file_removal_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON survey_file_removals FOR EACH ROW EXECUTE FUNCTION guard_survey_file_removal_intent();
